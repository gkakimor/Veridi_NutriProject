import { Prisma } from "@prisma/client";
import type { Lot } from "@prisma/client";
import type {
  FinishedLotTraceabilityDTO,
  LotTraceabilityDTO,
  RawMaterialLotTraceabilityDTO,
  RawMaterialUsageFinishedLotDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";

/**
 * Genealogia baseada SEMPRE em ProductionConsumption (o que foi realmente
 * consumido) e ProductionOutput (o que foi realmente produzido) — nunca em
 * Requirement/MaterialReservation/sugestao FEFO. Um lote so reservado e
 * nunca consumido nunca aparece aqui.
 */

async function buildFinishedLotTraceability(lot: Lot): Promise<FinishedLotTraceabilityDTO> {
  const prisma = getPrisma();

  const order = await prisma.productionOrder.findUniqueOrThrow({
    where: { id: lot.productionOrderId! },
  });

  const producedAgg = await prisma.productionOutput.aggregate({
    where: { lotId: lot.id },
    _sum: { quantity: true },
  });
  const producedQuantity = producedAgg._sum.quantity ?? new Prisma.Decimal(0);

  const consumptionSums = await prisma.productionConsumption.groupBy({
    by: ["itemId", "lotId"],
    where: { productionOrderId: order.id },
    _sum: { quantity: true },
  });

  const itemIds = [...new Set(consumptionSums.map((row) => row.itemId))];
  const lotIds = [...new Set(consumptionSums.map((row) => row.lotId).filter((id): id is string => id !== null))];

  const [items, materialLots] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: itemIds } } }),
    prisma.lot.findMany({
      where: { id: { in: lotIds } },
      include: { supplier: true, ownerCustomer: true },
    }),
  ]);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const lotsById = new Map(materialLots.map((materialLot) => [materialLot.id, materialLot]));

  const consumedMaterials = consumptionSums.map((row) => {
    const item = itemsById.get(row.itemId)!;
    const materialLot = row.lotId ? (lotsById.get(row.lotId) ?? null) : null;
    return {
      itemId: row.itemId,
      itemCode: item.code,
      itemName: item.name,
      lotId: row.lotId,
      lotCode: materialLot ? materialLot.code : null,
      supplierLot: materialLot ? materialLot.supplierLot : null,
      supplierName: materialLot?.supplier ? materialLot.supplier.legalName : null,
      ownerType: materialLot?.ownerType ?? "VERIDI",
      ownerCustomerName: materialLot?.ownerCustomer?.legalName ?? null,
      coaStatus: materialLot?.coaStatus ?? "NOT_REQUIRED",
      quantity: (row._sum.quantity ?? new Prisma.Decimal(0)).toString(),
      unitCode: item.unitCode,
    };
  });

  return {
    kind: "FINISHED_GOOD",
    lotId: lot.id,
    lotCode: lot.code,
    businessLotNumber: lot.businessLotNumber,
    productionOrderId: order.id,
    productionOrderCode: order.code,
    productId: order.productId,
    productCode: order.productCode!,
    productName: order.productName!,
    producedQuantity: producedQuantity.toString(),
    unitCode: order.outputUnitCode,
    consumedMaterials,
  };
}

async function buildRawMaterialLotTraceability(lot: Lot): Promise<RawMaterialLotTraceabilityDTO> {
  const prisma = getPrisma();

  const item = await prisma.item.findUniqueOrThrow({ where: { id: lot.itemId } });

  // Só metadados do laudo: a genealogia nunca carrega o binário do PDF.
  const coaDocuments = await prisma.attachment.findMany({
    where: { lotId: lot.id, documentType: "COA", archivedAt: null },
    orderBy: { uploadedAt: "desc" },
  });

  const consumptionSums = await prisma.productionConsumption.groupBy({
    by: ["productionOrderId"],
    where: { lotId: lot.id },
    _sum: { quantity: true },
  });

  // Consumo em amostra tambem e saida fisica: aparece na rastreabilidade
  // para frente mesmo sem Ordem de Producao.
  const sampleConsumptions = await prisma.sampleConsumption.findMany({
    where: { lotId: lot.id },
    include: { projectSample: { include: { project: { include: { customer: true } } } } },
    orderBy: { executedAt: "asc" },
  });

  const orderIds = consumptionSums.map((row) => row.productionOrderId);
  const [orders, outputs] = await Promise.all([
    prisma.productionOrder.findMany({ where: { id: { in: orderIds } } }),
    prisma.productionOutput.findMany({
      where: { productionOrderId: { in: orderIds }, lotId: { not: null } },
      include: { lot: true },
    }),
  ]);
  const ordersById = new Map(orders.map((order) => [order.id, order]));

  const outputsByOrder = new Map<string, typeof outputs>();
  for (const output of outputs) {
    const list = outputsByOrder.get(output.productionOrderId) ?? [];
    list.push(output);
    outputsByOrder.set(output.productionOrderId, list);
  }

  const usedIn = consumptionSums.map((row) => {
    const order = ordersById.get(row.productionOrderId)!;
    const orderOutputs = outputsByOrder.get(row.productionOrderId) ?? [];

    const finishedLotsById = new Map<string, RawMaterialUsageFinishedLotDTO>();
    for (const output of orderOutputs) {
      if (!output.lot) continue;
      const existing = finishedLotsById.get(output.lot.id);
      const producedSoFar = existing ? new Prisma.Decimal(existing.producedQuantity) : new Prisma.Decimal(0);
      finishedLotsById.set(output.lot.id, {
        lotId: output.lot.id,
        lotCode: output.lot.code,
        businessLotNumber: output.lot.businessLotNumber,
        producedQuantity: producedSoFar.plus(output.quantity).toString(),
      });
    }

    return {
      productionOrderId: order.id,
      productionOrderCode: order.code,
      productId: order.productId,
      productCode: order.productCode!,
      productName: order.productName!,
      consumedQuantity: (row._sum.quantity ?? new Prisma.Decimal(0)).toString(),
      unitCode: item.unitCode,
      finishedLots: [...finishedLotsById.values()],
    };
  });

  const usedInSamples = sampleConsumptions.map((consumption) => {
    const sample = consumption.projectSample;
    return {
      sampleId: sample.id,
      sampleCode: sample.code,
      testLabel: `T${sample.testSequence}`,
      projectCode: sample.project.code,
      projectName: sample.project.name,
      customerName: sample.project.customer.legalName,
      sampleStatus: sample.status,
      consumedQuantity: consumption.quantity.toString(),
      unitCode: consumption.uomCode,
      consumedAt: consumption.executedAt.toISOString(),
    };
  });

  return {
    kind: "RAW_MATERIAL",
    lotId: lot.id,
    lotCode: lot.code,
    itemId: lot.itemId,
    itemCode: item.code,
    itemName: item.name,
    coaStatus: lot.coaStatus,
    coaDocuments: coaDocuments.map((document) => ({
      id: document.id,
      originalFileName: document.originalFileName,
      uploadedAt: document.uploadedAt.toISOString(),
      uploadedByName: document.uploadedByNameSnapshot,
    })),
    usedIn,
    usedInSamples,
  };
}

/**
 * `origin=PRODUCTION` -> rastreabilidade BACKWARD (lote de produto acabado
 * ate as materias-primas realmente consumidas). Qualquer outro lote ->
 * rastreabilidade FORWARD (o que foi realmente produzido a partir dele).
 */
export async function getLotTraceability(lotId: string): Promise<LotTraceabilityDTO | null> {
  const lot = await getPrisma().lot.findUnique({ where: { id: lotId } });
  if (!lot) return null;

  return lot.origin === "PRODUCTION"
    ? buildFinishedLotTraceability(lot)
    : buildRawMaterialLotTraceability(lot);
}
