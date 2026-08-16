import { Prisma } from "@prisma/client";
import type {
  ConsumptionRowDTO,
  PlannedActualRowDTO,
  ProductionRequirementRowDTO,
  ProductionTraceabilityDTO,
  ReportPageDTO,
  TraceabilityConsumedRowDTO,
  TraceabilityProducedRowDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { getConsumedByReservationLines, isLotExpired } from "../../lib/inventory-ledger.js";
import { computeRequirementAvailability } from "../../lib/requirement-availability.js";
import { getConsumedLotCostReference } from "../../lib/cost-reference.js";
import { getProductionOrderMaterialCost } from "../costs/costs.service.js";
import type {
  ConsumptionQuery,
  PlannedActualQuery,
  ProductionTraceabilityQuery,
  RequirementsQuery,
} from "./reports.schemas.js";

const OPEN_STATUSES = ["DRAFT", "PLANNED", "RELEASED", "IN_PRODUCTION"] as const;

/**
 * R-04 — Necessidade / Falta para OP. Usa EXATAMENTE a mesma semantica do
 * documento da OP (`computeRequirementAvailability`): a reserva da propria
 * OP volta para o disponivel, entao o proprio compromisso nunca vira falta
 * falsa, e `On Order` continua informativo sem reduzir a falta.
 */
export async function getRequirementsReport(
  query: RequirementsQuery,
): Promise<ReportPageDTO<ProductionRequirementRowDTO>> {
  const prisma = getPrisma();

  const orders = await prisma.productionOrder.findMany({
    where: {
      status: query.status ? query.status : { in: [...OPEN_STATUSES] },
      ...(query.productionOrderId ? { id: query.productionOrderId } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: "insensitive" } },
              { productName: { contains: query.search, mode: "insensitive" } },
              { product: { is: { name: { contains: query.search, mode: "insensitive" } } } },
            ],
          }
        : {}),
      requirements: { some: {} },
    },
    include: {
      product: true,
      requirements: { include: { item: true }, orderBy: { position: "asc" } },
      reservation: { include: { lines: true } },
    },
    orderBy: { code: "asc" },
  });

  const reservationLineIds = orders.flatMap(
    (order) => order.reservation?.lines.map((line) => line.id) ?? [],
  );
  const consumedByLine = await getConsumedByReservationLines(prisma, reservationLineIds);

  // Uma unica resolucao de disponibilidade para TODOS os requirements —
  // sem consultar item por item.
  const scopes = orders.flatMap((order) =>
    order.requirements.map((requirement) => ({
      requirementId: requirement.id,
      itemId: requirement.itemId,
      controlsLot: requirement.item.controlsLot,
      requiredQuantity: requirement.requiredQuantity,
      activeReservationLines: (order.reservation?.lines ?? [])
        .filter((line) => line.releasedAt === null && line.productionOrderRequirementId === requirement.id)
        .map((line) => ({ id: line.id, quantity: line.quantity })),
    })),
  );
  const availabilityByRequirement = await computeRequirementAvailability(prisma, scopes, consumedByLine);

  const rows: ProductionRequirementRowDTO[] = [];
  for (const order of orders) {
    const usingSnapshot = order.productCode !== null;
    for (const requirement of order.requirements) {
      const availability = availabilityByRequirement.get(requirement.id)!;
      if (query.onlyShortage && availability.shortage.lessThanOrEqualTo(0)) continue;

      rows.push({
        productionOrderId: order.id,
        productionOrderCode: order.code,
        productionOrderStatus: order.status,
        productId: order.productId,
        productCode: usingSnapshot ? order.productCode! : order.product.code,
        productName: usingSnapshot ? order.productName! : order.product.name,
        requirementId: requirement.id,
        itemId: requirement.itemId,
        itemCode: requirement.itemCode,
        itemName: requirement.itemName,
        requiredQuantity: requirement.requiredQuantity.toString(),
        reserved: availability.reserved.toString(),
        available: availability.available.toString(),
        onOrder: availability.onOrder.toString(),
        shortage: availability.shortage.toString(),
        unitCode: requirement.stockUnitCode,
      });
    }
  }

  return {
    rows: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
    page: query.page,
    pageSize: query.pageSize,
    total: rows.length,
  };
}

/**
 * R-05 — Planejado x Realizado. O produzido vem SEMPRE da soma dos
 * ProductionOutput, nunca de um campo persistido. O periodo usa
 * `completedAt` para OPs concluidas (o padrao) e `createdAt` para os demais
 * status — a escolha e explicita, nunca uma mistura silenciosa.
 */
export async function getPlannedActualReport(
  query: PlannedActualQuery,
): Promise<ReportPageDTO<PlannedActualRowDTO>> {
  const prisma = getPrisma();
  const status = query.status ?? "COMPLETED";
  const dateField = status === "COMPLETED" ? "completedAt" : "createdAt";

  const where: Prisma.ProductionOrderWhereInput = {
    status,
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.productionOrderId ? { id: query.productionOrderId } : {}),
    ...(query.from || query.to
      ? {
          [dateField]: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { productName: { contains: query.search, mode: "insensitive" } },
            { product: { is: { name: { contains: query.search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.productionOrder.findMany({
      where,
      include: { product: true, outputs: true },
      orderBy: [{ [dateField]: "desc" }, { code: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.productionOrder.count({ where }),
  ]);

  // Custo e opcional de proposito: e um relatorio de produção, não
  // financeiro. Quando pedido, resolve uma vez por OP da PAGINA.
  const costByOrder = new Map<string, { unitCost: string | null; quality: PlannedActualRowDTO["costQuality"] }>();
  if (query.includeCost) {
    await Promise.all(
      orders.map(async (order) => {
        const cost = await getProductionOrderMaterialCost(order.id);
        costByOrder.set(order.id, { unitCost: cost.materialUnitCost, quality: cost.quality });
      }),
    );
  }

  const rows = orders.map((order): PlannedActualRowDTO => {
    const produced = order.outputs.reduce((sum, output) => sum.plus(output.quantity), new Prisma.Decimal(0));
    const usingSnapshot = order.productCode !== null;
    const cost = costByOrder.get(order.id);

    return {
      productionOrderId: order.id,
      productionOrderCode: order.code,
      productId: order.productId,
      productCode: usingSnapshot ? order.productCode! : order.product.code,
      productName: usingSnapshot ? order.productName! : order.product.name,
      formulationVersionNumber: order.formulationVersionNumber,
      plannedQuantity: order.plannedQuantity.toString(),
      producedQuantity: produced.toString(),
      variance: produced.minus(order.plannedQuantity).toString(),
      yieldPercent: order.plannedQuantity.greaterThan(0)
        ? produced.dividedBy(order.plannedQuantity).times(100).toFixed(2)
        : null,
      unitCode: order.outputUnitCode,
      startedAt: order.startedAt ? order.startedAt.toISOString() : null,
      completedAt: order.completedAt ? order.completedAt.toISOString() : null,
      status: order.status,
      materialUnitCost: cost?.unitCost ?? null,
      costQuality: cost?.quality ?? "NO_COST",
    };
  });

  return { rows, page: query.page, pageSize: query.pageSize, total };
}

/**
 * R-06 — Rastreabilidade por OP. Baseada EXCLUSIVAMENTE no que realmente
 * aconteceu: `ProductionConsumption` (consumo real) e `ProductionOutput`
 * (apontamento real). Reserva/FEFO/Requirement nunca são genealogia.
 */
export async function getProductionTraceability(
  query: ProductionTraceabilityQuery,
): Promise<ProductionTraceabilityDTO | null> {
  const prisma = getPrisma();

  const order = await prisma.productionOrder.findUnique({
    where: { id: query.productionOrderId },
    include: { product: true },
  });
  if (!order) return null;

  const [consumptionSums, outputs] = await Promise.all([
    prisma.productionConsumption.groupBy({
      by: ["itemId", "lotId"],
      where: { productionOrderId: order.id },
      _sum: { quantity: true },
    }),
    prisma.productionOutput.findMany({
      where: { productionOrderId: order.id },
      include: { lot: { include: { item: true } } },
      orderBy: { producedAt: "asc" },
    }),
  ]);

  const itemIds = [...new Set(consumptionSums.map((row) => row.itemId))];
  const lotIds = [...new Set(consumptionSums.map((row) => row.lotId).filter((id): id is string => id !== null))];
  const [items, materialLots] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: itemIds } } }),
    prisma.lot.findMany({ where: { id: { in: lotIds } }, include: { supplier: true } }),
  ]);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const lotsById = new Map(materialLots.map((lot) => [lot.id, lot]));

  const consumed: TraceabilityConsumedRowDTO[] = consumptionSums.map((row) => {
    const item = itemsById.get(row.itemId)!;
    const lot = row.lotId ? (lotsById.get(row.lotId) ?? null) : null;
    return {
      itemId: row.itemId,
      itemCode: item.code,
      itemName: item.name,
      lotId: row.lotId,
      lotCode: lot ? lot.code : null,
      supplierLot: lot ? lot.supplierLot : null,
      supplierName: lot?.supplier ? lot.supplier.legalName : null,
      quantity: (row._sum.quantity ?? new Prisma.Decimal(0)).toString(),
      unitCode: item.unitCode,
    };
  });

  // Um lote produzido pode ter vários apontamentos: agrupa por lote.
  const producedByLot = new Map<string, TraceabilityProducedRowDTO>();
  let producedQuantity = new Prisma.Decimal(0);
  for (const output of outputs) {
    producedQuantity = producedQuantity.plus(output.quantity);
    if (!output.lot) continue;
    const existing = producedByLot.get(output.lot.id);
    if (existing) {
      existing.quantity = new Prisma.Decimal(existing.quantity).plus(output.quantity).toString();
      continue;
    }
    producedByLot.set(output.lot.id, {
      lotId: output.lot.id,
      lotCode: output.lot.code,
      businessLotNumber: output.lot.businessLotNumber,
      quantity: output.quantity.toString(),
      unitCode: output.lot.item.unitCode,
      status: output.lot.status,
      isExpired: isLotExpired(output.lot),
      expiryDate: output.lot.expiryDate ? output.lot.expiryDate.toISOString() : null,
    });
  }

  const usingSnapshot = order.productCode !== null;
  return {
    productionOrderId: order.id,
    productionOrderCode: order.code,
    productId: order.productId,
    productCode: usingSnapshot ? order.productCode! : order.product.code,
    productName: usingSnapshot ? order.productName! : order.product.name,
    status: order.status,
    plannedQuantity: order.plannedQuantity.toString(),
    producedQuantity: producedQuantity.toString(),
    unitCode: order.outputUnitCode,
    completedAt: order.completedAt ? order.completedAt.toISOString() : null,
    consumed,
    produced: [...producedByLot.values()],
  };
}

/**
 * R-07 — Consumo por periodo. Periodo por `consumedAt`. O custo vem da
 * Fundacao de Custos (`getConsumedLotCostReference`), com a origem sempre
 * explicita; `NO_COST` nunca vira zero nem custo parcial disfarcado.
 */
export async function getConsumptionReport(
  query: ConsumptionQuery,
): Promise<ReportPageDTO<ConsumptionRowDTO>> {
  const prisma = getPrisma();

  const where: Prisma.ProductionConsumptionWhereInput = {
    ...(query.itemId ? { itemId: query.itemId } : {}),
    ...(query.productionOrderId ? { productionOrderId: query.productionOrderId } : {}),
    ...(query.productId ? { productionOrder: { is: { productId: query.productId } } } : {}),
    ...(query.from || query.to
      ? {
          consumedAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { item: { is: { code: { contains: query.search, mode: "insensitive" } } } },
            { item: { is: { name: { contains: query.search, mode: "insensitive" } } } },
            { lot: { is: { code: { contains: query.search, mode: "insensitive" } } } },
            { productionOrder: { is: { code: { contains: query.search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [consumptions, total] = await Promise.all([
    prisma.productionConsumption.findMany({
      where,
      include: {
        item: true,
        lot: true,
        productionOrder: { include: { product: true } },
      },
      orderBy: { consumedAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.productionConsumption.count({ where }),
  ]);

  const rows = await Promise.all(
    consumptions.map(async (consumption): Promise<ConsumptionRowDTO> => {
      const reference = await getConsumedLotCostReference(prisma, {
        itemId: consumption.itemId,
        lotId: consumption.lotId,
        consumedAt: consumption.consumedAt,
      });
      const order = consumption.productionOrder;
      const usingSnapshot = order.productCode !== null;

      return {
        id: consumption.id,
        consumedAt: consumption.consumedAt.toISOString(),
        itemId: consumption.itemId,
        itemCode: consumption.item.code,
        itemName: consumption.item.name,
        lotId: consumption.lotId,
        lotCode: consumption.lot ? consumption.lot.code : null,
        productId: order.productId,
        productCode: usingSnapshot ? order.productCode! : order.product.code,
        productName: usingSnapshot ? order.productName! : order.product.name,
        productionOrderId: order.id,
        productionOrderCode: order.code,
        quantity: consumption.quantity.toString(),
        unitCode: consumption.item.unitCode,
        unitCost: reference.unitCost ? reference.unitCost.toString() : null,
        costSource: reference.source,
        totalCost: reference.unitCost
          ? consumption.quantity.times(reference.unitCost).toFixed(2)
          : null,
      };
    }),
  );

  return { rows, page: query.page, pageSize: query.pageSize, total };
}
