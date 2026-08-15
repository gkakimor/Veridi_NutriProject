import type { Item, Lot, PurchaseOrder, Receipt, ReceiptLine, Supplier } from "@prisma/client";
import type { LotDTO, LotListResponse } from "@veridi/shared";
import { LOT_QR_PREFIX, normalizeLotLookupCode } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { InvalidLotTransitionError, LotNotFoundError } from "./lots.errors.js";
import type { ListLotsQuery } from "./lots.schemas.js";

/** Sem autenticacao/Usuarios no MVP ainda — mesma string ja usada na topbar. */
const SYSTEM_ACTOR = "Ambiente local";

type ReceiptLineChain = ReceiptLine & { receipt: Receipt & { purchaseOrder: PurchaseOrder } };
type LotWithRelations = Lot & {
  item: Item;
  supplier: Supplier;
  receiptLine: ReceiptLineChain | null;
};

const lotInclude = {
  item: true,
  supplier: true,
  receiptLine: { include: { receipt: { include: { purchaseOrder: true } } } },
} as const;

function toLotDTO(lot: LotWithRelations): LotDTO {
  const receiptLine = lot.receiptLine;
  const isExpired = lot.expiryDate ? lot.expiryDate.getTime() < Date.now() : false;

  return {
    id: lot.id,
    code: lot.code,
    qrPayload: `${LOT_QR_PREFIX}${lot.code}`,
    itemId: lot.itemId,
    itemCode: lot.item.code,
    itemName: lot.item.name,
    unitCode: receiptLine ? receiptLine.unitCode : lot.item.unitCode,
    supplierId: lot.supplierId,
    supplierCode: lot.supplier.code,
    supplierName: lot.supplier.legalName,
    supplierLot: lot.supplierLot,
    expiryDate: lot.expiryDate ? lot.expiryDate.toISOString() : null,
    isExpired,
    initialReceivedQuantity: lot.initialReceivedQuantity.toString(),
    status: lot.status,
    location: lot.location,
    receiptId: receiptLine ? receiptLine.receiptId : "",
    receiptCode: receiptLine ? receiptLine.receipt.code : "",
    purchaseOrderId: receiptLine ? receiptLine.receipt.purchaseOrderId : "",
    purchaseOrderCode: receiptLine ? receiptLine.receipt.purchaseOrder.code : "",
    createdAt: lot.createdAt.toISOString(),
    createdBy: lot.createdBy,
    releasedAt: lot.releasedAt ? lot.releasedAt.toISOString() : null,
    releasedBy: lot.releasedBy,
    blockedAt: lot.blockedAt ? lot.blockedAt.toISOString() : null,
    blockedBy: lot.blockedBy,
    blockReason: lot.blockReason,
  };
}

async function requireLot(id: string): Promise<Lot> {
  const lot = await getPrisma().lot.findUnique({ where: { id } });
  if (!lot) throw new LotNotFoundError(id);
  return lot;
}

export async function listLots(query: ListLotsQuery): Promise<LotListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.itemId) where["itemId"] = query.itemId;
  if (query.supplierId) where["supplierId"] = query.supplierId;
  if (query.status) where["status"] = query.status;
  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { supplierLot: { contains: query.search, mode: "insensitive" } },
      { item: { is: { code: { contains: query.search, mode: "insensitive" } } } },
      { item: { is: { name: { contains: query.search, mode: "insensitive" } } } },
    ];
  }

  const [lots, total] = await Promise.all([
    prisma.lot.findMany({
      where,
      include: lotInclude,
      orderBy: { code: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.lot.count({ where }),
  ]);

  return {
    lots: lots.map(toLotDTO),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getLotById(id: string): Promise<LotDTO | null> {
  const lot = await getPrisma().lot.findUnique({ where: { id }, include: lotInclude });
  return lot ? toLotDTO(lot) : null;
}

/**
 * Resolve um codigo escaneado/digitado para o lote interno. Aceita o
 * codigo puro (`LT-...`) ou o payload completo do QR (`LOT:LT-...`);
 * nunca casa por `supplierLot` — QR e busca de lote sao sempre pelo
 * codigo interno. So faz leitura: um codigo inventado nunca cria/altera nada.
 */
export async function lookupLotByCode(rawCode: string): Promise<LotDTO | null> {
  const normalized = normalizeLotLookupCode(rawCode);
  if (!normalized) return null;

  const lot = await getPrisma().lot.findUnique({
    where: { code: normalized },
    include: lotInclude,
  });
  return lot ? toLotDTO(lot) : null;
}

export async function releaseLot(id: string): Promise<LotDTO> {
  const lot = await requireLot(id);
  if (lot.status !== "AWAITING_RELEASE") {
    throw new InvalidLotTransitionError(
      "Somente lotes aguardando liberação podem ser liberados.",
    );
  }

  await getPrisma().lot.update({
    where: { id },
    data: { status: "AVAILABLE", releasedAt: new Date(), releasedBy: SYSTEM_ACTOR },
  });

  return (await getLotById(id))!;
}

export async function blockLot(id: string, reason: string): Promise<LotDTO> {
  const lot = await requireLot(id);
  if (lot.status !== "AWAITING_RELEASE" && lot.status !== "AVAILABLE") {
    throw new InvalidLotTransitionError(
      "Somente lotes aguardando liberação ou disponíveis podem ser bloqueados.",
    );
  }

  await getPrisma().lot.update({
    where: { id },
    data: {
      status: "BLOCKED",
      blockedAt: new Date(),
      blockedBy: SYSTEM_ACTOR,
      blockReason: reason,
    },
  });

  return (await getLotById(id))!;
}
