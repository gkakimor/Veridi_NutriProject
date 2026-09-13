import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { DashboardPurchasingStateDTO } from "@veridi/shared";
import { venceuEm } from "../../lib/business-day.js";
import { getAvailableByItems, getOnHandByLots, isLotAvailableForUse } from "../../lib/inventory-ledger.js";
import { findProductionOrderMaterialCost } from "../costs/costs.service.js";

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
 *
 * `now` decide quais lotes ja venceram (vencido nao e disponivel): e o
 * instante do retrato de quem chama, para o contador e a atencao concordarem.
 */
export async function getProductionOrdersWithShortage(
  prisma: PrismaOrTx,
  now: Date,
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
  const availableByItem = await getAvailableByItems(prisma, [...itemScopes.values()], undefined, now);

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
 *
 * O custo e lido pelo MESMO `prisma` da lista — no Painel, a transacao do
 * retrato. Pelo cliente global, a OP listada no retrato tinha o custo lido
 * depois dele (DASHBOARD-SNAPSHOT-CONSISTENCY-01).
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
      const cost = await findProductionOrderMaterialCost(order.id, prisma);
      // OP que sumiu entre as duas leituras nao e custo pendente de ninguem.
      if (!cost) return null;
      return cost.quality === "PARTIAL" || cost.quality === "NO_COST" ? order : null;
    }),
  );
  return results.filter((order): order is (typeof orders)[number] => order !== null);
}

/**
 * Os três conjuntos caros que o estado atual e a lista de atenção leem do MESMO
 * retrato (PERFORMANCE-CLEANUP-WAVE-01).
 *
 * Cada bloco calculava os três por conta própria. No mesmo retrato e com o
 * mesmo `now` o resultado é idêntico — e o custo incompleto, uma resolução de
 * custo por OP concluída, era pago duas vezes a cada requisição. O Painel
 * carrega os três uma vez e entrega aos dois. Vale só para a requisição: nada
 * fica guardado entre uma e outra.
 */
export interface ConjuntosDoRetrato {
  ordersAwaitingShipmentIds: string[];
  productionOrdersWithShortage: { id: string; code: string }[];
  productionOrdersWithIncompleteCost: { id: string; code: string; completedAt: Date | null }[];
}

export async function carregarConjuntosDoRetrato(prisma: PrismaOrTx, now: Date): Promise<ConjuntosDoRetrato> {
  const [ordersAwaitingShipmentIds, productionOrdersWithShortage, productionOrdersWithIncompleteCost] =
    await Promise.all([
      getOrdersAwaitingShipmentIds(prisma),
      getProductionOrdersWithShortage(prisma, now),
      getProductionOrdersWithIncompleteCost(prisma),
    ]);
  return { ordersAwaitingShipmentIds, productionOrdersWithShortage, productionOrdersWithIncompleteCost };
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
    /*
     * Atrasada = o DIA previsto ja passou E ainda ha quantidade aberta. A
     * previsao e data civil (meia-noite UTC como marcador do dia): comparada
     * com o relogio, a OC prevista para 12/09 ficava atrasada desde as 21h de
     * 11/09 em Sao Paulo. Mesma regra da lista de atencao e do R-11.
     */
    if (venceuEm(line.purchaseOrder.expectedDeliveryDate, now)) {
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
