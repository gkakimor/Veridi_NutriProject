import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { INVENTORY_MOVEMENT_DIRECTION } from "@veridi/shared";
import type { InventoryMovementType } from "@veridi/shared";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/**
 * Escopo de PROPRIEDADE do estoque. Sempre opcional: sem escopo, tudo que
 * ja existia continua enxergando o estoque fisico inteiro — visibilidade
 * fisica e elegibilidade para alocacao sao coisas diferentes, e so a
 * segunda filtra por dono.
 *
 * `VERIDI` inclui estoque sem lote (item sem controle de lote e sempre
 * estoque proprio); `CUSTOMER` nunca inclui, porque material de cliente
 * exige controle de lote.
 */
export type InventoryOwnerScope =
  | { ownerType: "VERIDI" }
  | { ownerType: "CUSTOMER"; customerId: string };

/** Filtro de Lot para um escopo de propriedade. */
export function lotOwnerWhere(scope: InventoryOwnerScope): Prisma.LotWhereInput {
  return scope.ownerType === "VERIDI"
    ? { ownerType: "VERIDI" }
    : { ownerType: "CUSTOMER", ownerCustomerId: scope.customerId };
}

/**
 * Filtro de InventoryMovement pelo dono do lote. Movimento sem lote conta
 * como estoque Veridi — nunca como estoque de cliente.
 */
function movementOwnerWhere(scope: InventoryOwnerScope): Prisma.InventoryMovementWhereInput {
  return scope.ownerType === "VERIDI"
    ? { OR: [{ lotId: null }, { lot: { is: { ownerType: "VERIDI" } } }] }
    : { lot: { is: { ownerType: "CUSTOMER", ownerCustomerId: scope.customerId } } };
}

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
  scope?: InventoryOwnerScope,
): Promise<Map<string, Prisma.Decimal>> {
  if (itemIds.length === 0) return new Map();
  const grouped = await prisma.inventoryMovement.groupBy({
    by: ["itemId", "type"],
    where: { itemId: { in: itemIds }, ...(scope ? movementOwnerWhere(scope) : {}) },
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
 * Consumido por MaterialReservationLine — soma dos ProductionConsumption
 * de cada linha. Base do calculo de Reserved remanescente (linha reservada
 * menos o que ja foi efetivamente consumido).
 */
export async function getConsumedByReservationLines(
  prisma: PrismaOrTx,
  reservationLineIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (reservationLineIds.length === 0) return new Map();
  const grouped = await prisma.productionConsumption.groupBy({
    by: ["reservationLineId"],
    where: { reservationLineId: { in: reservationLineIds } },
    _sum: { quantity: true },
  });
  const map = new Map<string, Prisma.Decimal>();
  for (const row of grouped) {
    map.set(row.reservationLineId, row._sum.quantity ?? new Prisma.Decimal(0));
  }
  return map;
}

/**
 * Expedido por CustomerOrderReservationLine — soma das ShipmentLine de
 * Expedicoes CONFIRMED. Base do `reservedRemaining` do produto acabado:
 * expedir estoque ja reservado baixa On Hand e Reserved juntos, entao
 * Available nunca cai duas vezes (mesmo principio do Consumo x
 * MaterialReservation na producao). DRAFT/CANCELLED nunca contam.
 */
export async function getShippedByCustomerReservationLines(
  prisma: PrismaOrTx,
  reservationLineIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (reservationLineIds.length === 0) return new Map();
  const grouped = await prisma.shipmentLine.groupBy({
    by: ["customerOrderReservationLineId"],
    where: {
      customerOrderReservationLineId: { in: reservationLineIds },
      shipment: { status: "CONFIRMED" },
    },
    _sum: { quantity: true },
  });
  const map = new Map<string, Prisma.Decimal>();
  for (const row of grouped) {
    map.set(row.customerOrderReservationLineId, row._sum.quantity ?? new Prisma.Decimal(0));
  }
  return map;
}

/**
 * Reserved por item — soma de DOIS compromissos, nunca um calculo paralelo
 * por modulo:
 * 1. MaterialReservationLine de reservas ACTIVE (materia-prima/embalagem de
 *    OP), excluindo linhas substituidas (`releasedAt` preenchido — ver
 *    Picking) e descontando o que ja foi efetivamente consumido
 *    (`quantity - consumido`, nunca negativo);
 * 2. CustomerOrderReservationLine de reservas ACTIVE (produto acabado de
 *    Pedido do Cliente), excluindo linhas realocadas (`releasedAt`
 *    preenchido) e descontando o que ja foi efetivamente expedido
 *    (`quantity - expedido`, nunca negativo).
 * RELEASED (reserva liberada) nunca conta em nenhum dos dois. Nunca uma
 * segunda quantidade fora das tabelas de reserva/consumo/expedicao.
 */
export async function getReservedByItems(
  prisma: PrismaOrTx,
  itemIds: string[],
  scope?: InventoryOwnerScope,
): Promise<Map<string, Prisma.Decimal>> {
  if (itemIds.length === 0) return new Map();
  // Reserva sem lote e compromisso sobre estoque proprio; no escopo de
  // cliente ela nunca conta.
  const ownerFilter: Prisma.MaterialReservationLineWhereInput = scope
    ? scope.ownerType === "VERIDI"
      ? { OR: [{ lotId: null }, { lot: { is: { ownerType: "VERIDI" } } }] }
      : { lot: { is: { ownerType: "CUSTOMER", ownerCustomerId: scope.customerId } } }
    : {};
  const [lines, customerOrderLines] = await Promise.all([
    prisma.materialReservationLine.findMany({
      where: {
        itemId: { in: itemIds },
        releasedAt: null,
        reservation: { status: "ACTIVE" },
        ...ownerFilter,
      },
      select: { id: true, itemId: true, quantity: true },
    }),
    prisma.customerOrderReservationLine.findMany({
      where: {
        itemId: { in: itemIds },
        releasedAt: null,
        reservation: { status: "ACTIVE" },
        ...(ownerFilter as Prisma.CustomerOrderReservationLineWhereInput),
      },
      select: { id: true, itemId: true, quantity: true },
    }),
  ]);
  const [consumedByLine, shippedByLine] = await Promise.all([
    getConsumedByReservationLines(
      prisma,
      lines.map((line) => line.id),
    ),
    getShippedByCustomerReservationLines(
      prisma,
      customerOrderLines.map((line) => line.id),
    ),
  ]);

  const map = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    const consumed = consumedByLine.get(line.id) ?? new Prisma.Decimal(0);
    const remaining = Prisma.Decimal.max(line.quantity.minus(consumed), 0);
    const current = map.get(line.itemId) ?? new Prisma.Decimal(0);
    map.set(line.itemId, current.plus(remaining));
  }
  for (const line of customerOrderLines) {
    const shipped = shippedByLine.get(line.id) ?? new Prisma.Decimal(0);
    const remaining = Prisma.Decimal.max(line.quantity.minus(shipped), 0);
    const current = map.get(line.itemId) ?? new Prisma.Decimal(0);
    map.set(line.itemId, current.plus(remaining));
  }
  return map;
}

/** Versao por lote de `getReservedByItems` — mesma regra (os dois compromissos, ACTIVE, liquidos de consumo/expedicao). */
export async function getReservedByLots(
  prisma: PrismaOrTx,
  lotIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (lotIds.length === 0) return new Map();
  const [lines, customerOrderLines] = await Promise.all([
    prisma.materialReservationLine.findMany({
      where: { lotId: { in: lotIds }, releasedAt: null, reservation: { status: "ACTIVE" } },
      select: { id: true, lotId: true, quantity: true },
    }),
    prisma.customerOrderReservationLine.findMany({
      where: { lotId: { in: lotIds }, releasedAt: null, reservation: { status: "ACTIVE" } },
      select: { id: true, lotId: true, quantity: true },
    }),
  ]);
  const [consumedByLine, shippedByLine] = await Promise.all([
    getConsumedByReservationLines(
      prisma,
      lines.map((line) => line.id),
    ),
    getShippedByCustomerReservationLines(
      prisma,
      customerOrderLines.map((line) => line.id),
    ),
  ]);

  const map = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    if (!line.lotId) continue;
    const consumed = consumedByLine.get(line.id) ?? new Prisma.Decimal(0);
    const remaining = Prisma.Decimal.max(line.quantity.minus(consumed), 0);
    const current = map.get(line.lotId) ?? new Prisma.Decimal(0);
    map.set(line.lotId, current.plus(remaining));
  }
  for (const line of customerOrderLines) {
    if (!line.lotId) continue;
    const shipped = shippedByLine.get(line.id) ?? new Prisma.Decimal(0);
    const remaining = Prisma.Decimal.max(line.quantity.minus(shipped), 0);
    const current = map.get(line.lotId) ?? new Prisma.Decimal(0);
    map.set(line.lotId, current.plus(remaining));
  }
  return map;
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
 * precise dela (Visao Geral do Estoque, FEFO, Requirements de OP,
 * Reservation). Regra definitiva: `Available = On Hand - Reserved`, nunca
 * negativo. Item sem controle de lote: calculado no nivel do Item. Item
 * com controle de lote: calculado por lote elegivel (AVAILABLE, nao
 * vencido) e somado — lote AWAITING_RELEASE/BLOCKED/vencido continua em
 * On Hand mas contribui 0 aqui, mesmo que tenha Reserved. Nunca duplicar
 * esta logica em outro modulo.
 */
export async function getAvailableByItems(
  prisma: PrismaOrTx,
  items: readonly { id: string; controlsLot: boolean }[],
  scope?: InventoryOwnerScope,
): Promise<Map<string, Prisma.Decimal>> {
  const itemIds = items.map((item) => item.id);
  const [onHandByItem, reservedByItem] = await Promise.all([
    getOnHandByItems(prisma, itemIds, scope),
    getReservedByItems(prisma, itemIds, scope),
  ]);

  const lotControlledIds = items.filter((item) => item.controlsLot).map((item) => item.id);
  const lots = lotControlledIds.length
    ? await prisma.lot.findMany({
        where: { itemId: { in: lotControlledIds }, ...(scope ? lotOwnerWhere(scope) : {}) },
      })
    : [];
  const lotIds = lots.map((lot) => lot.id);
  const [onHandByLot, reservedByLot] = await Promise.all([
    getOnHandByLots(prisma, lotIds),
    getReservedByLots(prisma, lotIds),
  ]);

  const availableByItem = new Map<string, Prisma.Decimal>();
  for (const lot of lots) {
    if (!isLotAvailableForUse(lot)) continue;
    const lotOnHand = onHandByLot.get(lot.id) ?? new Prisma.Decimal(0);
    const lotReserved = reservedByLot.get(lot.id) ?? new Prisma.Decimal(0);
    const lotAvailable = Prisma.Decimal.max(lotOnHand.minus(lotReserved), 0);
    const current = availableByItem.get(lot.itemId) ?? new Prisma.Decimal(0);
    availableByItem.set(lot.itemId, current.plus(lotAvailable));
  }

  const result = new Map<string, Prisma.Decimal>();
  for (const item of items) {
    if (item.controlsLot) {
      result.set(item.id, availableByItem.get(item.id) ?? new Prisma.Decimal(0));
    } else if (scope?.ownerType === "CUSTOMER") {
      // Material de cliente exige controle de lote — sem lote nao existe
      // saldo de terceiro identificavel.
      result.set(item.id, new Prisma.Decimal(0));
    } else {
      const onHand = onHandByItem.get(item.id) ?? new Prisma.Decimal(0);
      const reserved = reservedByItem.get(item.id) ?? new Prisma.Decimal(0);
      result.set(item.id, Prisma.Decimal.max(onHand.minus(reserved), 0));
    }
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
