import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { INVENTORY_MOVEMENT_DIRECTION } from "@veridi/shared";
import type { InventoryMovementType } from "@veridi/shared";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/**
 * On Hand de um item (e opcionalmente de um lote especifico) — soma
 * algebrica dos InventoryMovements, nunca uma coluna armazenada.
 *
 * `lotId` omitido: total do item (todos os lotes + movimentos sem lote).
 * `lotId: null`: so movimentos sem lote (item sem controle de lote).
 * `lotId: "<id>"`: so aquele lote.
 */
export async function getOnHand(
  prisma: PrismaOrTx,
  scope: { itemId: string; lotId?: string | null },
): Promise<Prisma.Decimal> {
  const grouped = await prisma.inventoryMovement.groupBy({
    by: ["type"],
    where: {
      itemId: scope.itemId,
      ...(scope.lotId !== undefined ? { lotId: scope.lotId } : {}),
    },
    _sum: { quantity: true },
  });
  return sumDirectional(grouped);
}

/** Versao em lote de `getOnHand` por item — evita N+1 em listas. */
export async function getOnHandByItems(
  prisma: PrismaOrTx,
  itemIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (itemIds.length === 0) return new Map();
  const grouped = await prisma.inventoryMovement.groupBy({
    by: ["itemId", "type"],
    where: { itemId: { in: itemIds } },
    _sum: { quantity: true },
  });
  return groupIntoMap(grouped, (row) => row.itemId);
}

/** Versao em lote de `getOnHand` por lote — evita N+1 em listas. */
export async function getOnHandByLots(
  prisma: PrismaOrTx,
  lotIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (lotIds.length === 0) return new Map();
  const grouped = await prisma.inventoryMovement.groupBy({
    by: ["lotId", "type"],
    where: { lotId: { in: lotIds } },
    _sum: { quantity: true },
  });
  return groupIntoMap(
    grouped as { lotId: string | null; type: InventoryMovementType; _sum: { quantity: Prisma.Decimal | null } }[],
    (row) => row.lotId as string,
  );
}

/**
 * On Order por item — soma do `openQuantity` (orderedQuantity - recebido
 * real) das PurchaseOrderLine de OCs ORDERED/PARTIALLY_RECEIVED. Nunca
 * persiste uma segunda quantidade; DRAFT/CANCELLED/RECEIVED nao contam.
 */
export async function getOnOrderByItems(
  prisma: PrismaOrTx,
  itemIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (itemIds.length === 0) return new Map();

  const lines = await prisma.purchaseOrderLine.findMany({
    where: {
      itemId: { in: itemIds },
      purchaseOrder: { status: { in: ["ORDERED", "PARTIALLY_RECEIVED"] } },
    },
    include: { receiptLines: true },
  });

  const map = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    const received = line.receiptLines.reduce(
      (sum, receiptLine) => sum.plus(receiptLine.receivedQuantity),
      new Prisma.Decimal(0),
    );
    const open = line.orderedQuantity.minus(received);
    if (open.lessThanOrEqualTo(0)) continue;

    const current = map.get(line.itemId) ?? new Prisma.Decimal(0);
    map.set(line.itemId, current.plus(open));
  }
  return map;
}

export function isLotExpired(lot: { expiryDate: Date | null }): boolean {
  return lot.expiryDate ? lot.expiryDate.getTime() < Date.now() : false;
}

/** Um lote so contribui para Available quando AVAILABLE e nao vencido. */
export function isLotAvailableForUse(lot: { status: string; expiryDate: Date | null }): boolean {
  return lot.status === "AVAILABLE" && !isLotExpired(lot);
}

/**
 * Available por item — mesma interpretacao em qualquer tela/servico que
 * precise dela (Visao Geral do Estoque, FEFO, Requirements de OP). Item
 * sem controle de lote: Available = On Hand. Item com controle de lote:
 * soma so o On Hand dos lotes efetivamente disponiveis (AVAILABLE, nao
 * vencido) — lote AWAITING_RELEASE/BLOCKED/vencido continua em On Hand
 * mas contribui 0 aqui. Nunca duplicar esta logica em outro modulo.
 */
export async function getAvailableByItems(
  prisma: PrismaOrTx,
  items: readonly { id: string; controlsLot: boolean }[],
): Promise<Map<string, Prisma.Decimal>> {
  const onHandByItem = await getOnHandByItems(
    prisma,
    items.map((item) => item.id),
  );

  const lotControlledIds = items.filter((item) => item.controlsLot).map((item) => item.id);
  const lots = lotControlledIds.length
    ? await prisma.lot.findMany({ where: { itemId: { in: lotControlledIds } } })
    : [];
  const onHandByLot = await getOnHandByLots(
    prisma,
    lots.map((lot) => lot.id),
  );

  const availableByItem = new Map<string, Prisma.Decimal>();
  for (const lot of lots) {
    if (!isLotAvailableForUse(lot)) continue;
    const lotOnHand = onHandByLot.get(lot.id) ?? new Prisma.Decimal(0);
    const current = availableByItem.get(lot.itemId) ?? new Prisma.Decimal(0);
    availableByItem.set(lot.itemId, current.plus(lotOnHand));
  }

  const result = new Map<string, Prisma.Decimal>();
  for (const item of items) {
    const onHand = onHandByItem.get(item.id) ?? new Prisma.Decimal(0);
    result.set(
      item.id,
      item.controlsLot ? (availableByItem.get(item.id) ?? new Prisma.Decimal(0)) : onHand,
    );
  }
  return result;
}

function sumDirectional(
  rows: { type: InventoryMovementType; _sum: { quantity: Prisma.Decimal | null } }[],
): Prisma.Decimal {
  return rows.reduce((total, row) => {
    const quantity = row._sum.quantity ?? new Prisma.Decimal(0);
    const direction = INVENTORY_MOVEMENT_DIRECTION[row.type];
    return total.plus(quantity.times(direction));
  }, new Prisma.Decimal(0));
}

function groupIntoMap<T extends { type: InventoryMovementType; _sum: { quantity: Prisma.Decimal | null } }>(
  rows: T[],
  keyOf: (row: T) => string,
): Map<string, Prisma.Decimal> {
  const map = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    const key = keyOf(row);
    const quantity = row._sum.quantity ?? new Prisma.Decimal(0);
    const direction = INVENTORY_MOVEMENT_DIRECTION[row.type];
    const current = map.get(key) ?? new Prisma.Decimal(0);
    map.set(key, current.plus(quantity.times(direction)));
  }
  return map;
}
