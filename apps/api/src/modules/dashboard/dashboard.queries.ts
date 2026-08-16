import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { DashboardPurchasingStateDTO } from "@veridi/shared";
import { getAvailableByItems, getOnHandByLots, isLotAvailableForUse } from "../../lib/inventory-ledger.js";
import { getProductionOrderMaterialCost } from "../costs/costs.service.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/** Status de Pedido em que ainda ha operacao de expedicao/producao pendente. */
export const OPERATIONAL_ORDER_STATUSES = ["IN_FULFILLMENT", "PARTIALLY_SHIPPED"] as const;

/** Status de OP que ainda representam producao prospectiva. */
export const OPEN_PRODUCTION_ORDER_STATUSES = ["DRAFT", "PLANNED", "RELEASED", "IN_PRODUCTION"] as const;

/** Filtra a lista de lotes deixando so os que ainda tem saldo fisico. */
export async function lotsWithBalance(prisma: PrismaOrTx, lotIds: string[]): Promise<string[]> {
  if (lotIds.length === 0) return [];
  const onHandByLot = await getOnHandByLots(prisma, lotIds);
  return lotIds.filter((lotId) => (onHandByLot.get(lotId) ?? new Prisma.Decimal(0)).greaterThan(0));
}

/**
 * Pedidos operacionais com produto acabado ja reservado e ainda nao
 * expedido — ou seja, prontos para a proxima expedicao. Mesma matematica
 * de `reservedRemaining` usada pela Expedicao (quantidade reservada menos
 * o que ja saiu em Expedicoes CONFIRMED), nunca um calculo paralelo.
 */
export async function getOrdersAwaitingShipmentIds(prisma: PrismaOrTx): Promise<string[]> {
  const reservationLines = await prisma.customerOrderReservationLine.findMany({
    where: {
      releasedAt: null,
      reservation: {
        status: "ACTIVE",
        customerOrder: { status: { in: [...OPERATIONAL_ORDER_STATUSES] } },
      },
    },
    select: {
      id: true,
      quantity: true,
      reservation: { select: { customerOrderId: true } },
    },
  });
  if (reservationLines.length === 0) return [];

  const shipped = await prisma.shipmentLine.groupBy({
    by: ["customerOrderReservationLineId"],
    where: {
      customerOrderReservationLineId: { in: reservationLines.map((line) => line.id) },
      shipment: { status: "CONFIRMED" },
    },
    _sum: { quantity: true },
  });
  const shippedByLine = new Map(
    shipped.map((row) => [row.customerOrderReservationLineId, row._sum.quantity ?? new Prisma.Decimal(0)]),
  );

  const orderIds = new Set<string>();
  for (const line of reservationLines) {
    const alreadyShipped = shippedByLine.get(line.id) ?? new Prisma.Decimal(0);
    if (line.quantity.minus(alreadyShipped).greaterThan(0)) {
      orderIds.add(line.reservation.customerOrderId);
    }
  }
  return [...orderIds];
}

/**
 * Pedidos cujo atendimento ainda depende de uma OP aberta ligada ao
 * proprio Pedido. `COMPLETED`/`CANCELLED` nunca contam — a necessidade ja
 * foi encerrada ou nunca existiu. Nenhuma flag persistida.
 */
export async function getOrdersAwaitingProductionIds(prisma: PrismaOrTx): Promise<string[]> {
  const orders = await prisma.productionOrder.findMany({
    where: {
      customerOrderId: { not: null },
      status: { in: [...OPEN_PRODUCTION_ORDER_STATUSES] },
      customerOrder: { status: { in: [...OPERATIONAL_ORDER_STATUSES] } },
    },
    select: { customerOrderId: true },
    distinct: ["customerOrderId"],
  });
  return orders.map((order) => order.customerOrderId!).filter(Boolean);
}

/**
 * OPs `DRAFT`/`PLANNED` com falta real de material. Restrito de proposito
 * a esses dois status: uma OP `RELEASED` ja possui MaterialReservation
 * propria, e contar o proprio compromisso como falta geraria shortage
 * falso. Reutiliza `getAvailableByItems` — a MESMA semantica exibida na
 * tela da OP, nunca um calculo de shortage paralelo.
 */
export async function getProductionOrdersWithShortage(
  prisma: PrismaOrTx,
): Promise<{ id: string; code: string }[]> {
  const orders = await prisma.productionOrder.findMany({
    where: { status: { in: ["DRAFT", "PLANNED"] }, requirements: { some: {} } },
    select: {
      id: true,
      code: true,
      requirements: { select: { itemId: true, requiredQuantity: true, item: { select: { controlsLot: true } } } },
    },
  });
  if (orders.length === 0) return [];

  // Uma unica resolucao de disponibilidade para todos os itens envolvidos
  // — evita N+1 por OP.
  const itemScopes = new Map<string, { id: string; controlsLot: boolean }>();
  for (const order of orders) {
    for (const requirement of order.requirements) {
      itemScopes.set(requirement.itemId, {
        id: requirement.itemId,
        controlsLot: requirement.item.controlsLot,
      });
    }
  }
  const availableByItem = await getAvailableByItems(prisma, [...itemScopes.values()]);

  return orders.filter((order) =>
    order.requirements.some((requirement) => {
      const available = availableByItem.get(requirement.itemId) ?? new Prisma.Decimal(0);
      return requirement.requiredQuantity.greaterThan(available);
    }),
  ).map((order) => ({ id: order.id, code: order.code }));
}

/**
 * OPs concluidas cuja qualidade de custo e `PARTIAL`/`NO_COST` — indica
 * onde a gestao precisa melhorar o dado de custo. Nunca persiste
 * `quality`; usa o servico central de custo, restrito a OPs COMPLETED que
 * realmente tiveram consumo (as demais nunca teriam custo mesmo).
 */
export async function getProductionOrdersWithIncompleteCost(
  prisma: PrismaOrTx,
): Promise<{ id: string; code: string; completedAt: Date | null }[]> {
  const orders = await prisma.productionOrder.findMany({
    where: { status: "COMPLETED", consumptions: { some: {} } },
    select: { id: true, code: true, completedAt: true },
    orderBy: { completedAt: "desc" },
    take: 200,
  });
  if (orders.length === 0) return [];

  const results = await Promise.all(
    orders.map(async (order) => {
      const cost = await getProductionOrderMaterialCost(order.id);
      return cost.quality === "PARTIAL" || cost.quality === "NO_COST" ? order : null;
    }),
  );
  return results.filter((order): order is (typeof orders)[number] => order !== null);
}

/**
 * Estado de Compras. `itemsOnOrder` conta ITENS DISTINTOS com quantidade
 * aberta — nunca soma kg + un, que seria um numero sem significado.
 */
export async function getOpenPurchaseOrderState(
  prisma: PrismaOrTx,
  now: Date,
): Promise<DashboardPurchasingStateDTO> {
  const lines = await prisma.purchaseOrderLine.findMany({
    where: { purchaseOrder: { status: { in: ["ORDERED", "PARTIALLY_RECEIVED"] } } },
    select: {
      itemId: true,
      orderedQuantity: true,
      receiptLines: { select: { receivedQuantity: true } },
      purchaseOrder: { select: { id: true, status: true, expectedDeliveryDate: true } },
    },
  });

  const itemsOnOrder = new Set<string>();
  const lateOrderIds = new Set<string>();
  const openOrderIds = new Set<string>();
  const partiallyReceivedIds = new Set<string>();

  for (const line of lines) {
    openOrderIds.add(line.purchaseOrder.id);
    if (line.purchaseOrder.status === "PARTIALLY_RECEIVED") {
      partiallyReceivedIds.add(line.purchaseOrder.id);
    }

    const received = line.receiptLines.reduce(
      (sum, receiptLine) => sum.plus(receiptLine.receivedQuantity),
      new Prisma.Decimal(0),
    );
    const open = line.orderedQuantity.minus(received);
    if (open.lessThanOrEqualTo(0)) continue;

    itemsOnOrder.add(line.itemId);
    // Atrasada = previsao vencida E ainda com quantidade aberta.
    if (line.purchaseOrder.expectedDeliveryDate && line.purchaseOrder.expectedDeliveryDate < now) {
      lateOrderIds.add(line.purchaseOrder.id);
    }
  }

  return {
    openOrders: openOrderIds.size,
    partiallyReceived: partiallyReceivedIds.size,
    lateOrders: lateOrderIds.size,
    itemsOnOrder: itemsOnOrder.size,
  };
}

/** Reexportado para o attention service usar a mesma regra de elegibilidade. */
export { isLotAvailableForUse };
