import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import type { CoaReviewResultDTO, QualityQueueResponse, QualityQueueRowDTO } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { getOnHandByLots, isLotExpired } from "../../lib/inventory-ledger.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageMeta, slicePage } from "../../lib/pagination.js";
import { LotNotFoundError } from "../lots/lots.errors.js";
import {
  CoaAlreadyApprovedError,
  CoaNotRequiredError,
  MissingCoaDocumentError,
  MissingRejectionReasonError,
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

/**
 * Fila operacional da Qualidade — READ MODEL sobre `Lot` + ledger. Sem
 * entidade nova: a fila é uma leitura do que já existe.
 */
export async function listQualityQueue(
  query: ListQualityQueueQuery,
  pagination: Pagination = query,
): Promise<QualityQueueResponse> {
  const prisma = getPrisma();

  const lots = await prisma.lot.findMany({
    where: {
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.ownerCustomerId ? { ownerCustomerId: query.ownerCustomerId } : {}),
      ...(query.lotStatus ? { status: query.lotStatus } : {}),
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
    },
    include: { item: true, supplier: true, ownerCustomer: true, receiptLine: { include: { receipt: true } } },
    // Pendência documental primeiro; depois o lote mais antigo.
    orderBy: [{ coaStatus: "asc" }, { code: "asc" }],
  });

  const onHandByLot = await getOnHandByLots(prisma, lots.map((lot) => lot.id));

  const rows: QualityQueueRowDTO[] = [];
  for (const lot of lots) {
    const onHand = onHandByLot.get(lot.id) ?? new Prisma.Decimal(0);
    if (query.onlyWithBalance && onHand.lessThanOrEqualTo(0)) continue;

    rows.push({
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
    });
  }

  return { rows: slicePage(rows, pagination), ...pageMeta(pagination, rows.length) };
}
