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
import { FUSO_COMERCIAL, ROUTE_PENDING_STATUSES, diaCivil } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { marcadorDeHojeComercial } from "../../lib/business-day.js";
import { buildAttentionList } from "./attention.service.js";
import type { ConjuntosDoRetrato } from "./dashboard.queries.js";
import { carregarConjuntosDoRetrato, getOpenPurchaseOrderState, lotsWithBalance } from "./dashboard.queries.js";
import type { DashboardQuery } from "./dashboard.schemas.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

const RECENT_MOVEMENTS_LIMIT = 15;
const ATTENTION_LIMIT = 20;

/**
 * Espera por uma conexao livre para abrir o retrato — a mesma do pool do
 * Prisma (`pool_timeout`), para o Painel nao falhar antes do que falhava.
 */
const DASHBOARD_SNAPSHOT_MAX_WAIT_MS = 10_000;
/** Duracao maxima do retrato; o padrao do Prisma (5 s) nao cobre base cheia. */
const DASHBOARD_SNAPSHOT_TIMEOUT_MS = 30_000;

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
 *
 * `now` e o instante da requisicao, o mesmo da lista de atencao — nunca um
 * relogio lido aqui dentro. `conjuntos` sao os mesmos que a lista de atencao
 * recebe: pedidos aguardando expedicao, falta de material e custo incompleto,
 * carregados uma vez no retrato (PERFORMANCE-CLEANUP-WAVE-01).
 */
async function buildCurrentState(
  prisma: PrismaOrTx,
  now: Date,
  conjuntos: Promise<ConjuntosDoRetrato>,
): Promise<DashboardCurrentStateDTO> {
  /* Vencimento se mede em dias civis: a janela sai do marcador de hoje. */
  const hojeComercialMarcador = marcadorDeHojeComercial(now);
  const nearExpiryLimit = new Date(hojeComercialMarcador.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    confirmedOrders,
    inFulfillmentOrders,
    partiallyShippedOrders,
    { ordersAwaitingShipmentIds, productionOrdersWithShortage, productionOrdersWithIncompleteCost },
    shipmentsAwaitingBilling,
    productionCounts,
    purchasing,
    awaitingQualityLots,
    blockedLots,
    expiredLots,
    nearExpiryLots,
    withoutRoute,
  ] = await Promise.all([
    prisma.customerOrder.count({ where: { status: "CONFIRMED" } }),
    prisma.customerOrder.count({ where: { status: "IN_FULFILLMENT" } }),
    prisma.customerOrder.count({ where: { status: "PARTIALLY_SHIPPED" } }),
    conjuntos,
    prisma.shipment.count({ where: { status: "CONFIRMED", billings: { none: { status: "ISSUED" } } } }),
    prisma.productionOrder.groupBy({ by: ["status"], _count: { _all: true } }),
    getOpenPurchaseOrderState(prisma, now),
    prisma.lot.findMany({ where: { status: "AWAITING_RELEASE" }, select: { id: true } }),
    prisma.lot.findMany({ where: { status: "BLOCKED" }, select: { id: true } }),
    // Vencimento e sempre pela data efetiva, nunca so pelo status
    // persistido (nenhum job marca EXPIRED). A data e CIVIL: a fronteira e o
    // marcador do dia comercial de hoje, e nao o relogio — lote que vence
    // hoje conta como proximo do vencimento, nunca como vencido.
    prisma.lot.findMany({ where: { expiryDate: { lt: hojeComercialMarcador } }, select: { id: true } }),
    prisma.lot.findMany({
      where: { expiryDate: { gte: hojeComercialMarcador, lte: nearExpiryLimit } },
      select: { id: true },
    }),
    // Pendência de roteiro: a MESMA regra do filtro `semRoteiro` da lista de OPs.
    prisma.productionOrder.count({
      where: { status: { in: [...ROUTE_PENDING_STATUSES] }, planningSnapshot: { is: null } },
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
      ordersAwaitingShipment: ordersAwaitingShipmentIds.length,
      shipmentsAwaitingBilling,
    },
    production: {
      draft: countByStatus.get("DRAFT") ?? 0,
      planned: countByStatus.get("PLANNED") ?? 0,
      released: countByStatus.get("RELEASED") ?? 0,
      inProduction: countByStatus.get("IN_PRODUCTION") ?? 0,
      withShortage: productionOrdersWithShortage.length,
      completedWithIncompleteCost: productionOrdersWithIncompleteCost.length,
      withoutRoute,
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

/**
 * Atividade por dia — contagem de eventos, mesma regra do resumo.
 *
 * `occurredAt` é instante; a barra é o DIA COMERCIAL dele, lido em São Paulo
 * (DASHBOARD-MOVEMENT-BUSINESS-DAY-01). O dia UTC (`toISOString().slice(0, 10)`)
 * punha o movimento das 22:30 na barra do dia seguinte — e o período, que já é
 * aberto no dia comercial, mostrava uma barra fora dele.
 */
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
    const day = diaCivil(movement.occurredAt, FUSO_COMERCIAL);
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
 *
 * `now` e o instante UNICO da requisicao (DASHBOARD-CONSISTENT-NOW-01). O
 * estado atual e a lista de atencao liam cada um o proprio relogio: na virada
 * do dia comercial, o contador saia de 23:59:59.999 e a lista de 00:00:00.001,
 * e o mesmo lote era "perto do vencimento" num e "vencido" no outro. Tudo que
 * depende de "agora" neste retrato recebe este valor.
 *
 * O BANCO tambem e um so (DASHBOARD-SNAPSHOT-CONSISTENCY-01). Cada consulta
 * saia do pool por conta propria e enxergava o instante em que rodou: um lote
 * desbloqueado no meio da montagem contava no contador e ja nao aparecia na
 * lista de atencao. Tudo agora roda numa transacao `RepeatableRead` — no
 * PostgreSQL, todas as leituras dela veem o retrato tirado na primeira. So
 * leitura: nenhuma trava alem da de qualquer SELECT, e nenhuma falha de
 * serializacao possivel.
 *
 * Transacao e UMA conexao: o `Promise.all` la dentro vira fila. E o preco da
 * consistencia — os tempos de `DASHBOARD_SNAPSHOT_TIMEOUT_MS` tem folga para ele.
 *
 * O que o estado atual e a atencao tem em comum — aguardando expedicao, falta
 * de material e custo incompleto — sai uma vez, dentro do retrato, e os dois
 * leem a mesma promessa (PERFORMANCE-CLEANUP-WAVE-01). Criada aqui dentro, ela
 * morre com a requisicao.
 */
export async function getDashboard(query: DashboardQuery, now: Date): Promise<DashboardDTO> {
  const { from, to } = query;

  const [period, currentState, movementSummary, recentMovements, movementActivity, attention] =
    await getPrisma().$transaction(
      (prisma) => {
        const conjuntos = carregarConjuntosDoRetrato(prisma, now);
        return Promise.all([
          buildPeriod(prisma, from, to),
          buildCurrentState(prisma, now, conjuntos),
          buildMovementSummary(prisma, from, to),
          buildRecentMovements(prisma, from, to),
          buildMovementActivity(prisma, from, to),
          buildAttentionList(prisma, now, conjuntos),
        ]);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: DASHBOARD_SNAPSHOT_MAX_WAIT_MS,
        timeout: DASHBOARD_SNAPSHOT_TIMEOUT_MS,
      },
    );

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
