import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type {
  AttentionGroupDTO,
  AttentionItemDTO,
  AttentionType,
  DashboardCurrentStateDTO,
  DashboardDTO,
  DashboardPeriodDTO,
  MovementActivityPointDTO,
  MovementSummaryDTO,
  RecentMovementDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildAttentionList } from "./attention.service.js";
import {
  getOpenPurchaseOrderState,
  getOrdersAwaitingShipmentIds,
  getProductionOrdersWithIncompleteCost,
  getProductionOrdersWithShortage,
  lotsWithBalance,
} from "./dashboard.queries.js";
import type { DashboardQuery } from "./dashboard.schemas.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

const RECENT_MOVEMENTS_LIMIT = 15;
const ATTENTION_LIMIT = 20;

/**
 * Metricas do PERIODO — sempre contagem de DOCUMENTOS/eventos, nunca soma
 * de quantidades que podem estar em UOMs incompativeis (kg + un + L). Cada
 * metrica usa a data operacional correta do proprio documento, nunca
 * `updatedAt`.
 */
async function buildPeriod(prisma: PrismaOrTx, from: Date, to: Date): Promise<DashboardPeriodDTO> {
  const [customerOrdersCreated, receiptsCompleted, productionOrdersCompleted, shipmentsConfirmed, issuedBillings] =
    await Promise.all([
      prisma.customerOrder.count({ where: { createdAt: { gte: from, lte: to } } }),
      // Um Receipt com cinco linhas continua sendo UM recebimento — nunca
      // contar RECEIPT_IN aqui (isso e movimento, conceito diferente).
      prisma.receipt.count({ where: { receivedAt: { gte: from, lte: to } } }),
      prisma.productionOrder.count({
        where: { status: "COMPLETED", completedAt: { gte: from, lte: to } },
      }),
      prisma.shipment.count({
        where: { status: "CONFIRMED", confirmedAt: { gte: from, lte: to } },
      }),
      prisma.billing.findMany({
        where: { status: "ISSUED", issuedAt: { gte: from, lte: to } },
        include: { lines: true },
      }),
    ]);

  // Valor faturado so existe quando TODOS os documentos do periodo tem
  // precificacao completa — somar so os completos e apresentar como total
  // seria enganoso.
  let billingsWithCompletePricing = 0;
  let total = new Prisma.Decimal(0);
  for (const billing of issuedBillings) {
    const complete = billing.lines.length > 0 && billing.lines.every((line) => line.unitPrice !== null);
    if (!complete) continue;
    billingsWithCompletePricing += 1;
    for (const line of billing.lines) {
      total = total.plus(line.quantity.times(line.unitPrice!));
    }
  }
  const allComplete = issuedBillings.length > 0 && billingsWithCompletePricing === issuedBillings.length;

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    customerOrdersCreated,
    receiptsCompleted,
    productionOrdersCompleted,
    shipmentsConfirmed,
    billingsIssued: issuedBillings.length,
    billedAmount: allComplete ? total.toFixed(2) : null,
    billingsWithCompletePricing,
  };
}

/**
 * ESTADO ATUAL — nunca responde ao filtro de periodo. Uma OP antiga em
 * producao continua contando aqui mesmo quando esta fora da janela
 * historica selecionada.
 */
async function buildCurrentState(prisma: PrismaOrTx): Promise<DashboardCurrentStateDTO> {
  const now = new Date();
  const nearExpiryLimit = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    confirmedOrders,
    inFulfillmentOrders,
    partiallyShippedOrders,
    awaitingShipmentIds,
    shipmentsAwaitingBilling,
    productionCounts,
    shortageOrderIds,
    incompleteCostOrderIds,
    purchasing,
    awaitingQualityLots,
    blockedLots,
    expiredLots,
    nearExpiryLots,
  ] = await Promise.all([
    prisma.customerOrder.count({ where: { status: "CONFIRMED" } }),
    prisma.customerOrder.count({ where: { status: "IN_FULFILLMENT" } }),
    prisma.customerOrder.count({ where: { status: "PARTIALLY_SHIPPED" } }),
    getOrdersAwaitingShipmentIds(prisma),
    prisma.shipment.count({ where: { status: "CONFIRMED", billings: { none: { status: "ISSUED" } } } }),
    prisma.productionOrder.groupBy({ by: ["status"], _count: { _all: true } }),
    getProductionOrdersWithShortage(prisma),
    getProductionOrdersWithIncompleteCost(prisma),
    getOpenPurchaseOrderState(prisma, now),
    prisma.lot.findMany({ where: { status: "AWAITING_RELEASE" }, select: { id: true } }),
    prisma.lot.findMany({ where: { status: "BLOCKED" }, select: { id: true } }),
    // Vencimento e sempre pela data efetiva, nunca so pelo status
    // persistido (nenhum job marca EXPIRED).
    prisma.lot.findMany({ where: { expiryDate: { lt: now } }, select: { id: true } }),
    prisma.lot.findMany({
      where: { expiryDate: { gte: now, lte: nearExpiryLimit } },
      select: { id: true },
    }),
  ]);

  const countByStatus = new Map(productionCounts.map((row) => [row.status, row._count._all]));

  // Lote so conta quando ainda tem saldo — lote zerado nao e problema
  // operacional.
  const [awaitingWithBalance, blockedWithBalance, expiredWithBalance, nearExpiryWithBalance] =
    await Promise.all([
      lotsWithBalance(prisma, awaitingQualityLots.map((lot) => lot.id)),
      lotsWithBalance(prisma, blockedLots.map((lot) => lot.id)),
      lotsWithBalance(prisma, expiredLots.map((lot) => lot.id)),
      lotsWithBalance(prisma, nearExpiryLots.map((lot) => lot.id)),
    ]);

  return {
    commercial: {
      confirmedOrders,
      inFulfillmentOrders,
      partiallyShippedOrders,
      ordersAwaitingShipment: awaitingShipmentIds.length,
      shipmentsAwaitingBilling,
    },
    production: {
      draft: countByStatus.get("DRAFT") ?? 0,
      planned: countByStatus.get("PLANNED") ?? 0,
      released: countByStatus.get("RELEASED") ?? 0,
      inProduction: countByStatus.get("IN_PRODUCTION") ?? 0,
      withShortage: shortageOrderIds.length,
      completedWithIncompleteCost: incompleteCostOrderIds.length,
    },
    purchasing,
    inventory: {
      lotsAwaitingQuality: awaitingWithBalance.length,
      lotsBlocked: blockedWithBalance.length,
      lotsExpired: expiredWithBalance.length,
      lotsNearExpiry: nearExpiryWithBalance.length,
    },
  };
}

function emptySummary(): MovementSummaryDTO {
  return {
    receiptIn: 0,
    productionConsumption: 0,
    sampleConsumption: 0,
    finishedGoodProduction: 0,
    shipmentOut: 0,
    adjustments: 0,
    loss: 0,
  };
}

function applyMovementCount(target: MovementSummaryDTO, type: string, count: number): void {
  switch (type) {
    case "RECEIPT_IN":
      target.receiptIn += count;
      break;
    case "PRODUCTION_CONSUMPTION":
      target.productionConsumption += count;
      break;
    case "SAMPLE_CONSUMPTION":
      // Card proprio: consumo de desenvolvimento nao se mistura com
      // consumo de producao nem com ajuste.
      target.sampleConsumption += count;
      break;
    case "FINISHED_GOOD_PRODUCTION":
      target.finishedGoodProduction += count;
      break;
    case "SHIPMENT_OUT":
      target.shipmentOut += count;
      break;
    case "ADJUSTMENT_IN":
    case "ADJUSTMENT_OUT":
      // Agrupados no card; o read model preserva os tipos originais na
      // consulta, so a apresentacao agrega.
      target.adjustments += count;
      break;
    case "LOSS":
      target.loss += count;
      break;
  }
}

/** Contagem de EVENTOS por tipo — nunca soma de quantidades incompativeis. */
async function buildMovementSummary(
  prisma: PrismaOrTx,
  from: Date,
  to: Date,
): Promise<MovementSummaryDTO> {
  const grouped = await prisma.inventoryMovement.groupBy({
    by: ["type"],
    where: { occurredAt: { gte: from, lte: to } },
    _count: { _all: true },
  });

  const summary = emptySummary();
  for (const row of grouped) {
    applyMovementCount(summary, row.type, row._count._all);
  }
  return summary;
}

/** Atividade por dia — contagem de eventos, mesma regra do resumo. */
async function buildMovementActivity(
  prisma: PrismaOrTx,
  from: Date,
  to: Date,
): Promise<MovementActivityPointDTO[]> {
  const movements = await prisma.inventoryMovement.findMany({
    where: { occurredAt: { gte: from, lte: to } },
    select: { type: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
  });

  const byDay = new Map<string, MovementSummaryDTO>();
  for (const movement of movements) {
    const day = movement.occurredAt.toISOString().slice(0, 10);
    const bucket = byDay.get(day) ?? emptySummary();
    applyMovementCount(bucket, movement.type, 1);
    byDay.set(day, bucket);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, summary]) => ({ date, ...summary }));
}

async function buildRecentMovements(
  prisma: PrismaOrTx,
  from: Date,
  to: Date,
): Promise<RecentMovementDTO[]> {
  const movements = await prisma.inventoryMovement.findMany({
    where: { occurredAt: { gte: from, lte: to } },
    include: {
      item: true,
      lot: true,
      receiptLine: { include: { receipt: true } },
      productionConsumption: { include: { productionOrder: true } },
      productionOutput: { include: { productionOrder: true } },
      shipmentLine: { include: { shipment: true } },
    },
    orderBy: { occurredAt: "desc" },
    take: RECENT_MOVEMENTS_LIMIT,
  });

  // Amostra se liga ao ledger por sourceType/sourceId, nao por linha de
  // documento. Resolvido em lote.
  const sampleIds = [
    ...new Set(
      movements
        .filter((movement) => movement.sourceType === "PROJECT_SAMPLE" && movement.sourceId)
        .map((movement) => movement.sourceId!),
    ),
  ];
  const samples = sampleIds.length
    ? await prisma.projectSample.findMany({
        where: { id: { in: sampleIds } },
        select: { id: true, code: true },
      })
    : [];
  const samplesById = new Map(samples.map((sample) => [sample.id, sample]));

  return movements.map((movement) => {
    // Origem derivada do vinculo 1:1 que cada tipo ja possui — nenhum
    // sistema generico de resolucao de origem.
    let sourceCode: string | null = null;
    let sourceKind: RecentMovementDTO["sourceKind"] = null;
    let sourceId: string | null = null;

    if (movement.receiptLine) {
      sourceCode = movement.receiptLine.receipt.code;
      sourceKind = "RECEIPT";
      sourceId = movement.receiptLine.receiptId;
    } else if (movement.productionConsumption) {
      sourceCode = movement.productionConsumption.productionOrder.code;
      sourceKind = "PRODUCTION_ORDER";
      sourceId = movement.productionConsumption.productionOrderId;
    } else if (movement.productionOutput) {
      sourceCode = movement.productionOutput.productionOrder.code;
      sourceKind = "PRODUCTION_ORDER";
      sourceId = movement.productionOutput.productionOrderId;
    } else if (movement.shipmentLine) {
      sourceCode = movement.shipmentLine.shipment.code;
      sourceKind = "SHIPMENT";
      sourceId = movement.shipmentLine.shipmentId;
    } else if (movement.sourceType === "PROJECT_SAMPLE" && movement.sourceId) {
      const sample = samplesById.get(movement.sourceId);
      if (sample) {
        sourceCode = sample.code;
        sourceKind = "PROJECT_SAMPLE";
        sourceId = sample.id;
      }
    } else if (
      movement.type === "ADJUSTMENT_IN" ||
      movement.type === "ADJUSTMENT_OUT" ||
      movement.type === "LOSS"
    ) {
      sourceKind = "ADJUSTMENT";
    }

    return {
      id: movement.id,
      occurredAt: movement.occurredAt.toISOString(),
      type: movement.type,
      itemId: movement.itemId,
      itemCode: movement.item.code,
      itemName: movement.item.name,
      lotCode: movement.lot ? movement.lot.code : null,
      quantity: movement.quantity.toString(),
      unitCode: movement.item.unitCode,
      sourceCode,
      sourceKind,
      sourceId,
    };
  });
}

/** Itens de exemplo mostrados dentro de cada grupo antes do "ver todos". */
const ATTENTION_GROUP_SAMPLE = 5;

/**
 * Agrupa a MESMA lista de atencoes por tipo — sem nenhuma consulta extra.
 * O cockpit precisa dizer "12 lotes com CoA pendente", nao repetir 12
 * linhas quase iguais; a fonte de verdade continua sendo a lista derivada.
 */
function groupAttention(items: AttentionItemDTO[]): AttentionGroupDTO[] {
  const groups = new Map<AttentionType, AttentionGroupDTO>();

  for (const item of items) {
    const current = groups.get(item.type) ?? {
      type: item.type,
      severity: item.severity,
      count: 0,
      items: [],
    };
    current.count += 1;
    if (current.items.length < ATTENTION_GROUP_SAMPLE) current.items.push(item);
    groups.set(item.type, current);
  }

  // `items` ja vem ordenado por severidade e urgencia: preservar a ordem de
  // insercao mantem o grupo mais critico no topo.
  return [...groups.values()];
}

/**
 * Read model central do Dashboard — uma unica chamada em vez de dezenas de
 * requisicoes independentes do frontend. Nada aqui e persistido: tudo sai
 * das entidades operacionais e dos servicos centrais ja existentes
 * (disponibilidade, custo, faturamento).
 */
export async function getDashboard(query: DashboardQuery): Promise<DashboardDTO> {
  const prisma = getPrisma();
  const { from, to } = query;

  const [period, currentState, movementSummary, recentMovements, movementActivity, attention] =
    await Promise.all([
      buildPeriod(prisma, from, to),
      buildCurrentState(prisma),
      buildMovementSummary(prisma, from, to),
      buildRecentMovements(prisma, from, to),
      buildMovementActivity(prisma, from, to),
      buildAttentionList(prisma),
    ]);

  return {
    period,
    currentState,
    attention: attention.slice(0, ATTENTION_LIMIT),
    attentionGroups: groupAttention(attention),
    attentionTotal: attention.length,
    attentionLimit: ATTENTION_LIMIT,
    movementSummary,
    recentMovements,
    movementActivity,
  };
}
