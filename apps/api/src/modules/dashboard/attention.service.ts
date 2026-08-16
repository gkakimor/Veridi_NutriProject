import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { AttentionItemDTO, AttentionSeverity } from "@veridi/shared";
import { getOnHandByLots } from "../../lib/inventory-ledger.js";
import {
  OPERATIONAL_ORDER_STATUSES,
  getOrdersAwaitingProductionIds,
  getOrdersAwaitingShipmentIds,
  getProductionOrdersWithIncompleteCost,
  getProductionOrdersWithShortage,
} from "./dashboard.queries.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

const NEAR_EXPIRY_DAYS = 30;

/** Peso de ordenacao — CRITICAL primeiro. */
const SEVERITY_WEIGHT: Record<AttentionSeverity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
};

function formatDate(date: Date): string {
  return date.toLocaleDateString("pt-BR");
}

/**
 * Lista de atencoes operacionais — inteiramente DERIVADA das entidades
 * existentes. Nao existe tabela `Attention`, nem severidade persistida,
 * nem engine configuravel de regras: sao consultas diretas com um mapa
 * fixo de severidade.
 *
 * Ordenacao: severidade, depois data mais urgente/antiga, depois codigo
 * (determinismo estavel entre requisicoes).
 */
export async function buildAttentionList(prisma: PrismaOrTx): Promise<AttentionItemDTO[]> {
  const now = new Date();
  const nearExpiryLimit = new Date(now.getTime() + NEAR_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const [
    problematicLots,
    shortageOrders,
    incompleteCostOrders,
    awaitingShipmentIds,
    awaitingProductionIds,
    shipmentsAwaitingBilling,
    latePurchaseOrders,
  ] = await Promise.all([
    // Um unico fetch cobre vencido/bloqueado/aguardando/proximo — evita
    // quatro varreduras separadas da tabela de lotes.
    prisma.lot.findMany({
      where: {
        OR: [
          { expiryDate: { lt: now } },
          { status: "BLOCKED" },
          { status: "AWAITING_RELEASE" },
          { expiryDate: { gte: now, lte: nearExpiryLimit } },
        ],
      },
      select: { id: true, code: true, status: true, expiryDate: true, item: { select: { code: true } } },
    }),
    getProductionOrdersWithShortage(prisma),
    getProductionOrdersWithIncompleteCost(prisma),
    getOrdersAwaitingShipmentIds(prisma),
    getOrdersAwaitingProductionIds(prisma),
    prisma.shipment.findMany({
      where: { status: "CONFIRMED", billings: { none: { status: "ISSUED" } } },
      select: {
        id: true,
        code: true,
        confirmedAt: true,
        billings: { where: { status: "DRAFT" }, select: { id: true } },
      },
      orderBy: { confirmedAt: "asc" },
    }),
    prisma.purchaseOrder.findMany({
      where: {
        status: { in: ["ORDERED", "PARTIALLY_RECEIVED"] },
        expectedDeliveryDate: { lt: now },
      },
      select: {
        id: true,
        code: true,
        supplierName: true,
        expectedDeliveryDate: true,
        lines: { select: { orderedQuantity: true, receiptLines: { select: { receivedQuantity: true } } } },
      },
      orderBy: { expectedDeliveryDate: "asc" },
    }),
  ]);

  const items: AttentionItemDTO[] = [];

  // Lote so vira atencao quando ainda tem saldo — lote zerado nao e
  // problema operacional.
  const onHandByLot = await getOnHandByLots(
    prisma,
    problematicLots.map((lot) => lot.id),
  );

  for (const lot of problematicLots) {
    const onHand = onHandByLot.get(lot.id) ?? new Prisma.Decimal(0);
    if (onHand.lessThanOrEqualTo(0)) continue;

    const expired = lot.expiryDate !== null && lot.expiryDate < now;
    if (expired) {
      items.push({
        type: "LOT_EXPIRED",
        severity: "CRITICAL",
        description: `Lote ${lot.code} (${lot.item.code}) venceu em ${formatDate(lot.expiryDate!)} e ainda possui saldo.`,
        code: lot.code,
        relevantDate: lot.expiryDate!.toISOString(),
        targetKind: "LOT",
        targetId: lot.id,
      });
      continue;
    }

    if (lot.status === "BLOCKED") {
      items.push({
        type: "LOT_BLOCKED",
        severity: "CRITICAL",
        description: `Lote ${lot.code} (${lot.item.code}) está bloqueado e possui saldo em estoque.`,
        code: lot.code,
        relevantDate: null,
        targetKind: "LOT",
        targetId: lot.id,
      });
      continue;
    }

    if (lot.status === "AWAITING_RELEASE") {
      items.push({
        type: "LOT_AWAITING_QUALITY",
        severity: "WARNING",
        description: `Lote ${lot.code} (${lot.item.code}) aguarda liberação da Qualidade.`,
        code: lot.code,
        relevantDate: null,
        targetKind: "LOT",
        targetId: lot.id,
      });
      continue;
    }

    if (lot.expiryDate) {
      items.push({
        type: "LOT_NEAR_EXPIRY",
        severity: "INFO",
        description: `Lote ${lot.code} (${lot.item.code}) vence em ${formatDate(lot.expiryDate)}.`,
        code: lot.code,
        relevantDate: lot.expiryDate.toISOString(),
        targetKind: "LOT",
        targetId: lot.id,
      });
    }
  }

  for (const order of shortageOrders) {
    items.push({
      type: "PRODUCTION_ORDER_SHORTAGE",
      severity: "WARNING",
      description: `${order.code} possui falta de material para ser liberada.`,
      code: order.code,
      relevantDate: null,
      targetKind: "PRODUCTION_ORDER",
      targetId: order.id,
    });
  }

  for (const order of latePurchaseOrders) {
    // So conta como atrasada se ainda existe quantidade aberta.
    const hasOpen = order.lines.some((line) => {
      const received = line.receiptLines.reduce(
        (sum, receiptLine) => sum.plus(receiptLine.receivedQuantity),
        new Prisma.Decimal(0),
      );
      return line.orderedQuantity.minus(received).greaterThan(0);
    });
    if (!hasOpen) continue;

    items.push({
      type: "PURCHASE_ORDER_LATE",
      severity: "WARNING",
      description: `${order.code} (${order.supplierName}) está atrasada — previsão em ${formatDate(order.expectedDeliveryDate!)}.`,
      code: order.code,
      relevantDate: order.expectedDeliveryDate!.toISOString(),
      targetKind: "PURCHASE_ORDER",
      targetId: order.id,
    });
  }

  for (const shipment of shipmentsAwaitingBilling) {
    const inPreparation = shipment.billings.length > 0;
    items.push({
      type: "SHIPMENT_AWAITING_BILLING",
      severity: "WARNING",
      description: inPreparation
        ? `${shipment.code} possui faturamento em preparação, ainda não emitido.`
        : `${shipment.code} foi expedida e ainda não foi faturada.`,
      code: shipment.code,
      relevantDate: shipment.confirmedAt ? shipment.confirmedAt.toISOString() : null,
      targetKind: "SHIPMENT",
      targetId: shipment.id,
    });
  }

  for (const order of incompleteCostOrders) {
    items.push({
      type: "PRODUCTION_ORDER_INCOMPLETE_COST",
      severity: "WARNING",
      description: `${order.code} foi concluída com custo de material incompleto — informe o custo de aquisição dos lotes consumidos.`,
      code: order.code,
      relevantDate: order.completedAt ? order.completedAt.toISOString() : null,
      targetKind: "PRODUCTION_ORDER",
      targetId: order.id,
    });
  }

  // Pedidos aguardando produção/expedição: INFO — é fluxo normal, só
  // precisa de acompanhamento.
  const awaitingOrderIds = [...new Set([...awaitingProductionIds, ...awaitingShipmentIds])];
  if (awaitingOrderIds.length > 0) {
    const orders = await prisma.customerOrder.findMany({
      where: { id: { in: awaitingOrderIds }, status: { in: [...OPERATIONAL_ORDER_STATUSES] } },
      select: { id: true, code: true, requestedDeliveryDate: true },
    });
    const awaitingProduction = new Set(awaitingProductionIds);
    const awaitingShipment = new Set(awaitingShipmentIds);

    for (const order of orders) {
      if (awaitingShipment.has(order.id)) {
        items.push({
          type: "ORDER_AWAITING_SHIPMENT",
          severity: "INFO",
          description: `${order.code} possui produto acabado reservado aguardando expedição.`,
          code: order.code,
          relevantDate: order.requestedDeliveryDate ? order.requestedDeliveryDate.toISOString() : null,
          targetKind: "CUSTOMER_ORDER",
          targetId: order.id,
        });
      }
      if (awaitingProduction.has(order.id)) {
        items.push({
          type: "ORDER_AWAITING_PRODUCTION",
          severity: "INFO",
          description: `${order.code} depende de Ordem de Produção ainda não concluída.`,
          code: order.code,
          relevantDate: order.requestedDeliveryDate ? order.requestedDeliveryDate.toISOString() : null,
          targetKind: "CUSTOMER_ORDER",
          targetId: order.id,
        });
      }
    }
  }

  items.sort((a, b) => {
    const bySeverity = SEVERITY_WEIGHT[a.severity] - SEVERITY_WEIGHT[b.severity];
    if (bySeverity !== 0) return bySeverity;

    // Sem data vai para o fim do próprio grupo de severidade.
    const dateA = a.relevantDate ? Date.parse(a.relevantDate) : Number.POSITIVE_INFINITY;
    const dateB = b.relevantDate ? Date.parse(b.relevantDate) : Number.POSITIVE_INFINITY;
    if (dateA !== dateB) return dateA - dateB;

    return a.code.localeCompare(b.code);
  });

  return items;
}
