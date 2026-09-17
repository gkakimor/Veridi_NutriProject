import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ItemType, PackagingSubtype, User, UserRole } from "@prisma/client";
import type { ItemLabelFileResponse } from "@veridi/shared";
import {
  ITEM_LABEL_FILE_MAX_SIZE_BYTES,
  ITEM_LABEL_FILE_RESTORE_ROLES,
  ITEM_LABEL_FILE_UPLOAD_ROLES,
  ITEM_LABEL_FILE_VOID_ROLES,
} from "@veridi/shared";

/**
 * LABEL-ATTACHMENTS-01 — arquivo versionado do Item Rótulo, pela API.
 *
 * O storage é `LOCAL_FS` num diretório temporário deste arquivo, por trás de
 * um adaptador que deixa simular a queda do storage. Nenhum teste fala com o
 * R2 real, e nenhum escreve em `VERIDI_UPLOAD_DIR`.
 */

const armazenamentoDoTeste = vi.hoisted(() => ({ adaptador: null as unknown }));

vi.mock("../../lib/storage/index.js", async (original) => {
  const real = await original<typeof import("../../lib/storage/index.js")>();
  return {
    ...real,
    provedorDeArmazenamentoAtivo: () => "LOCAL_FS" as const,
    armazenamentoPara: () => {
      if (!armazenamentoDoTeste.adaptador) throw new Error("storage de teste não montado");
      return armazenamentoDoTeste.adaptador;
    },
  };
});

import { buildApp } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";
import { LocalFsStorageAdapter } from "../../lib/storage/local-fs-storage.js";
import type { PutObjectInput, StorageAdapter } from "../../lib/storage/storage-adapter.js";
import { StorageUnavailableError } from "../../lib/storage/storage-adapter.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { addItemLabelFileVersion } from "./item-label-files.service.js";

type App = ReturnType<typeof buildTestApp>;

/** LOCAL_FS de verdade, com a queda da gravação sob controle do teste. */
class ArmazenamentoDeTeste implements StorageAdapter {
  readonly provider = "LOCAL_FS" as const;
  falharGravacao = false;
  readonly apagados: string[] = [];

  constructor(readonly real: LocalFsStorageAdapter) {}

  async putObject(input: PutObjectInput) {
    if (this.falharGravacao) throw new StorageUnavailableError("LOCAL_FS", "putObject simulado");
    return this.real.putObject(input);
  }
  getObject(key: string) {
    return this.real.getObject(key);
  }
  headObject(key: string) {
    return this.real.headObject(key);
  }
  async deleteObject(key: string) {
    this.apagados.push(key);
    return this.real.deleteObject(key);
  }
}

const PERFIS: UserRole[] = ["ADMIN", "PURCHASING", "QUALITY", "COMMERCIAL", "PRODUCTION", "VIEWER"];
const apps = new Map<UserRole, App>();
const itemIds: string[] = [];
let raiz: string;
let storage: ArmazenamentoDeTeste;

function app(role: UserRole = "ADMIN"): App {
  const encontrado = apps.get(role);
  if (!encontrado) throw new Error(`app ${role} não montado`);
  return encontrado;
}

function marker(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

const CABECALHO_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CABECALHO_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function pdf(texto = marker()): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${texto}\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n`, "latin1");
}
function png(texto = marker()): Buffer {
  return Buffer.concat([CABECALHO_PNG, Buffer.from(texto, "utf8")]);
}
function jpeg(texto = marker()): Buffer {
  return Buffer.concat([CABECALHO_JPEG, Buffer.from(texto, "utf8")]);
}

interface Arquivo {
  nome: string;
  tipo: string;
  conteudo: Buffer;
}

type Parte = { campo: string; valor: string } | { campo: string; arquivo: Arquivo };

/** Multipart montado à mão, como em `quality-documents.test.ts`. */
function formulario(partes: Parte[]): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----veridi${marker()}`;
  const blocos: Buffer[] = [];
  for (const parte of partes) {
    if ("valor" in parte) {
      blocos.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${parte.campo}"\r\n\r\n${parte.valor}\r\n`,
          "utf8",
        ),
      );
    } else {
      blocos.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${parte.campo}"; filename="${parte.arquivo.nome}"\r\n` +
            `Content-Type: ${parte.arquivo.tipo}\r\n\r\n`,
          "utf8",
        ),
        parte.arquivo.conteudo,
        Buffer.from("\r\n", "utf8"),
      );
    }
  }
  blocos.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return {
    payload: Buffer.concat(blocos),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

async function enviar(role: UserRole, itemId: string, arquivo: Arquivo, note?: string) {
  const { payload, headers } = formulario([
    ...(note !== undefined ? [{ campo: "note", valor: note }] : []),
    { campo: "file", arquivo },
  ]);
  return app(role).inject({ method: "POST", url: `/items/${itemId}/label-file/versions`, payload, headers });
}

async function estado(itemId: string, role: UserRole = "VIEWER"): Promise<ItemLabelFileResponse> {
  const resposta = await app(role).inject({ method: "GET", url: `/items/${itemId}/label-file` });
  expect(resposta.statusCode).toBe(200);
  return resposta.json() as ItemLabelFileResponse;
}

function anular(role: UserRole, itemId: string, versionId: string, reason?: string) {
  return app(role).inject({
    method: "POST",
    url: `/items/${itemId}/label-file/versions/${versionId}/void`,
    payload: reason === undefined ? {} : { reason },
  });
}

function restaurar(role: UserRole, itemId: string, versionId: string, note?: string) {
  return app(role).inject({
    method: "POST",
    url: `/items/${itemId}/label-file/versions/${versionId}/restore`,
    payload: note === undefined ? {} : { note },
  });
}

function baixar(role: UserRole, itemId: string, versionId: string) {
  return app(role).inject({
    method: "GET",
    url: `/items/${itemId}/label-file/versions/${versionId}/download`,
  });
}

async function criarItem(
  opcoes: { type?: ItemType; packagingSubtype?: PackagingSubtype | null; active?: boolean } = {},
) {
  const item = await getPrisma().item.create({
    data: {
      code: `ME-ROT-${marker()}`,
      type: opcoes.type ?? "PACKAGING",
      name: `Rótulo de teste ${marker()}`,
      unitCode: "un",
      packagingSubtype: opcoes.packagingSubtype === undefined ? "LABEL" : opcoes.packagingSubtype,
      active: opcoes.active ?? true,
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  itemIds.push(item.id);
  return item;
}

/** Arquivos gravados no namespace do Item — o que realmente chegou ao storage. */
async function objetosDoItem(itemId: string): Promise<string[]> {
  try {
    return await readdir(path.join(raiz, "items", itemId, "labels"));
  } catch {
    return [];
  }
}

async function versoesNoBanco(itemId: string) {
  return getPrisma().itemLabelFileVersion.findMany({ where: { itemId }, orderBy: { versionNumber: "asc" } });
}

beforeAll(async () => {
  raiz = await mkdtemp(path.join(tmpdir(), "veridi-label-files-"));
  storage = new ArmazenamentoDeTeste(new LocalFsStorageAdapter(raiz));
  armazenamentoDoTeste.adaptador = storage;

  await getPrisma().unitOfMeasure.upsert({
    where: { code: "un" },
    update: {},
    create: { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  });

  for (const role of PERFIS) {
    const instancia = buildTestApp(role);
    await instancia.ready();
    apps.set(role, instancia);
  }
});

afterAll(async () => {
  const prisma = getPrisma();
  // Restauração aponta para a origem (RESTRICT): da versão mais nova para a mais antiga.
  const versoes = await prisma.itemLabelFileVersion.findMany({
    where: { itemId: { in: itemIds } },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
  });
  for (const versao of versoes) {
    await prisma.itemLabelFileVersion.delete({ where: { id: versao.id } });
  }
  if (itemIds.length > 0) await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  for (const instancia of apps.values()) await instancia.close();
  await rm(raiz, { recursive: true, force: true });
});

describe("LABEL-ATTACHMENTS-01 — as listas de perfil são as do handoff", () => {
  it("enviar e restaurar: Administrador, Compras, Qualidade e Comercial; anular: Administrador e Qualidade", () => {
    const ordenar = (roles: readonly UserRole[]) => [...roles].sort();
    expect(ordenar(ITEM_LABEL_FILE_UPLOAD_ROLES)).toEqual(["ADMIN", "COMMERCIAL", "PURCHASING", "QUALITY"]);
    expect(ordenar(ITEM_LABEL_FILE_RESTORE_ROLES)).toEqual(["ADMIN", "COMMERCIAL", "PURCHASING", "QUALITY"]);
    expect(ordenar(ITEM_LABEL_FILE_VOID_ROLES)).toEqual(["ADMIN", "QUALITY"]);
  });
});

describe("LABEL-ATTACHMENTS-01 — envio de versão", () => {
  it("PDF, PNG e JPEG entram como V1, V2 e V3; a anterior fica, e só a mais nova é vigente", async () => {
    const item = await criarItem();
    const arquivos = [
      { nome: "Rótulo Vitamina C.pdf", tipo: "application/pdf", conteudo: pdf("v1") },
      { nome: "rotulo-v2.png", tipo: "image/png", conteudo: png("v2") },
      { nome: "rotulo-v3.jpg", tipo: "image/jpeg", conteudo: jpeg("v3") },
    ];

    for (const [indice, arquivo] of arquivos.entries()) {
      const resposta = await enviar("QUALITY", item.id, arquivo, indice === 0 ? "Arte aprovada pela gráfica" : undefined);
      expect(resposta.statusCode, resposta.body).toBe(201);
      const corpo = resposta.json() as ItemLabelFileResponse;
      expect(corpo.current?.versionNumber).toBe(indice + 1);
      expect(corpo.current?.originalFileName).toBe(arquivo.nome);
    }

    const final = await estado(item.id);
    expect(final.labelItem).toBe(true);
    expect(final.acceptsNewVersion).toBe(true);
    expect(final.versions.map((v) => [v.versionNumber, v.status, v.mimeType])).toEqual([
      [3, "CURRENT", "image/jpeg"],
      [2, "HISTORICAL", "image/png"],
      [1, "HISTORICAL", "application/pdf"],
    ]);
    const v1 = final.versions[2]!;
    expect(v1.note).toBe("Arte aprovada pela gráfica");
    expect(v1.sizeBytes).toBe(arquivos[0]!.conteudo.byteLength);
    expect(v1.createdByName).toBe("Usuário de Teste QUALITY");
    expect(v1.restoredFromVersionNumber).toBeNull();
    // DTO nunca leva a chave do objeto nem o provedor.
    expect(JSON.stringify(final)).not.toContain("storageKey");
    expect(JSON.stringify(final)).not.toContain("items/");

    // A anterior continua com os próprios bytes.
    const download = await baixar("VIEWER", item.id, v1.id);
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(arquivos[0]!.conteudo);
    expect(await objetosDoItem(item.id)).toHaveLength(3);
  });

  it("chave do objeto: item + UUID, sem nome do arquivo; hash e provedor gravados", async () => {
    const item = await criarItem();
    const conteudo = pdf();
    const resposta = await enviar("ADMIN", item.id, {
      nome: "Cliente ACME CNPJ 12.345.678-0001-90.pdf",
      tipo: "application/pdf",
      conteudo,
    });
    expect(resposta.statusCode, resposta.body).toBe(201);

    const [linha] = await versoesNoBanco(item.id);
    expect(linha?.storageKey).toMatch(new RegExp(`^items/${item.id}/labels/[0-9a-f-]{36}\\.pdf$`));
    expect(linha?.storageKey).not.toContain("ACME");
    expect(linha?.storageProvider).toBe("LOCAL_FS");
    expect(linha?.sha256).toBe(createHash("sha256").update(conteudo).digest("hex"));
    expect(linha?.originalFileName).toBe("Cliente ACME CNPJ 12.345.678-0001-90.pdf");
  });

  it("observação: espaço em branco vira ausência; acima de 500 caracteres recusa sem gravar", async () => {
    const item = await criarItem();
    const branco = await enviar("ADMIN", item.id, { nome: "a.pdf", tipo: "application/pdf", conteudo: pdf() }, "   ");
    expect(branco.statusCode, branco.body).toBe(201);
    expect((branco.json() as ItemLabelFileResponse).current?.note).toBeNull();

    const longa = await enviar("ADMIN", item.id, { nome: "b.pdf", tipo: "application/pdf", conteudo: pdf() }, "x".repeat(501));
    expect(longa.statusCode).toBe(400);
    expect(longa.json()).toMatchObject({ error: "validation_error" });
    expect(await versoesNoBanco(item.id)).toHaveLength(1);
  });

  it.each([
    ["Pote (embalagem de outro subtipo)", { packagingSubtype: "POT" as const }],
    ["embalagem sem subtipo", { packagingSubtype: null }],
    ["matéria-prima", { type: "RAW_MATERIAL" as const, packagingSubtype: null }],
  ])("%s não é Rótulo: 409 item_not_label e nada chega ao storage", async (_caso, opcoes) => {
    const item = await criarItem(opcoes);
    const resposta = await enviar("ADMIN", item.id, { nome: "a.pdf", tipo: "application/pdf", conteudo: pdf() });
    expect(resposta.statusCode).toBe(409);
    expect(resposta.json()).toMatchObject({ error: "item_not_label" });
    expect(await objetosDoItem(item.id)).toEqual([]);

    const consulta = await estado(item.id);
    expect(consulta).toMatchObject({ labelItem: false, acceptsNewVersion: false, current: null, versions: [] });
  });

  it("nome do Item não decide: embalagem chamada 'Rótulo' com subtipo Pote é recusada", async () => {
    const item = await criarItem({ packagingSubtype: "POT" });
    await getPrisma().item.update({ where: { id: item.id }, data: { name: `Rótulo frontal ${marker()}` } });
    const resposta = await enviar("ADMIN", item.id, { nome: "a.pdf", tipo: "application/pdf", conteudo: pdf() });
    expect(resposta.json()).toMatchObject({ error: "item_not_label" });
  });

  it("Item inativo: histórico e download seguem; envio e restauração recusam com 409 item_inactive", async () => {
    const item = await criarItem();
    expect((await enviar("ADMIN", item.id, { nome: "v1.pdf", tipo: "application/pdf", conteudo: pdf() })).statusCode).toBe(201);
    expect((await enviar("ADMIN", item.id, { nome: "v2.pdf", tipo: "application/pdf", conteudo: pdf() })).statusCode).toBe(201);
    await getPrisma().item.update({ where: { id: item.id }, data: { active: false } });

    const recusado = await enviar("ADMIN", item.id, { nome: "v3.pdf", tipo: "application/pdf", conteudo: pdf() });
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json()).toMatchObject({ error: "item_inactive" });

    const consulta = await estado(item.id);
    expect(consulta).toMatchObject({ labelItem: true, itemActive: false, acceptsNewVersion: false });
    expect(consulta.versions).toHaveLength(2);
    const v1 = consulta.versions[1]!;
    expect((await baixar("VIEWER", item.id, v1.id)).statusCode).toBe(200);

    const restauracao = await restaurar("ADMIN", item.id, v1.id);
    expect(restauracao.statusCode).toBe(409);
    expect(restauracao.json()).toMatchObject({ error: "item_inactive" });
    expect(await versoesNoBanco(item.id)).toHaveLength(2);
    expect(await objetosDoItem(item.id)).toHaveLength(2);
  });

  it.each([
    ["texto", { nome: "notas.txt", tipo: "text/plain", conteudo: Buffer.from("texto", "utf8") }],
    ["GIF", { nome: "arte.gif", tipo: "image/gif", conteudo: Buffer.from("GIF89a....", "latin1") }],
    ["SVG", { nome: "arte.svg", tipo: "image/svg+xml", conteudo: Buffer.from("<svg/>", "utf8") }],
    ["PDF com tipo genérico", { nome: "arte.pdf", tipo: "application/octet-stream", conteudo: pdf() }],
    ["nome PNG com tipo PDF", { nome: "arte.png", tipo: "application/pdf", conteudo: pdf() }],
  ])("tipo proibido (%s): 400 unsupported_file_type, nada gravado", async (_caso, arquivo) => {
    const item = await criarItem();
    const resposta = await enviar("ADMIN", item.id, arquivo);
    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(resposta.json()).toMatchObject({ error: "unsupported_file_type" });
    expect(await versoesNoBanco(item.id)).toHaveLength(0);
    expect(await objetosDoItem(item.id)).toEqual([]);
  });

  it.each([
    ["PNG com nome e tipo de PDF", { nome: "arte.pdf", tipo: "application/pdf", conteudo: png() }],
    ["texto com nome e tipo de JPEG", { nome: "arte.jpg", tipo: "image/jpeg", conteudo: Buffer.from("olá", "utf8") }],
    ["executável com nome e tipo de PNG", { nome: "arte.png", tipo: "image/png", conteudo: Buffer.from("MZ\x90\x00", "latin1") }],
  ])("assinatura incompatível (%s): 400 file_signature_mismatch, nada gravado", async (_caso, arquivo) => {
    const item = await criarItem();
    const resposta = await enviar("ADMIN", item.id, arquivo);
    expect(resposta.statusCode, resposta.body).toBe(400);
    expect(resposta.json()).toMatchObject({ error: "file_signature_mismatch" });
    expect(await versoesNoBanco(item.id)).toHaveLength(0);
    expect(await objetosDoItem(item.id)).toEqual([]);
  });

  it("25 MB exatos passam; um byte acima recusa com 413 file_too_large e nada é gravado", async () => {
    const item = await criarItem();
    const limite = Buffer.alloc(ITEM_LABEL_FILE_MAX_SIZE_BYTES, 0x20);
    pdf().copy(limite);
    const aceito = await enviar("ADMIN", item.id, { nome: "grande.pdf", tipo: "application/pdf", conteudo: limite });
    expect(aceito.statusCode, aceito.body.slice(0, 200)).toBe(201);

    const acima = Buffer.alloc(ITEM_LABEL_FILE_MAX_SIZE_BYTES + 1, 0x20);
    pdf().copy(acima);
    const recusado = await enviar("ADMIN", item.id, { nome: "grande-demais.pdf", tipo: "application/pdf", conteudo: acima });
    expect(recusado.statusCode).toBe(413);
    expect(recusado.json()).toMatchObject({ error: "file_too_large" });
    expect(await versoesNoBanco(item.id)).toHaveLength(1);
    expect(await objetosDoItem(item.id)).toHaveLength(1);
  });

  it("vazio, sem arquivo, dois arquivos e corpo que não é formulário recusam sem gravar", async () => {
    const item = await criarItem();

    const vazio = await enviar("ADMIN", item.id, { nome: "a.pdf", tipo: "application/pdf", conteudo: Buffer.alloc(0) });
    expect(vazio.json()).toMatchObject({ error: "empty_file" });

    const semArquivo = formulario([{ campo: "note", valor: "só a nota" }]);
    const semArquivoResposta = await app().inject({
      method: "POST",
      url: `/items/${item.id}/label-file/versions`,
      ...semArquivo,
    });
    expect(semArquivoResposta.statusCode).toBe(400);
    expect(semArquivoResposta.json()).toMatchObject({ error: "missing_file" });

    const dois = formulario([
      { campo: "file", arquivo: { nome: "a.pdf", tipo: "application/pdf", conteudo: pdf() } },
      { campo: "file", arquivo: { nome: "b.pdf", tipo: "application/pdf", conteudo: pdf() } },
    ]);
    const doisResposta = await app().inject({ method: "POST", url: `/items/${item.id}/label-file/versions`, ...dois });
    expect(doisResposta.statusCode).toBe(400);
    expect(doisResposta.json()).toMatchObject({ error: "too_many_files" });

    const tres = formulario(
      ["a", "b", "c"].map((letra) => ({
        campo: "file",
        arquivo: { nome: `${letra}.pdf`, tipo: "application/pdf", conteudo: pdf(letra) },
      })),
    );
    const tresResposta = await app().inject({ method: "POST", url: `/items/${item.id}/label-file/versions`, ...tres });
    expect(tresResposta.statusCode).toBe(400);
    expect(tresResposta.json()).toMatchObject({ error: "too_many_files" });

    const json = await app().inject({
      method: "POST",
      url: `/items/${item.id}/label-file/versions`,
      payload: { file: "não é arquivo" },
    });
    expect(json.statusCode).toBe(400);
    expect(json.json()).toMatchObject({ error: "invalid_multipart" });

    expect(await versoesNoBanco(item.id)).toHaveLength(0);
    expect(await objetosDoItem(item.id)).toEqual([]);
  });

  it("dois envios ao mesmo tempo saem V1 e V2 — nunca dois V1", async () => {
    const item = await criarItem();
    const respostas = await Promise.all([
      enviar("ADMIN", item.id, { nome: "a.pdf", tipo: "application/pdf", conteudo: pdf("a") }),
      enviar("PURCHASING", item.id, { nome: "b.pdf", tipo: "application/pdf", conteudo: pdf("b") }),
    ]);
    expect(respostas.map((r) => r.statusCode)).toEqual([201, 201]);
    expect((await versoesNoBanco(item.id)).map((v) => v.versionNumber)).toEqual([1, 2]);
  });

  it("storage fora do ar: 503 storage_unavailable e nenhuma versão nasce", async () => {
    const item = await criarItem();
    storage.falharGravacao = true;
    try {
      const resposta = await enviar("ADMIN", item.id, { nome: "a.pdf", tipo: "application/pdf", conteudo: pdf() });
      expect(resposta.statusCode).toBe(503);
      expect(resposta.json()).toMatchObject({ error: "storage_unavailable" });
    } finally {
      storage.falharGravacao = false;
    }
    expect(await versoesNoBanco(item.id)).toHaveLength(0);
  });

  it("banco falha depois da gravação: o objeto recém-gravado é removido (compensação)", async () => {
    const item = await criarItem();
    const falhas: string[] = [];
    const antes = storage.apagados.length;
    // Autor inexistente: a chave estrangeira recusa o INSERT depois do objeto já gravado.
    const fantasma = { id: "00000000-0000-0000-0000-00000000dead", name: "Fantasma" } as User;

    await expect(
      addItemLabelFileVersion(
        item.id,
        { fileName: "a.pdf", declaredMimeType: "application/pdf", content: pdf() },
        null,
        fantasma,
        {
          armazenamentoPara: () => storage,
          provedorAtivo: () => "LOCAL_FS",
          registrarFalhaDeCompensacao: (detalhe) => falhas.push(detalhe),
        },
      ),
    ).rejects.toThrow();

    expect(storage.apagados.length).toBe(antes + 1);
    expect(storage.apagados.at(-1)).toMatch(new RegExp(`^items/${item.id}/labels/`));
    expect(await objetosDoItem(item.id)).toEqual([]);
    expect(await versoesNoBanco(item.id)).toHaveLength(0);
    expect(falhas).toEqual([]);
  });
});

describe("LABEL-ATTACHMENTS-01 — anular", () => {
  it("motivo obrigatório; anular tira de vigência, guarda quem e por quê, e os bytes ficam", async () => {
    const item = await criarItem();
    const v1Conteudo = pdf("v1");
    const v2Conteudo = pdf("v2");
    await enviar("ADMIN", item.id, { nome: "v1.pdf", tipo: "application/pdf", conteudo: v1Conteudo });
    const v2 = ((await enviar("ADMIN", item.id, { nome: "v2.pdf", tipo: "application/pdf", conteudo: v2Conteudo })).json() as ItemLabelFileResponse).current!;

    for (const semMotivo of [undefined, "", "   "]) {
      const recusa = await anular("QUALITY", item.id, v2.id, semMotivo);
      expect(recusa.statusCode, `motivo ${JSON.stringify(semMotivo)}`).toBe(400);
      expect(recusa.json()).toMatchObject({ error: "validation_error" });
    }

    const anulada = await anular("QUALITY", item.id, v2.id, "  Arte com a tabela nutricional errada  ");
    expect(anulada.statusCode, anulada.body).toBe(200);
    const depois = anulada.json() as ItemLabelFileResponse;
    expect(depois.current?.versionNumber).toBe(1);
    expect(depois.versions[0]).toMatchObject({
      versionNumber: 2,
      status: "VOIDED",
      voidedByName: "Usuário de Teste QUALITY",
      voidReason: "Arte com a tabela nutricional errada",
    });
    expect(depois.versions[0]?.voidedAt).not.toBeNull();

    // Histórico visível e bytes intactos.
    const download = await baixar("VIEWER", item.id, v2.id);
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(v2Conteudo);
    expect(await objetosDoItem(item.id)).toHaveLength(2);

    const denovo = await anular("ADMIN", item.id, v2.id, "outra vez");
    expect(denovo.statusCode).toBe(409);
    expect(denovo.json()).toMatchObject({ error: "version_already_voided" });
  });

  it("todas anuladas: sem arquivo vigente, histórico inteiro visível", async () => {
    const item = await criarItem();
    const v1 = ((await enviar("ADMIN", item.id, { nome: "v1.pdf", tipo: "application/pdf", conteudo: pdf() })).json() as ItemLabelFileResponse).current!;
    expect((await anular("ADMIN", item.id, v1.id, "Fornecedor trocou a arte")).statusCode).toBe(200);

    const final = await estado(item.id);
    expect(final.current).toBeNull();
    expect(final.versions.map((v) => v.status)).toEqual(["VOIDED"]);
  });

  it("versão de outro item é 404 — o id da versão não atravessa itens", async () => {
    const a = await criarItem();
    const b = await criarItem();
    const va = ((await enviar("ADMIN", a.id, { nome: "a.pdf", tipo: "application/pdf", conteudo: pdf() })).json() as ItemLabelFileResponse).current!;

    expect((await anular("ADMIN", b.id, va.id, "motivo")).statusCode).toBe(404);
    expect((await restaurar("ADMIN", b.id, va.id)).statusCode).toBe(404);
    expect((await baixar("ADMIN", b.id, va.id)).statusCode).toBe(404);
  });
});

describe("LABEL-ATTACHMENTS-01 — restaurar", () => {
  it("cria versão nova no topo com o arquivo da origem; a origem não muda, anulada continua anulada", async () => {
    const item = await criarItem();
    const conteudoV1 = pdf("original");
    const v1 = ((await enviar("ADMIN", item.id, { nome: "original.pdf", tipo: "application/pdf", conteudo: conteudoV1 })).json() as ItemLabelFileResponse).current!;
    const v2 = ((await enviar("ADMIN", item.id, { nome: "nova.png", tipo: "image/png", conteudo: png() })).json() as ItemLabelFileResponse).current!;

    const restaurada = await restaurar("COMMERCIAL", item.id, v1.id, "Volta a arte anterior");
    expect(restaurada.statusCode, restaurada.body).toBe(201);
    const depois = restaurada.json() as ItemLabelFileResponse;
    expect(depois.current).toMatchObject({
      versionNumber: 3,
      status: "CURRENT",
      restoredFromVersionNumber: 1,
      originalFileName: "original.pdf",
      mimeType: "application/pdf",
      sizeBytes: conteudoV1.byteLength,
      note: "Volta a arte anterior",
      createdByName: "Usuário de Teste COMMERCIAL",
    });
    expect(depois.versions.find((v) => v.id === v1.id)).toMatchObject({ status: "HISTORICAL", restoredFromVersionNumber: null });

    const bytes = await baixar("VIEWER", item.id, depois.current!.id);
    expect(bytes.rawPayload).toEqual(conteudoV1);
    // Restaurar não grava bytes novos: o objeto é o mesmo da V1.
    expect(await objetosDoItem(item.id)).toHaveLength(2);
    const linhas = await versoesNoBanco(item.id);
    expect(linhas[2]?.storageKey).toBe(linhas[0]?.storageKey);

    // A vigente não se restaura.
    const vigente = await restaurar("ADMIN", item.id, depois.current!.id);
    expect(vigente.statusCode).toBe(409);
    expect(vigente.json()).toMatchObject({ error: "version_is_current" });

    // Anulada pode originar versão nova — e continua anulada.
    expect((await anular("QUALITY", item.id, v2.id, "Arte reprovada")).statusCode).toBe(200);
    const deAnulada = await restaurar("PURCHASING", item.id, v2.id);
    expect(deAnulada.statusCode, deAnulada.body).toBe(201);
    const fim = deAnulada.json() as ItemLabelFileResponse;
    expect(fim.current).toMatchObject({ versionNumber: 4, restoredFromVersionNumber: 2, mimeType: "image/png" });
    expect(fim.versions.find((v) => v.id === v2.id)).toMatchObject({ status: "VOIDED", voidReason: "Arte reprovada" });
    expect(fim.versions.map((v) => v.versionNumber)).toEqual([4, 3, 2, 1]);
  });

  it("objeto ausente no storage: download 404 e restauração 409 storage_object_missing, sem versão nova", async () => {
    const item = await criarItem();
    const v1 = ((await enviar("ADMIN", item.id, { nome: "v1.pdf", tipo: "application/pdf", conteudo: pdf() })).json() as ItemLabelFileResponse).current!;
    await enviar("ADMIN", item.id, { nome: "v2.pdf", tipo: "application/pdf", conteudo: pdf() });

    const [linhaV1] = await versoesNoBanco(item.id);
    await unlink(path.join(raiz, ...linhaV1!.storageKey.split("/")));

    const download = await baixar("VIEWER", item.id, v1.id);
    expect(download.statusCode).toBe(404);
    expect(download.json()).toMatchObject({ error: "storage_object_missing" });

    const restauracao = await restaurar("ADMIN", item.id, v1.id);
    expect(restauracao.statusCode).toBe(409);
    expect(restauracao.json()).toMatchObject({ error: "storage_object_missing" });
    expect(await versoesNoBanco(item.id)).toHaveLength(2);
  });
});

describe("LABEL-ATTACHMENTS-01 — download autenticado", () => {
  it("streaming com tipo, tamanho, nome seguro, nosniff e sem cache compartilhado", async () => {
    const item = await criarItem();
    const conteudo = png("download");
    const versao = ((await enviar("ADMIN", item.id, { nome: "Rótulo frontal; v2.png", tipo: "image/png", conteudo })).json() as ItemLabelFileResponse).current!;

    const resposta = await baixar("PRODUCTION", item.id, versao.id);
    expect(resposta.statusCode).toBe(200);
    expect(resposta.headers["content-type"]).toBe("image/png");
    expect(resposta.headers["content-length"]).toBe(String(conteudo.byteLength));
    expect(resposta.headers["x-content-type-options"]).toBe("nosniff");
    expect(resposta.headers["cache-control"]).toBe("private, no-store");
    // Aspas e barra invertida no nome estão no teste de `contentDispositionInline`:
    // o navegador as manda escapadas no formulário.
    expect(resposta.headers["content-disposition"]).toBe(
      "inline; filename=\"Rotulo frontal; v2.png\"; filename*=UTF-8''R%C3%B3tulo%20frontal%3B%20v2.png",
    );
    expect(resposta.rawPayload).toEqual(conteudo);
  });

  it("sem sessão: 401 na consulta e no download", async () => {
    const item = await criarItem();
    const versao = ((await enviar("ADMIN", item.id, { nome: "a.pdf", tipo: "application/pdf", conteudo: pdf() })).json() as ItemLabelFileResponse).current!;

    const anonimo = buildApp();
    await anonimo.ready();
    try {
      expect((await anonimo.inject({ method: "GET", url: `/items/${item.id}/label-file` })).statusCode).toBe(401);
      expect(
        (await anonimo.inject({ method: "GET", url: `/items/${item.id}/label-file/versions/${versao.id}/download` })).statusCode,
      ).toBe(401);
      const envio = formulario([{ campo: "file", arquivo: { nome: "b.pdf", tipo: "application/pdf", conteudo: pdf() } }]);
      expect(
        (await anonimo.inject({ method: "POST", url: `/items/${item.id}/label-file/versions`, ...envio })).statusCode,
      ).toBe(401);
    } finally {
      await anonimo.close();
    }
  });

  it("objeto com tamanho diferente do registrado não é servido (500 storage_integrity_error)", async () => {
    const item = await criarItem();
    const versao = ((await enviar("ADMIN", item.id, { nome: "a.pdf", tipo: "application/pdf", conteudo: pdf() })).json() as ItemLabelFileResponse).current!;
    const [linha] = await versoesNoBanco(item.id);
    await writeFile(path.join(raiz, ...linha!.storageKey.split("/")), "conteúdo trocado por fora, com outro tamanho");

    const resposta = await baixar("ADMIN", item.id, versao.id);
    expect(resposta.statusCode).toBe(500);
    expect(resposta.json()).toMatchObject({ error: "storage_integrity_error" });
  });

  it("Item inexistente: 404 na consulta", async () => {
    const resposta = await app("VIEWER").inject({
      method: "GET",
      url: "/items/00000000-0000-0000-0000-000000000000/label-file",
    });
    expect(resposta.statusCode).toBe(404);
  });
});

describe("LABEL-ATTACHMENTS-01 — perfis", () => {
  it.each(PERFIS)("%s: envia só se estiver na lista; consulta e baixa sempre", async (role) => {
    const item = await criarItem();
    const base = ((await enviar("ADMIN", item.id, { nome: "base.pdf", tipo: "application/pdf", conteudo: pdf() })).json() as ItemLabelFileResponse).current!;

    const resposta = await enviar(role, item.id, { nome: "perfil.pdf", tipo: "application/pdf", conteudo: pdf() });
    const pode = ITEM_LABEL_FILE_UPLOAD_ROLES.includes(role);
    expect(resposta.statusCode, resposta.body).toBe(pode ? 201 : 403);
    if (!pode) expect(resposta.json()).toMatchObject({ error: "forbidden" });
    expect(await versoesNoBanco(item.id)).toHaveLength(pode ? 2 : 1);
    expect(await objetosDoItem(item.id)).toHaveLength(pode ? 2 : 1);

    expect((await app(role).inject({ method: "GET", url: `/items/${item.id}/label-file` })).statusCode).toBe(200);
    expect((await baixar(role, item.id, base.id)).statusCode).toBe(200);
  });

  it.each(PERFIS)("%s: anula só se for Qualidade ou Administrador", async (role) => {
    const item = await criarItem();
    const versao = ((await enviar("ADMIN", item.id, { nome: "a.pdf", tipo: "application/pdf", conteudo: pdf() })).json() as ItemLabelFileResponse).current!;

    const resposta = await anular(role, item.id, versao.id, "Motivo do teste de perfil");
    const pode = ITEM_LABEL_FILE_VOID_ROLES.includes(role);
    expect(resposta.statusCode, resposta.body).toBe(pode ? 200 : 403);
    expect((await versoesNoBanco(item.id))[0]?.voidedAt === null).toBe(!pode);
  });

  it.each(PERFIS)("%s: restaura só se estiver na lista", async (role) => {
    const item = await criarItem();
    const v1 = ((await enviar("ADMIN", item.id, { nome: "v1.pdf", tipo: "application/pdf", conteudo: pdf() })).json() as ItemLabelFileResponse).current!;
    await enviar("ADMIN", item.id, { nome: "v2.pdf", tipo: "application/pdf", conteudo: pdf() });

    const resposta = await restaurar(role, item.id, v1.id);
    const pode = ITEM_LABEL_FILE_RESTORE_ROLES.includes(role);
    expect(resposta.statusCode, resposta.body).toBe(pode ? 201 : 403);
    expect(await versoesNoBanco(item.id)).toHaveLength(pode ? 3 : 2);
  });

  it("sem permissão, Item inexistente responde 403 — nunca 404, nem 400 do corpo", async () => {
    const inexistente = "00000000-0000-0000-0000-000000000000";
    const envio = await enviar("VIEWER", inexistente, { nome: "a.pdf", tipo: "application/pdf", conteudo: pdf() });
    expect(envio.statusCode).toBe(403);
    expect((await anular("COMMERCIAL", inexistente, inexistente)).statusCode).toBe(403);
    expect((await restaurar("PRODUCTION", inexistente, inexistente)).statusCode).toBe(403);
  });

  it("com permissão, Item inexistente é 404 antes de ler o arquivo", async () => {
    const envio = await enviar("PURCHASING", "00000000-0000-0000-0000-000000000000", {
      nome: "a.pdf",
      tipo: "application/pdf",
      conteudo: pdf(),
    });
    expect(envio.statusCode).toBe(404);
  });
});
