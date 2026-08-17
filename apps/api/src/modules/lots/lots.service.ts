import { Prisma } from "@prisma/client";
import type {
  Customer,
  Item,
  Lot,
  ProductionOrder,
  PurchaseOrder,
  Receipt,
  ReceiptLine,
  Supplier,
} from "@prisma/client";
import type { LotDTO, LotListResponse } from "@veridi/shared";
import { LOT_QR_PREFIX, normalizeLotLookupCode } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import {
  getOnHandByLots,
  getReservedByLots,
  isLotAvailableForUse,
  isLotExpired,
} from "../../lib/inventory-ledger.js";
import { CoaNotApprovedError } from "../quality/quality.errors.js";
import { InvalidLotTransitionError, LotNotFoundError } from "./lots.errors.js";
import type { ListLotsQuery } from "./lots.schemas.js";

/** Sem autenticacao/Usuarios no MVP ainda — mesma string ja usada na topbar. */
const SYSTEM_ACTOR = "Ambiente local";

/** Recebimento de material do cliente nao tem OC — a cadeia para no Receipt. */
type ReceiptLineChain = ReceiptLine & { receipt: Receipt & { purchaseOrder: PurchaseOrder | null } };
type LotWithRelations = Lot & {
  item: Item;
  supplier: Supplier | null;
  ownerCustomer: Customer | null;
  receiptLine: ReceiptLineChain | null;
  productionOrder: ProductionOrder | null;
};

const lotInclude = {
  item: true,
  supplier: true,
  ownerCustomer: true,
  receiptLine: { include: { receipt: { include: { purchaseOrder: true } } } },
  productionOrder: true,
} as const;

type LotDTOWithoutStock = Omit<LotDTO, "onHand" | "reserved" | "available">;

function toLotDTO(lot: LotWithRelations, producedQuantity: Prisma.Decimal | null): LotDTOWithoutStock {
  const receiptLine = lot.receiptLine;

  return {
    id: lot.id,
    code: lot.code,
    qrPayload: `${LOT_QR_PREFIX}${lot.code}`,
    origin: lot.origin,
    itemId: lot.itemId,
    itemCode: lot.item.code,
    itemName: lot.item.name,
    unitCode: receiptLine ? receiptLine.unitCode : lot.item.unitCode,
    // Estado DOCUMENTAL — independente do status operacional do lote.
    requiresCoa: lot.requiresCoaSnapshot,
    coaStatus: lot.coaStatus,
    coaReviewedAt: lot.coaReviewedAt ? lot.coaReviewedAt.toISOString() : null,
    coaReviewedByName: lot.coaReviewedByNameSnapshot,
    coaReviewNote: lot.coaReviewNote,
    // Dono do estoque fisico — nunca confundido com Fornecedor.
    ownerType: lot.ownerType,
    ownerCustomerId: lot.ownerCustomerId,
    ownerCustomerCode: lot.ownerCustomer ? lot.ownerCustomer.code : null,
    ownerCustomerName: lot.ownerCustomer ? lot.ownerCustomer.legalName : null,
    supplierId: lot.supplierId,
    supplierCode: lot.supplier ? lot.supplier.code : null,
    supplierName: lot.supplier ? lot.supplier.legalName : null,
    supplierLot: lot.supplierLot,
    businessLotNumber: lot.businessLotNumber,
    expiryDate: lot.expiryDate ? lot.expiryDate.toISOString() : null,
    isExpired: isLotExpired(lot),
    initialReceivedQuantity: lot.initialReceivedQuantity.toString(),
    producedQuantity: lot.origin === "PRODUCTION" ? (producedQuantity ?? new Prisma.Decimal(0)).toString() : null,
    status: lot.status,
    location: lot.location,
    receiptId: receiptLine ? receiptLine.receiptId : null,
    receiptCode: receiptLine ? receiptLine.receipt.code : null,
    purchaseOrderId: receiptLine ? receiptLine.receipt.purchaseOrderId : null,
    purchaseOrderCode: receiptLine?.receipt.purchaseOrder?.code ?? null,
    productionOrderId: lot.productionOrderId,
    productionOrderCode: lot.productionOrder ? lot.productionOrder.code : null,
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
 * `producedQuantity` (so origin=PRODUCTION) e a soma dos ProductionOutput
 * do lote — quantidade produzida acumulada, nunca confundida com saldo
 * atual. Versao em lote evita N+1 em listagens.
 */
async function attachStock(lots: LotWithRelations[]): Promise<LotDTO[]> {
  const prisma = getPrisma();
  const lotIds = lots.map((lot) => lot.id);
  const productionLotIds = lots.filter((lot) => lot.origin === "PRODUCTION").map((lot) => lot.id);

  const [onHandByLot, reservedByLot, outputSums] = await Promise.all([
    getOnHandByLots(prisma, lotIds),
    getReservedByLots(prisma, lotIds),
    productionLotIds.length > 0
      ? prisma.productionOutput.groupBy({
          by: ["lotId"],
          where: { lotId: { in: productionLotIds } },
          _sum: { quantity: true },
        })
      : Promise.resolve([]),
  ]);
  const producedByLot = new Map<string, Prisma.Decimal>();
  for (const row of outputSums) {
    if (row.lotId) producedByLot.set(row.lotId, row._sum.quantity ?? new Prisma.Decimal(0));
  }

  return lots.map((lot) => {
    const dto = toLotDTO(lot, producedByLot.get(lot.id) ?? null);
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

export async function listLots(
  query: ListLotsQuery,
  pagination: Pagination = query,): Promise<LotListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.itemId) where["itemId"] = query.itemId;
  if (query.supplierId) where["supplierId"] = query.supplierId;
  // Filtro de propriedade: a lista continua mostrando o estoque fisico
  // inteiro por padrao (visibilidade), o filtro e escolha do usuario.
  if (query.ownerType) where["ownerType"] = query.ownerType;
  if (query.coaStatus) where["coaStatus"] = query.coaStatus;
  if (query.ownerCustomerId) where["ownerCustomerId"] = query.ownerCustomerId;
  if (query.status) where["status"] = query.status;
  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { supplierLot: { contains: query.search, mode: "insensitive" } },
      // O número que a operação lê na etiqueta é o lote comercial; sem ele
      // aqui, procurar pelo que está impresso não achava nada.
      { businessLotNumber: { contains: query.search, mode: "insensitive" } },
      { item: { is: { code: { contains: query.search, mode: "insensitive" } } } },
      { item: { is: { name: { contains: query.search, mode: "insensitive" } } } },
    ];
  }

  const [lots, total] = await Promise.all([
    prisma.lot.findMany({
      where,
      include: lotInclude,
      orderBy: { code: "desc" },
      ...pageArgs(pagination),
    }),
    prisma.lot.count({ where }),
  ]);

  return {
    lots: await attachStock(lots),
    ...pageMeta(pagination, total),
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

  const prisma = getPrisma();
  let lot = await prisma.lot.findUnique({ where: { code: normalized }, include: lotInclude });

  if (!lot) {
    // O código impresso na etiqueta é o lote comercial. Só resolve quando é
    // inequívoco: com mais de um lote no mesmo número, abrir "algum" seria
    // apontar a operação para o lote errado — a lista de Lotes resolve esse
    // caso, porque a busca dela também cobre o número comercial.
    const byBusinessLot = await prisma.lot.findMany({
      where: { businessLotNumber: { equals: normalized, mode: "insensitive" } },
      include: lotInclude,
      take: 2,
    });
    if (byBusinessLot.length !== 1) return null;
    lot = byBusinessLot[0]!;
  }

  const [dto] = await attachStock([lot]);
  return dto!;
}

export async function releaseLot(id: string, actorName?: string): Promise<LotDTO> {
  const lot = await requireLot(id);
  if (lot.status !== "AWAITING_RELEASE") {
    throw new InvalidLotTransitionError(
      "Somente lotes aguardando liberação podem ser liberados.",
    );
  }
  // Invariante documental: lote que exige laudo só é liberado com CoA
  // aprovado. Vale para qualquer perfil — não existe bypass silencioso.
  if (lot.requiresCoaSnapshot && lot.coaStatus !== "APPROVED") {
    throw new CoaNotApprovedError();
  }

  await getPrisma().lot.update({
    where: { id },
    data: {
      status: "AVAILABLE",
      releasedAt: new Date(),
      releasedBy: actorName ?? SYSTEM_ACTOR,
    },
  });

  return (await getLotById(id))!;
}

export async function blockLot(
  id: string,
  reason: string,
  actorName?: string,
): Promise<LotDTO> {
  const lot = await requireLot(id);
  if (lot.status !== "AWAITING_RELEASE" && lot.status !== "AVAILABLE") {
    throw new InvalidLotTransitionError(
      "Somente lotes aguardando liberação ou disponíveis podem ser bloqueados.",
    );
  }

  // Uma OP RELEASED ou um Pedido do Cliente pode estar contando com este
  // lote — bloquear agora corromperia a reserva ativa. `getReservedByLots`
  // ja cobre os dois compromissos (MaterialReservation de producao e
  // CustomerOrderReservation de produto acabado), liquidos de consumo/
  // expedicao — nunca checar so um deles. Nao cancela nada em cascata.
  const reserved = (await getReservedByLots(getPrisma(), [id])).get(id) ?? new Prisma.Decimal(0);
  if (reserved.greaterThan(0)) {
    throw new InvalidLotTransitionError(
      "Este lote possui quantidade reservada — não pode ser bloqueado nesta fase.",
    );
  }

  await getPrisma().lot.update({
    where: { id },
    data: {
      status: "BLOCKED",
      blockedAt: new Date(),
      blockedBy: actorName ?? SYSTEM_ACTOR,
      blockReason: reason,
    },
  });

  return (await getLotById(id))!;
}
