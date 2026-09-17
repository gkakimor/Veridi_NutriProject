import { createHash, randomUUID } from "node:crypto";
import type { ItemLabelFileVersion, Prisma, User } from "@prisma/client";
import type {
  ItemLabelFileMimeType,
  ItemLabelFileResponse,
  ItemLabelFileVersionDTO,
} from "@veridi/shared";
import { isLabelItem } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { StorageAdapter, StorageProviderName, StoredObject } from "../../lib/storage/index.js";
import {
  StorageObjectNotFoundError,
  armazenamentoPara,
  provedorDeArmazenamentoAtivo,
} from "../../lib/storage/index.js";
import type { LabelFileUpload } from "./item-label-file-validation.js";
import { validarArquivoDoRotulo } from "./item-label-file-validation.js";
import {
  ItemInactiveForLabelFileError,
  ItemLabelFileIntegrityError,
  ItemLabelFileObjectMissingError,
  ItemLabelFileVersionAlreadyVoidedError,
  ItemLabelFileVersionIsCurrentError,
  ItemLabelFileVersionNotFoundError,
  ItemNotLabelError,
} from "./item-label-files.errors.js";
import { ItemNotFoundError } from "./items.errors.js";

/**
 * Arquivo do Item Rótulo — LABEL-ATTACHMENTS-01.
 *
 * Versões imutáveis (V1, V2...), vigente derivada (maior número não anulado),
 * anulação com motivo que preserva os bytes, e restauração que cria versão NOVA
 * apontando para o mesmo objeto. Regras em `docs/PRODUCT_RULES.md` §103.
 *
 * Envio em duas fases, nesta ordem, para nunca haver registro sem objeto:
 * 1. o objeto é gravado no storage (chave nova, nunca sobrescreve);
 * 2. a versão é registrada numa transação que trava o Item.
 * Falhou a gravação: nenhuma linha nasce. Falhou o banco depois dela: o objeto
 * recém-gravado é apagado — única exclusão física que existe aqui, e só de um
 * objeto que nenhuma versão referencia.
 */

export interface DependenciasDoArquivoDoRotulo {
  armazenamentoPara: (provider: StorageProviderName) => StorageAdapter;
  provedorAtivo: () => StorageProviderName;
  /** Compensação que falhou deixa objeto sem versão: precisa chegar ao log. */
  registrarFalhaDeCompensacao: (detalhe: string) => void;
}

const DEPENDENCIAS_PADRAO: DependenciasDoArquivoDoRotulo = {
  armazenamentoPara,
  provedorAtivo: provedorDeArmazenamentoAtivo,
  registrarFalhaDeCompensacao: () => undefined,
};

interface ItemParaRotulo {
  id: string;
  type: Parameters<typeof isLabelItem>[0]["type"];
  packagingSubtype: Parameters<typeof isLabelItem>[0]["packagingSubtype"];
  active: boolean;
}

const SELECAO_DO_ITEM = { id: true, type: true, packagingSubtype: true, active: true } as const;

/** Rótulo e ativo — a mesma pergunta antes do corpo e de novo sob a trava. */
function exigirQueAceiteNovaVersao(item: ItemParaRotulo): void {
  if (!isLabelItem(item)) throw new ItemNotLabelError();
  if (!item.active) throw new ItemInactiveForLabelFileError();
}

/** A vigente: maior número entre as não anuladas. `null` = sem arquivo vigente. */
function vigenteEntre(versoes: readonly ItemLabelFileVersion[]): ItemLabelFileVersion | null {
  let vigente: ItemLabelFileVersion | null = null;
  for (const versao of versoes) {
    if (versao.voidedAt !== null) continue;
    if (!vigente || versao.versionNumber > vigente.versionNumber) vigente = versao;
  }
  return vigente;
}

function paraDTO(versao: ItemLabelFileVersion, vigenteId: string | null): ItemLabelFileVersionDTO {
  return {
    id: versao.id,
    itemId: versao.itemId,
    versionNumber: versao.versionNumber,
    status: versao.voidedAt !== null ? "VOIDED" : versao.id === vigenteId ? "CURRENT" : "HISTORICAL",
    originalFileName: versao.originalFileName,
    mimeType: versao.mimeType as ItemLabelFileMimeType,
    sizeBytes: versao.sizeBytes,
    note: versao.note,
    restoredFromVersionNumber: versao.restoredFromVersionNumber,
    createdAt: versao.createdAt.toISOString(),
    createdByName: versao.createdByNameSnapshot,
    voidedAt: versao.voidedAt ? versao.voidedAt.toISOString() : null,
    voidedByName: versao.voidedByNameSnapshot,
    voidReason: versao.voidReason,
  };
}

export async function getItemLabelFile(itemId: string): Promise<ItemLabelFileResponse> {
  const prisma = getPrisma();
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: SELECAO_DO_ITEM });
  if (!item) throw new ItemNotFoundError(itemId);

  const versoes = await prisma.itemLabelFileVersion.findMany({
    where: { itemId },
    orderBy: { versionNumber: "desc" },
  });
  const vigente = vigenteEntre(versoes);
  const labelItem = isLabelItem(item);

  return {
    itemId: item.id,
    labelItem,
    itemActive: item.active,
    acceptsNewVersion: labelItem && item.active,
    current: vigente ? paraDTO(vigente, vigente.id) : null,
    versions: versoes.map((versao) => paraDTO(versao, vigente?.id ?? null)),
  };
}

/**
 * Conferência ANTES de ler o arquivo do corpo: item inexistente, que não é
 * Rótulo ou inativo recusa sem nenhum byte ir ao storage.
 */
export async function assertItemAcceptsLabelFileVersion(itemId: string): Promise<void> {
  const item = await getPrisma().item.findUnique({ where: { id: itemId }, select: SELECAO_DO_ITEM });
  if (!item) throw new ItemNotFoundError(itemId);
  exigirQueAceiteNovaVersao(item);
}

/**
 * Trava o Item para numerar a versão — dois envios simultâneos saem V4 e V5,
 * nunca dois V4. `FOR NO KEY UPDATE`, e não `FOR UPDATE`: a trava não segura
 * quem só referencia o Item (recebimento, movimentação), que pede `FOR KEY
 * SHARE`, e ainda exclui outro envio ou anulação no mesmo Item.
 */
async function travarItem(tx: Prisma.TransactionClient, itemId: string): Promise<ItemParaRotulo> {
  await tx.$queryRaw`SELECT id FROM items WHERE id = ${itemId} FOR NO KEY UPDATE`;
  const item = await tx.item.findUnique({ where: { id: itemId }, select: SELECAO_DO_ITEM });
  if (!item) throw new ItemNotFoundError(itemId);
  return item;
}

async function proximoNumero(tx: Prisma.TransactionClient, itemId: string): Promise<number> {
  const maior = await tx.itemLabelFileVersion.aggregate({
    where: { itemId },
    _max: { versionNumber: true },
  });
  return (maior._max.versionNumber ?? 0) + 1;
}

export async function addItemLabelFileVersion(
  itemId: string,
  upload: LabelFileUpload,
  note: string | null,
  actor: User,
  dependencias: DependenciasDoArquivoDoRotulo = DEPENDENCIAS_PADRAO,
): Promise<ItemLabelFileResponse> {
  const arquivo = validarArquivoDoRotulo(upload);
  await assertItemAcceptsLabelFileVersion(itemId);

  const provider = dependencias.provedorAtivo();
  const storage = dependencias.armazenamentoPara(provider);
  // Identidade do objeto: Item + UUID. Nome do arquivo, cliente ou produto
  // nunca entram na chave.
  const storageKey = `items/${itemId}/labels/${randomUUID()}${arquivo.storageExtension}`;
  const sha256 = createHash("sha256").update(arquivo.content).digest("hex");

  await storage.putObject({
    key: storageKey,
    content: arquivo.content,
    contentType: arquivo.mimeType,
    sha256Hex: sha256,
  });

  try {
    await getPrisma().$transaction(async (tx) => {
      exigirQueAceiteNovaVersao(await travarItem(tx, itemId));
      await tx.itemLabelFileVersion.create({
        data: {
          itemId,
          versionNumber: await proximoNumero(tx, itemId),
          storageProvider: provider,
          storageKey,
          originalFileName: arquivo.displayName,
          mimeType: arquivo.mimeType,
          sizeBytes: arquivo.content.byteLength,
          sha256,
          note,
          createdByUserId: actor.id,
          createdByNameSnapshot: actor.name,
        },
      });
    });
  } catch (error) {
    await compensarEnvio(storage, itemId, storageKey, dependencias);
    throw error;
  }

  return getItemLabelFile(itemId);
}

/**
 * Sem versão, o objeto recém-gravado não pode ficar. Antes de apagar, pergunta
 * ao banco: um COMMIT que chegou e cuja resposta se perdeu também cai aqui, e
 * apagar nesse caso deixaria versão apontando para objeto inexistente — o pior
 * dos dois órfãos. Na dúvida (banco fora), o objeto fica e o log registra.
 */
async function compensarEnvio(
  storage: StorageAdapter,
  itemId: string,
  storageKey: string,
  dependencias: DependenciasDoArquivoDoRotulo,
): Promise<void> {
  let registrada: boolean;
  try {
    registrada = (await getPrisma().itemLabelFileVersion.count({ where: { itemId, storageKey } })) > 0;
  } catch {
    dependencias.registrarFalhaDeCompensacao(
      `envio do arquivo do rótulo falhou e o banco não confirmou a versão: objeto mantido no storage ${storage.provider} (item ${itemId})`,
    );
    return;
  }
  if (registrada) return;

  await storage.deleteObject(storageKey).catch((falha: unknown) => {
    const nome = falha instanceof Error ? falha.name : "erro";
    dependencias.registrarFalhaDeCompensacao(
      `objeto sem versão ficou no storage ${storage.provider}: item ${itemId}, compensação falhou (${nome})`,
    );
  });
}

async function versaoDoItem(itemId: string, versionId: string): Promise<ItemLabelFileVersion> {
  const versao = await getPrisma().itemLabelFileVersion.findFirst({ where: { id: versionId, itemId } });
  if (!versao) throw new ItemLabelFileVersionNotFoundError();
  return versao;
}

/**
 * Anular: motivo obrigatório, autor e data da sessão, bytes intocados. A
 * versão sai de vigência e continua no histórico. Não depende de o Item ainda
 * ser Rótulo nem estar ativo — é decisão sobre um arquivo que já existe.
 */
export async function voidItemLabelFileVersion(
  itemId: string,
  versionId: string,
  reason: string,
  actor: User,
): Promise<ItemLabelFileResponse> {
  await getPrisma().$transaction(async (tx) => {
    await travarItem(tx, itemId);
    const versao = await tx.itemLabelFileVersion.findFirst({
      where: { id: versionId, itemId },
      select: { versionNumber: true, voidedAt: true },
    });
    if (!versao) throw new ItemLabelFileVersionNotFoundError();
    if (versao.voidedAt) throw new ItemLabelFileVersionAlreadyVoidedError(versao.versionNumber);

    await tx.itemLabelFileVersion.update({
      where: { id: versionId },
      data: {
        voidedAt: new Date(),
        voidedByUserId: actor.id,
        voidedByNameSnapshot: actor.name,
        voidReason: reason,
      },
    });
  });

  return getItemLabelFile(itemId);
}

/**
 * Restaurar: versão NOVA no topo com o mesmo objeto da origem. A origem não é
 * desanulada nem alterada — anulada continua anulada. Restaurar a vigente é
 * recusado. O objeto precisa existir antes de nascer versão apontando para ele.
 */
export async function restoreItemLabelFileVersion(
  itemId: string,
  sourceVersionId: string,
  note: string | null,
  actor: User,
  dependencias: DependenciasDoArquivoDoRotulo = DEPENDENCIAS_PADRAO,
): Promise<ItemLabelFileResponse> {
  await assertItemAcceptsLabelFileVersion(itemId);
  const origem = await versaoDoItem(itemId, sourceVersionId);

  const cabecalho = await dependencias
    .armazenamentoPara(origem.storageProvider)
    .headObject(origem.storageKey);
  if (!cabecalho) throw new ItemLabelFileObjectMissingError(origem.versionNumber);

  await getPrisma().$transaction(async (tx) => {
    exigirQueAceiteNovaVersao(await travarItem(tx, itemId));

    const vigente = await tx.itemLabelFileVersion.findFirst({
      where: { itemId, voidedAt: null },
      orderBy: { versionNumber: "desc" },
      select: { id: true },
    });
    if (vigente?.id === origem.id) throw new ItemLabelFileVersionIsCurrentError(origem.versionNumber);

    await tx.itemLabelFileVersion.create({
      data: {
        itemId,
        versionNumber: await proximoNumero(tx, itemId),
        storageProvider: origem.storageProvider,
        storageKey: origem.storageKey,
        originalFileName: origem.originalFileName,
        mimeType: origem.mimeType,
        sizeBytes: origem.sizeBytes,
        sha256: origem.sha256,
        note,
        restoredFromVersionId: origem.id,
        restoredFromVersionNumber: origem.versionNumber,
        createdByUserId: actor.id,
        createdByNameSnapshot: actor.name,
      },
    });
  });

  return getItemLabelFile(itemId);
}

export interface ArquivoDaVersao {
  versao: ItemLabelFileVersion;
  objeto: StoredObject;
}

/**
 * Abre o objeto da versão para o download. Objeto ausente ou com tamanho
 * diferente do registrado não é servido: o navegador receberia um arquivo que
 * não é o da versão.
 */
export async function openItemLabelFileVersion(
  itemId: string,
  versionId: string,
  dependencias: DependenciasDoArquivoDoRotulo = DEPENDENCIAS_PADRAO,
): Promise<ArquivoDaVersao> {
  const versao = await versaoDoItem(itemId, versionId);

  let objeto: StoredObject;
  try {
    objeto = await dependencias.armazenamentoPara(versao.storageProvider).getObject(versao.storageKey);
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      throw new ItemLabelFileObjectMissingError(versao.versionNumber);
    }
    throw error;
  }

  if (objeto.contentLength !== null && objeto.contentLength !== versao.sizeBytes) {
    objeto.body.destroy();
    throw new ItemLabelFileIntegrityError(versao.versionNumber);
  }
  return { versao, objeto };
}
