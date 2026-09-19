import { Prisma } from "@prisma/client";
import type { PrismaClient, User } from "@prisma/client";
import type { CoaReviewResultDTO, QualityQueueResponse, QualityQueueRowDTO } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { getOnHandByLots, isLotExpired, lotIdsComSaldoPositivo, lotStatusWhere } from "../../lib/inventory-ledger.js";
import type { Pagination } from "../../lib/pagination.js";
import { ALL_ROWS, pageArgs, pageMeta } from "../../lib/pagination.js";
import { LotNotFoundError } from "../lots/lots.errors.js";
import {
  CoaAlreadyApprovedError,
  CoaNotRequiredError,
  MissingCoaDocumentError,
  MissingRejectionReasonError,
  QualityQueueTooLargeError,
} from "./quality.errors.js";
import type { ListQualityQueueQuery } from "./quality.schemas.js";

/**
 * Qualidade documental (laudo/CoA).
 *
 * Dois estados que NÃO se substituem: `Lot.status` é a qualidade
 * operacional (o lote pode ser usado?) e `Lot.coaStatus` é a situação
 * documental (o laudo chegou/foi aprovado?). Aprovar o CoA nunca libera o
 * lote sozinho — a liberação da Qualidade continua sendo ação explícita.
 *
 * Nada aqui movimenta estoque: aprovar, rejeitar ou anexar documento nunca
 * cria `InventoryMovement`, e On Hand nunca muda.
 */

const REJECTION_BLOCK_REASON = "CoA rejeitado";

/** Anexos COA ativos do lote — a contagem nunca é o status, só um requisito. */
async function countActiveCoaDocuments(lotId: string): Promise<number> {
  return getPrisma().attachment.count({
    where: { lotId, documentType: "COA", archivedAt: null },
  });
}

/**
 * Chamada após anexar/arquivar um COA. `PENDING -> RECEIVED` quando chega
 * documento; volta a `PENDING` se o último documento ativo for arquivado.
 * Nunca faz um CoA `APPROVED` regredir sozinho.
 */
export async function refreshCoaStatusAfterDocumentChange(lotId: string): Promise<void> {
  const prisma = getPrisma();
  const lot = await prisma.lot.findUnique({ where: { id: lotId } });
  if (!lot || !lot.requiresCoaSnapshot) return;
  if (lot.coaStatus === "APPROVED" || lot.coaStatus === "REJECTED") return;

  const active = await countActiveCoaDocuments(lotId);
  const nextStatus = active > 0 ? "RECEIVED" : "PENDING";
  if (lot.coaStatus !== nextStatus) {
    await prisma.lot.update({ where: { id: lotId }, data: { coaStatus: nextStatus } });
  }
}

export async function approveCoa(
  lotId: string,
  note: string | undefined,
  actor: User,
): Promise<CoaReviewResultDTO> {
  const prisma = getPrisma();
  const lot = await prisma.lot.findUnique({ where: { id: lotId } });
  if (!lot) throw new LotNotFoundError(lotId);
  if (!lot.requiresCoaSnapshot) throw new CoaNotRequiredError(lot.code);
  if (lot.coaStatus === "APPROVED") throw new CoaAlreadyApprovedError(lot.code);

  if ((await countActiveCoaDocuments(lotId)) === 0) throw new MissingCoaDocumentError();

  const updated = await prisma.lot.update({
    where: { id: lotId },
    data: {
      coaStatus: "APPROVED",
      coaReviewedAt: new Date(),
      // Quem revisou vem da sessão — nunca de nome enviado pelo cliente.
      coaReviewedByUserId: actor.id,
      coaReviewedByNameSnapshot: actor.name,
      coaReviewNote: note ?? null,
    },
  });

  return {
    lotId: updated.id,
    lotCode: updated.code,
    coaStatus: updated.coaStatus,
    // Aprovar documento NÃO libera o lote: a liberação continua explícita.
    lotStatus: updated.status,
    reviewedAt: updated.coaReviewedAt ? updated.coaReviewedAt.toISOString() : null,
    reviewedByName: updated.coaReviewedByNameSnapshot,
    reviewNote: updated.coaReviewNote,
  };
}

/**
 * Rejeitar exige motivo. Se o lote estiver operacionalmente disponível,
 * ele é bloqueado na mesma transação — documento reprovado não pode
 * conviver com estoque utilizável. Nenhum movimento de estoque é criado.
 */
export async function rejectCoa(
  lotId: string,
  reason: string,
  actor: User,
): Promise<CoaReviewResultDTO> {
  if (!reason.trim()) throw new MissingRejectionReasonError();

  const prisma = getPrisma();
  const lot = await prisma.lot.findUnique({ where: { id: lotId } });
  if (!lot) throw new LotNotFoundError(lotId);
  if (!lot.requiresCoaSnapshot) throw new CoaNotRequiredError(lot.code);

  const updated = await prisma.$transaction(async (tx) => {
    return tx.lot.update({
      where: { id: lotId },
      data: {
        coaStatus: "REJECTED",
        coaReviewedAt: new Date(),
        coaReviewedByUserId: actor.id,
        coaReviewedByNameSnapshot: actor.name,
        coaReviewNote: reason.trim(),
        ...(lot.status === "AVAILABLE"
          ? {
              status: "BLOCKED",
              blockedAt: new Date(),
              blockedBy: actor.name,
              blockReason: REJECTION_BLOCK_REASON,
            }
          : {}),
      },
    });
  });

  return {
    lotId: updated.id,
    lotCode: updated.code,
    coaStatus: updated.coaStatus,
    lotStatus: updated.status,
    reviewedAt: updated.coaReviewedAt ? updated.coaReviewedAt.toISOString() : null,
    reviewedByName: updated.coaReviewedByNameSnapshot,
    reviewNote: updated.coaReviewNote,
  };
}

/** O `where` de `Lot` que a fila da Qualidade seleciona. */
function filaDaQualidadeWhere(query: ListQualityQueueQuery): Prisma.LotWhereInput {
  return {
    ...(query.itemId ? { itemId: query.itemId } : {}),
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.ownerCustomerId ? { ownerCustomerId: query.ownerCustomerId } : {}),
    // "Vencido" é derivado da validade, nunca status gravado (D1).
    ...(query.lotStatus ? lotStatusWhere(query.lotStatus) : {}),
    /*
     * `coaStatus` explícito manda; senão, `onlyPending` é o recorte "exige
     * ação da Qualidade". Sem nenhum dos dois a fila mostra TUDO — é o
     * "Todos" da tela, que antes não existia: o `<select>` obrigava um
     * recorte documental e não havia como ver a fila inteira.
     */
    ...(query.coaStatus
      ? { coaStatus: query.coaStatus }
      : query.onlyPending
        ? { coaStatus: { in: ["PENDING", "RECEIVED", "REJECTED"] } }
        : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { supplierLot: { contains: query.search, mode: "insensitive" } },
            { item: { is: { code: { contains: query.search, mode: "insensitive" } } } },
            { item: { is: { name: { contains: query.search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
}

/**
 * Fila operacional da Qualidade — READ MODEL sobre `Lot` + ledger. Sem
 * entidade nova: a fila é uma leitura do que já existe.
 *
 * Paginada PELO BANCO. Antes, esta função lia a tabela de lotes inteira,
 * somava o ledger de cada linha e cortava a página em memória: o custo
 * crescia com a base e o `total` só estava certo porque tudo já havia sido
 * carregado. "Somente com saldo" era a razão da leitura completa — saldo não
 * é coluna de `Lot` —, e agora ela vira uma agregação sobre os movimentos
 * (`lotIdsComSaldoPositivo`) que devolve ids para o próprio `where`.
 */
export async function listQualityQueue(
  query: ListQualityQueueQuery,
  pagination: Pagination = query,
): Promise<QualityQueueResponse> {
  if (query.all) return filaInteiraNumRetrato(query);

  const prisma = getPrisma();
  const where = await whereComSaldo(prisma, query);

  const [lots, total] = await Promise.all([
    lotesDaFila(prisma, where, pageArgs(pagination)),
    prisma.lot.count({ where }),
  ]);

  const onHandByLot = await getOnHandByLots(prisma, lots.map((lot) => lot.id));
  return { rows: lots.map((lot) => linhaDaFila(lot, onHandByLot)), ...pageMeta(pagination, total) };
}

/**
 * Teto do recorte inteiro (`all=true`) — PAGED-DOCUMENT-SNAPSHOT-01.
 *
 * Quem pede tudo é documento: a folha FO-03 é papel para tratar pendência à
 * mão, e mil lotes já são dezenas de folhas. Acima disso a leitura recusa em
 * vez de devolver os primeiros mil com cara de todos.
 */
export const QUALITY_QUEUE_ALL_ROWS_LIMIT = 1000;

/**
 * O recorte INTEIRO num retrato só do banco (PAGED-DOCUMENT-SNAPSHOT-01).
 *
 * A folha FO-03 lia página por página por deslocamento: uma pendência que
 * saía da fila antes do deslocamento, somada a outra que entrava depois dele,
 * mantinha o `total` e escondia um lote sem aviso. Aqui o conjunto sai de UMA
 * leitura, dentro de uma transação `RepeatableRead`: o saldo dos lotes e o
 * "somente com saldo" enxergam o mesmo instante que a lista.
 *
 * Um a mais que o teto: passar dele se sabe sem contar a fila inteira, e
 * passar dele recusa — nunca os primeiros N.
 */
async function filaInteiraNumRetrato(query: ListQualityQueueQuery): Promise<QualityQueueResponse> {
  const { lots, onHandByLot } = await getPrisma().$transaction(
    async (tx) => {
      const where = await whereComSaldo(tx, query);
      const lotes = await lotesDaFila(tx, where, { take: QUALITY_QUEUE_ALL_ROWS_LIMIT + 1 });
      if (lotes.length > QUALITY_QUEUE_ALL_ROWS_LIMIT) {
        throw new QualityQueueTooLargeError(QUALITY_QUEUE_ALL_ROWS_LIMIT);
      }
      return { lots: lotes, onHandByLot: await getOnHandByLots(tx, lotes.map((lot) => lot.id)) };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 },
  );

  return { rows: lots.map((lot) => linhaDaFila(lot, onHandByLot)), ...pageMeta(ALL_ROWS, lots.length) };
}

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/** O `where` da fila, com "somente com saldo" resolvido pelo banco na mesma conexão. */
async function whereComSaldo(prisma: PrismaOrTx, query: ListQualityQueueQuery): Promise<Prisma.LotWhereInput> {
  const base = filaDaQualidadeWhere(query);
  return query.onlyWithBalance ? { ...base, id: { in: await lotIdsComSaldoPositivo(prisma, base) } } : base;
}

function lotesDaFila(prisma: PrismaOrTx, where: Prisma.LotWhereInput, corte: { skip?: number; take?: number }) {
  return prisma.lot.findMany({
    where,
    include: { item: true, supplier: true, ownerCustomer: true, receiptLine: { include: { receipt: true } } },
    // Pendência documental primeiro; depois o lote mais antigo.
    orderBy: [{ coaStatus: "asc" }, { code: "asc" }],
    ...corte,
  });
}

function linhaDaFila(
  lot: Awaited<ReturnType<typeof lotesDaFila>>[number],
  onHandByLot: Map<string, Prisma.Decimal>,
): QualityQueueRowDTO {
  const onHand = onHandByLot.get(lot.id) ?? new Prisma.Decimal(0);
  return {
    lotId: lot.id,
    lotCode: lot.code,
    itemId: lot.itemId,
    itemCode: lot.item.code,
    itemName: lot.item.name,
    sourceName: lot.item.sourceName,
    declaredNutrient: lot.item.declaredNutrient,
    lotOrigin: lot.origin,
    supplierName: lot.supplier ? lot.supplier.legalName : null,
    ownerType: lot.ownerType,
    ownerCustomerName: lot.ownerCustomer ? lot.ownerCustomer.legalName : null,
    receivedAt: lot.receiptLine?.receipt.receivedAt.toISOString() ?? lot.createdAt.toISOString(),
    expiryDate: lot.expiryDate ? lot.expiryDate.toISOString() : null,
    isExpired: isLotExpired(lot),
    requiresCoa: lot.requiresCoaSnapshot,
    coaStatus: lot.coaStatus,
    coaReviewedByName: lot.coaReviewedByNameSnapshot,
    coaReviewNote: lot.coaReviewNote,
    lotStatus: lot.status,
    onHand: onHand.toString(),
    unitCode: lot.item.unitCode,
  };
}
