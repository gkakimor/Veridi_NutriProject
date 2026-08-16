import { Prisma } from "@prisma/client";
import type { Item, Lot, PurchaseOrder, Receipt, ReceiptLine, Supplier } from "@prisma/client";
import type { LotDTO, LotListResponse } from "@veridi/shared";
import { LOT_QR_PREFIX, normalizeLotLookupCode } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import {
  getOnHandByLots,
  getReservedByLots,
  isLotAvailableForUse,
  isLotExpired,
} from "../../lib/inventory-ledger.js";
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

type LotDTOWithoutStock = Omit<LotDTO, "onHand" | "reserved" | "available">;

function toLotDTO(lot: LotWithRelations): LotDTOWithoutStock {
  const receiptLine = lot.receiptLine;

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
    isExpired: isLotExpired(lot),
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

/**
 * On Hand/Reserved/Available do lote, derivados do InventoryMovement
 * ledger e das MaterialReservationLine ACTIVE — nunca colunas em Lot.
 * Versao em lote evita N+1 em listagens.
 */
async function attachStock(lots: LotWithRelations[]): Promise<LotDTO[]> {
  const prisma = getPrisma();
  const lotIds = lots.map((lot) => lot.id);
  const [onHandByLot, reservedByLot] = await Promise.all([
    getOnHandByLots(prisma, lotIds),
    getReservedByLots(prisma, lotIds),
  ]);

  return lots.map((lot) => {
    const dto = toLotDTO(lot);
    const onHand = onHandByLot.get(lot.id) ?? new Prisma.Decimal(0);
    const reserved = reservedByLot.get(lot.id) ?? new Prisma.Decimal(0);
    const available = isLotAvailableForUse(lot)
      ? Prisma.Decimal.max(onHand.minus(reserved), 0)
      : new Prisma.Decimal(0);
    return {
      ...dto,
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: available.toString(),
    };
  });
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
    lots: await attachStock(lots),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getLotById(id: string): Promise<LotDTO | null> {
  const lot = await getPrisma().lot.findUnique({ where: { id }, include: lotInclude });
  if (!lot) return null;
  const [dto] = await attachStock([lot]);
  return dto!;
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
  if (!lot) return null;
  const [dto] = await attachStock([lot]);
  return dto!;
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

  // Uma OP RELEASED pode estar contando com este lote — bloquear agora
  // corromperia a reserva ativa. Nao cancela a OP/reserva automaticamente.
  const reserved = (await getReservedByLots(getPrisma(), [id])).get(id) ?? new Prisma.Decimal(0);
  if (reserved.greaterThan(0)) {
    throw new InvalidLotTransitionError(
      "Este lote possui reservas ativas de Ordens de Produção — não pode ser bloqueado nesta fase.",
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
