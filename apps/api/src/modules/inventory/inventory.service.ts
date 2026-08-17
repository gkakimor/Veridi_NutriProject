import { Prisma } from "@prisma/client";
import type { Item, InventoryMovement, Lot, ReceiptLine, Receipt, PurchaseOrder } from "@prisma/client";
import type {
  InventoryItemDetailDTO,
  InventoryItemSummaryDTO,
  InventoryListResponse,
  InventoryLotBreakdownDTO,
  InventoryMovementDTO,
  InventoryMovementListResponse,
  InventoryMovementSourceType,
  StockCountResultDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta, slicePage } from "../../lib/pagination.js";
import {
  getAvailableByItems,
  getOnHand,
  getOnHandByItems,
  getOnHandByLots,
  getOnOrderByItems,
  getReservedByItems,
  getReservedByLots,
  isLotAvailableForUse,
  isLotExpired,
} from "../../lib/inventory-ledger.js";
import {
  CountBelowReservedError,
  InsufficientStockError,
  ItemNotFoundError,
  LotItemMismatchError,
  LotNotFoundError,
  MissingCountReasonError,
  MissingLotError,
  UnexpectedLotError,
} from "./inventory.errors.js";
import type {
  CreateInventoryAdjustmentInput,
  ListInventoryMovementsQuery,
  ListInventoryQuery,
  StockCountInput,
} from "./inventory.schemas.js";

/** Sem autenticacao/Usuarios no MVP ainda — mesma string ja usada na topbar. */
const SYSTEM_ACTOR = "Ambiente local";

/** Recebimento de material do cliente nao tem OC — a cadeia para no Receipt. */
type ReceiptLineChain = ReceiptLine & { receipt: Receipt & { purchaseOrder: PurchaseOrder | null } };
type ShipmentLineChain = { shipment: { id: string; code: string } };
type MovementWithRelations = InventoryMovement & {
  item: Item;
  lot: Lot | null;
  receiptLine: ReceiptLineChain | null;
  shipmentLine: ShipmentLineChain | null;
};

const movementInclude = {
  item: true,
  lot: true,
  receiptLine: { include: { receipt: { include: { purchaseOrder: true } } } },
  shipmentLine: { include: { shipment: true } },
} as const;

function toMovementDTO(movement: MovementWithRelations): InventoryMovementDTO {
  const receiptLine = movement.receiptLine;
  const shipmentLine = movement.shipmentLine;
  return {
    id: movement.id,
    itemId: movement.itemId,
    itemCode: movement.item.code,
    itemName: movement.item.name,
    unitCode: movement.item.unitCode,
    lotId: movement.lotId,
    lotCode: movement.lot ? movement.lot.code : null,
    type: movement.type,
    quantity: movement.quantity.toString(),
    occurredAt: movement.occurredAt.toISOString(),
    sourceType: movement.sourceType,
    sourceId: movement.sourceId,
    receiptId: receiptLine ? receiptLine.receiptId : null,
    receiptCode: receiptLine ? receiptLine.receipt.code : null,
    purchaseOrderId: receiptLine ? receiptLine.receipt.purchaseOrderId : null,
    purchaseOrderCode: receiptLine?.receipt.purchaseOrder?.code ?? null,
    shipmentId: shipmentLine ? shipmentLine.shipment.id : null,
    shipmentCode: shipmentLine ? shipmentLine.shipment.code : null,
    reason: movement.reason,
    createdBy: movement.createdBy,
    createdAt: movement.createdAt.toISOString(),
  };
}

async function getMovementById(id: string): Promise<InventoryMovementDTO | null> {
  const movement = await getPrisma().inventoryMovement.findUnique({
    where: { id },
    include: movementInclude,
  });
  return movement ? toMovementDTO(movement) : null;
}

/** Resumo de disponibilidade para um lote de itens — usado por listagem e detalhe. */
async function buildItemSummaries(
  prisma: ReturnType<typeof getPrisma>,
  items: Item[],
): Promise<InventoryItemSummaryDTO[]> {
  const itemIds = items.map((item) => item.id);
  const [onHandByItem, onOrderByItem, availableByItem, reservedByItem] = await Promise.all([
    getOnHandByItems(prisma, itemIds),
    getOnOrderByItems(prisma, itemIds),
    getAvailableByItems(prisma, items),
    getReservedByItems(prisma, itemIds),
  ]);

  return items.map((item) => {
    const onHand = onHandByItem.get(item.id) ?? new Prisma.Decimal(0);
    const onOrder = onOrderByItem.get(item.id) ?? new Prisma.Decimal(0);
    const available = availableByItem.get(item.id) ?? new Prisma.Decimal(0);
    const reserved = reservedByItem.get(item.id) ?? new Prisma.Decimal(0);

    return {
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      itemType: item.type,
      unitCode: item.unitCode,
      controlsLot: item.controlsLot,
      onHand: onHand.toString(),
      reserved: reserved.toString(),
      available: available.toString(),
      onOrder: onOrder.toString(),
    };
  });
}

export async function listInventory(
  query: ListInventoryQuery,
  pagination: Pagination = query,
): Promise<InventoryListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = { active: true };

  if (query.type) where["type"] = query.type;
  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { name: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const items = await prisma.item.findMany({ where, orderBy: { code: "asc" } });
  const summaries = await buildItemSummaries(prisma, items);

  const hasPosition = (summary: (typeof summaries)[number]) =>
    new Prisma.Decimal(summary.onHand).greaterThan(0) ||
    new Prisma.Decimal(summary.reserved).greaterThan(0) ||
    new Prisma.Decimal(summary.onOrder).greaterThan(0);

  // Sem filtro, quem tem posição vem primeiro: ordenado só por código, a
  // primeira página do estoque real fica coberta por itens zerados e o
  // módulo parece vazio. Nada é escondido — a ordem dentro de cada grupo
  // continua por código.
  const filtered = query.onlyWithStock
    ? summaries.filter((summary) => new Prisma.Decimal(summary.onHand).greaterThan(0))
    : [...summaries].sort((a, b) => Number(hasPosition(b)) - Number(hasPosition(a)));

  return { items: slicePage(filtered, pagination), ...pageMeta(pagination, filtered.length) };
}

export async function getInventoryByItemId(itemId: string): Promise<InventoryItemDetailDTO | null> {
  const prisma = getPrisma();
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) return null;

  const [summary] = await buildItemSummaries(prisma, [item]);

  let lots: InventoryLotBreakdownDTO[] = [];
  if (item.controlsLot) {
    const itemLots = await prisma.lot.findMany({ where: { itemId } });
    const lotIds = itemLots.map((lot) => lot.id);
    const [onHandByLot, reservedByLot] = await Promise.all([
      getOnHandByLots(prisma, lotIds),
      getReservedByLots(prisma, lotIds),
    ]);

    lots = itemLots
      .map((lot): InventoryLotBreakdownDTO => {
        const onHand = onHandByLot.get(lot.id) ?? new Prisma.Decimal(0);
        const reserved = reservedByLot.get(lot.id) ?? new Prisma.Decimal(0);
        const eligible = isLotAvailableForUse(lot);
        const available = eligible ? Prisma.Decimal.max(onHand.minus(reserved), 0) : new Prisma.Decimal(0);
        return {
          lotId: lot.id,
          lotCode: lot.code,
          expiryDate: lot.expiryDate ? lot.expiryDate.toISOString() : null,
          isExpired: isLotExpired(lot),
          location: lot.location,
          status: lot.status,
          onHand: onHand.toString(),
          reserved: reserved.toString(),
          available: available.toString(),
        };
      })
      // Apresentacao (validade ascendente, sem validade por ultimo, depois
      // codigo) — NAO e a regra operacional de FEFO, que fica para o
      // proximo modulo.
      .sort((a, b) => {
        if (a.expiryDate && b.expiryDate) return a.expiryDate.localeCompare(b.expiryDate);
        if (a.expiryDate) return -1;
        if (b.expiryDate) return 1;
        return a.lotCode.localeCompare(b.lotCode);
      });
  }

  return { ...summary!, lots };
}

export async function listInventoryMovements(
  query: ListInventoryMovementsQuery,
  pagination: Pagination = query,
): Promise<InventoryMovementListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.itemId) where["itemId"] = query.itemId;
  if (query.lotId) where["lotId"] = query.lotId;
  if (query.type) where["type"] = query.type;
  if (query.search) {
    where["OR"] = [
      { item: { is: { code: { contains: query.search, mode: "insensitive" } } } },
      { item: { is: { name: { contains: query.search, mode: "insensitive" } } } },
      { lot: { is: { code: { contains: query.search, mode: "insensitive" } } } },
    ];
  }

  const [movements, total] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      include: movementInclude,
      orderBy: { occurredAt: "desc" },
      ...pageArgs(pagination),
    }),
    prisma.inventoryMovement.count({ where }),
  ]);

  return {
    movements: movements.map(toMovementDTO),
    ...pageMeta(pagination, total),
  };
}

/** Valida item/lote e retorna o lote resolvido (ou null quando o item nao controla lote). */
async function resolveItemAndLot(
  itemId: string,
  lotId: string | undefined,
): Promise<{ item: Item; lot: Lot | null }> {
  const prisma = getPrisma();
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) throw new ItemNotFoundError(itemId);

  if (item.controlsLot && !lotId) throw new MissingLotError(item.code);
  if (!item.controlsLot && lotId) throw new UnexpectedLotError(item.code);

  let lot: Lot | null = null;
  if (lotId) {
    lot = await prisma.lot.findUnique({ where: { id: lotId } });
    if (!lot) throw new LotNotFoundError(lotId);
    if (lot.itemId !== item.id) throw new LotItemMismatchError(lotId, item.id);
  }

  return { item, lot };
}

/**
 * Trava a linha que representa o escopo do saldo (lote, ou item quando nao
 * ha controle de lote) — mesmo padrao de `SELECT ... FOR UPDATE` do
 * Recebimento, agora contra corrida entre saidas/perdas concorrentes no
 * mesmo escopo.
 */
async function lockStockScope(
  tx: Prisma.TransactionClient,
  scope: { itemId: string; lotId: string | null },
): Promise<void> {
  if (scope.lotId) {
    await tx.$queryRaw`SELECT id FROM lots WHERE id = ${scope.lotId} FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT id FROM items WHERE id = ${scope.itemId} FOR UPDATE`;
  }
}

export async function createInventoryAdjustment(
  input: CreateInventoryAdjustmentInput,
): Promise<InventoryMovementDTO> {
  const { item, lot } = await resolveItemAndLot(input.itemId, input.lotId);

  const quantity = new Prisma.Decimal(input.quantity);
  const isOutbound = input.type === "ADJUSTMENT_OUT" || input.type === "LOSS";
  const sourceType: InventoryMovementSourceType =
    input.type === "LOSS" ? "MANUAL_LOSS" : "MANUAL_ADJUSTMENT";

  const movementId = await getPrisma().$transaction(async (tx) => {
    await lockStockScope(tx, { itemId: item.id, lotId: lot ? lot.id : null });

    if (isOutbound) {
      const onHand = await getOnHand(tx, { itemId: item.id, lotId: input.lotId ?? null });
      const reserved = lot
        ? ((await getReservedByLots(tx, [lot.id])).get(lot.id) ?? new Prisma.Decimal(0))
        : ((await getReservedByItems(tx, [item.id])).get(item.id) ?? new Prisma.Decimal(0));
      // Available, nao On Hand cru — saida/perda nunca pode consumir
      // estoque comprometido por uma Reservation ACTIVE.
      const available = Prisma.Decimal.max(onHand.minus(reserved), 0);
      if (quantity.greaterThan(available)) throw new InsufficientStockError(item.code);
    }

    const movement = await tx.inventoryMovement.create({
      data: {
        itemId: item.id,
        lotId: lot ? lot.id : null,
        type: input.type,
        quantity: input.quantity,
        occurredAt: new Date(),
        sourceType,
        reason: input.reason,
        createdBy: SYSTEM_ACTOR,
      },
    });

    return movement.id;
  });

  return (await getMovementById(movementId))!;
}

export async function createStockCount(input: StockCountInput): Promise<StockCountResultDTO> {
  const { item, lot } = await resolveItemAndLot(input.itemId, input.lotId);
  const countedQuantity = new Prisma.Decimal(input.countedQuantity);

  const result = await getPrisma().$transaction(async (tx) => {
    await lockStockScope(tx, { itemId: item.id, lotId: lot ? lot.id : null });

    const systemQuantity = await getOnHand(tx, { itemId: item.id, lotId: input.lotId ?? null });
    const difference = countedQuantity.minus(systemQuantity);

    if (difference.isZero()) {
      return { systemQuantity, difference, movementId: null as string | null };
    }

    if (difference.lessThan(0)) {
      const reserved = lot
        ? ((await getReservedByLots(tx, [lot.id])).get(lot.id) ?? new Prisma.Decimal(0))
        : ((await getReservedByItems(tx, [item.id])).get(item.id) ?? new Prisma.Decimal(0));
      // Nao resolve automaticamente cancelando reservas — rejeita e deixa o
      // usuario revisar as reservas antes de ajustar o estoque.
      if (countedQuantity.lessThan(reserved)) throw new CountBelowReservedError();
    }

    if (!input.reason) throw new MissingCountReasonError();

    const type = difference.greaterThan(0) ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT";
    const movement = await tx.inventoryMovement.create({
      data: {
        itemId: item.id,
        lotId: lot ? lot.id : null,
        type,
        quantity: difference.abs(),
        occurredAt: new Date(),
        sourceType: "STOCK_COUNT",
        reason: input.reason,
        createdBy: SYSTEM_ACTOR,
      },
    });

    return { systemQuantity, difference, movementId: movement.id };
  });

  return {
    itemId: item.id,
    lotId: lot ? lot.id : null,
    systemQuantity: result.systemQuantity.toString(),
    countedQuantity: countedQuantity.toString(),
    difference: result.difference.toString(),
    movementCreated: result.movementId ? await getMovementById(result.movementId) : null,
  };
}
