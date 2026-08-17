import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, PrismaClient } from "@prisma/client";
import type {
  IndustrialCostQuality,
  IndustrialCostWarningDTO,
  IndustrialManualCostLineDTO,
  IndustrialResourceCostLineDTO,
  ProductionMaterialCostLineDTO,
  ProductionOrderCostDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { getConsumedLotCostReference } from "../../lib/cost-reference.js";
import { convertUomDecimal } from "../items/uom.js";
import { ProductionOrderNotFoundError } from "../production-orders/production-orders.errors.js";
import {
  computeManualLine,
  computeResourceCosts,
  money,
  unitMoney,
} from "./calculation.service.js";

type PrismaOrTx = PrismaClient | PrismaTypes.TransactionClient;

const THOUSAND = new Prisma.Decimal(1000);
const HUNDRED = new Prisma.Decimal(100);

const orderInclude = {
  product: true,
  formulationVersion: { select: { versionNumber: true, outputUnitCode: true } },
  consumptions: {
    include: { item: true, lot: { select: { code: true, ownerCustomerId: true } } },
    orderBy: { createdAt: "asc" } as PrismaTypes.ProductionConsumptionOrderByWithRelationInput,
  },
  outputs: { select: { quantity: true } },
  costSnapshot: true,
  industrialCostVersion: {
    include: {
      product: true,
      formulationVersion: true,
      energyResource: { include: { rates: true } },
      lines: { orderBy: { sortOrder: "asc" } as PrismaTypes.IndustrialCostLineOrderByWithRelationInput },
      resourceUsages: {
        include: { industrialResource: { include: { rates: true } } },
        orderBy: {
          sortOrder: "asc",
        } as PrismaTypes.IndustrialCostResourceUsageOrderByWithRelationInput,
      },
    },
  },
} satisfies PrismaTypes.ProductionOrderInclude;

type OrderForCost = PrismaTypes.ProductionOrderGetPayload<{ include: typeof orderInclude }>;

/**
 * Custo industrial de uma produção.
 *
 * Duas naturezas convivendo no mesmo número, e o documento nunca as
 * confunde: materiais são REALIZADOS (o lote que foi realmente consumido,
 * avaliado na data do consumo) e os demais componentes são custos PADRÃO
 * APLICADOS na proporção do que foi produzido. A Veridi não mede horas de
 * operador, horas de máquina nem kWh reais — chamar isso de "custo real"
 * seria inventar medição que ninguém fez.
 */
export async function getProductionOrderCost(
  productionOrderId: string,
): Promise<ProductionOrderCostDTO> {
  const prisma = getPrisma();
  const order = await prisma.productionOrder.findUnique({
    where: { id: productionOrderId },
    include: orderInclude,
  });
  if (!order) throw new ProductionOrderNotFoundError(productionOrderId);

  // Concluída com snapshot: o histórico é o snapshot, não um recálculo.
  if (order.costSnapshot) {
    const stored = order.costSnapshot.breakdown as unknown as ProductionOrderCostDTO;
    return {
      ...stored,
      snapshotId: order.costSnapshot.id,
      snapshotCreatedAt: order.costSnapshot.createdAt.toISOString(),
    };
  }

  return computeProductionOrderCost(prisma, order);
}

async function computeProductionOrderCost(
  prisma: PrismaOrTx,
  order: OrderForCost,
): Promise<ProductionOrderCostDTO> {
  const units = await prisma.unitOfMeasure.findMany();
  const warnings: IndustrialCostWarningDTO[] = [];

  const producedQuantity = order.outputs.reduce(
    (total, output) => total.plus(output.quantity),
    new Prisma.Decimal(0),
  );

  // ── materiais realizados ──────────────────────────────────
  const materials: ProductionMaterialCostLineDTO[] = [];
  let actualMaterialCostKnown = new Prisma.Decimal(0);
  let materialMissing = false;
  let hasCustomerSuppliedMaterials = false;

  for (const consumption of order.consumptions) {
    const customerSupplied = consumption.lot?.ownerCustomerId != null;
    if (customerSupplied) {
      // Material do cliente: propriedade de terceiro, fora do custo Veridi.
      hasCustomerSuppliedMaterials = true;
      materials.push({
        consumptionId: consumption.id,
        itemCode: consumption.item.code,
        itemName: consumption.item.name,
        lotCode: consumption.lot?.code ?? null,
        quantity: consumption.quantity.toString(),
        unitCode: consumption.item.unitCode,
        consumedAt: consumption.consumedAt.toISOString(),
        customerSupplied: true,
        unitCost: null,
        costSource: "EXCLUDED_CUSTOMER_SUPPLIED",
        subtotal: null,
      });
      continue;
    }

    // Regra da Foundation preservada: a referência é a data do PRÓPRIO
    // consumo, nunca "hoje" — compras posteriores não valorizam o passado.
    const reference = await getConsumedLotCostReference(prisma, {
      itemId: consumption.itemId,
      lotId: consumption.lotId,
      consumedAt: consumption.consumedAt,
    });
    const subtotal = reference.unitCost ? consumption.quantity.times(reference.unitCost) : null;
    if (subtotal) actualMaterialCostKnown = actualMaterialCostKnown.plus(subtotal);
    else {
      materialMissing = true;
      warnings.push({
        code: "MATERIAL_COST_UNKNOWN",
        message: `${consumption.item.code}: consumo sem custo conhecido.`,
      });
    }

    materials.push({
      consumptionId: consumption.id,
      itemCode: consumption.item.code,
      itemName: consumption.item.name,
      lotCode: consumption.lot?.code ?? null,
      quantity: consumption.quantity.toString(),
      unitCode: consumption.item.unitCode,
      consumedAt: consumption.consumedAt.toISOString(),
      customerSupplied: false,
      unitCost: reference.unitCost ? unitMoney(reference.unitCost) : null,
      costSource: reference.source,
      subtotal: subtotal ? money(subtotal) : null,
    });
  }

  // ── custos padrão aplicados ───────────────────────────────
  const version = order.industrialCostVersion;
  let standardApplied: IndustrialResourceCostLineDTO[] = [];
  let standardAppliedManual: IndustrialManualCostLineDTO[] = [];
  let laborKnown = new Prisma.Decimal(0);
  let equipmentKnown = new Prisma.Decimal(0);
  let energy: Prisma.Decimal | null = null;
  let secondaryPackaging = new Prisma.Decimal(0);
  let thirdParty = new Prisma.Decimal(0);
  let other = new Prisma.Decimal(0);
  let overhead = new Prisma.Decimal(0);
  let standardMissing = false;
  let allocationFactor: Prisma.Decimal | null = null;

  if (!version) {
    // Produzir sem estrutura de custos é legítimo — o custo é que fica
    // incompleto, e o documento diz isso em vez de fingir um total.
    standardMissing = true;
    warnings.push({
      code: "NO_COST_STRUCTURE",
      message:
        "Esta OP não tem estrutura de custos vinculada — os custos industriais adicionais não estão estruturados.",
    });
  } else {
    const referenceInOutputUom = convertUomDecimal(
      version.referenceOutputQuantity,
      version.referenceOutputUomCode,
      order.outputUnitCode,
      units,
    );
    allocationFactor = referenceInOutputUom.greaterThan(0)
      ? producedQuantity.dividedBy(referenceInOutputUom)
      : null;

    // Os recursos são aplicados proporcionalmente ao que saiu de fato: a
    // EC descreve uma base industrial, e metade da base custa metade.
    const resourceCosts = await computeResourceCosts(
      prisma,
      version,
      producedQuantity,
      order.completedAt ?? new Date(),
    );
    standardApplied = resourceCosts.lines;
    laborKnown = resourceCosts.laborKnown;
    equipmentKnown = resourceCosts.equipmentKnown;
    energy = resourceCosts.energy;
    if (resourceCosts.missing) standardMissing = true;
    warnings.push(...resourceCosts.warnings);

    const unitsPerBox = version.unitsPerShippingBoxSnapshot ?? version.product.unitsPerShippingBox;
    const percentLines: { rate: Prisma.Decimal; index: number }[] = [];

    for (const line of version.lines) {
      const computed = computeManualLine(
        line,
        producedQuantity,
        version.referenceOutputQuantity,
        unitsPerBox,
      );
      standardAppliedManual.push(computed.line);

      if (computed.percentOfDirect) {
        if (!computed.known || !line.rateValue) standardMissing = true;
        else percentLines.push({ rate: line.rateValue, index: standardAppliedManual.length - 1 });
        continue;
      }
      if (!computed.known || !computed.amount) {
        standardMissing = true;
        warnings.push({
          code: "MANUAL_RATE_UNKNOWN",
          message: `"${line.description}" está sem valor informado na estrutura de custos.`,
        });
        continue;
      }
      if (line.category === "SECONDARY_PACKAGING") {
        secondaryPackaging = secondaryPackaging.plus(computed.amount);
      } else if (line.category === "THIRD_PARTY_SERVICE") {
        thirdParty = thirdParty.plus(computed.amount);
      } else if (line.category === "OTHER") {
        other = other.plus(computed.amount);
      } else {
        overhead = overhead.plus(computed.amount);
      }
    }

    const directComplete = !materialMissing && !standardMissing;
    const directKnown = actualMaterialCostKnown
      .plus(laborKnown)
      .plus(equipmentKnown)
      .plus(energy ?? new Prisma.Decimal(0))
      .plus(secondaryPackaging)
      .plus(thirdParty)
      .plus(other);

    for (const percent of percentLines) {
      if (!directComplete) {
        standardMissing = true;
        continue;
      }
      const amount = directKnown.times(percent.rate).dividedBy(HUNDRED);
      overhead = overhead.plus(amount);
      standardAppliedManual[percent.index] = {
        ...standardAppliedManual[percent.index]!,
        subtotal: money(amount),
      };
    }
  }

  const standardAppliedCostKnown = laborKnown
    .plus(equipmentKnown)
    .plus(energy ?? new Prisma.Decimal(0))
    .plus(secondaryPackaging)
    .plus(thirdParty)
    .plus(other)
    .plus(overhead);

  const knownSubtotal = actualMaterialCostKnown.plus(standardAppliedCostKnown);
  const complete = !materialMissing && !standardMissing;
  const totalIndustrialCost = complete ? knownSubtotal : null;

  const costPerProducedUnit =
    totalIndustrialCost && producedQuantity.greaterThan(0)
      ? totalIndustrialCost.dividedBy(producedQuantity)
      : null;
  if (producedQuantity.lessThanOrEqualTo(0)) {
    warnings.push({
      code: "NO_PRODUCED_QUANTITY",
      message: "Nenhuma produção confirmada ainda — não há custo por unidade.",
    });
  }

  let quality: IndustrialCostQuality;
  if (!complete) {
    quality = knownSubtotal.greaterThan(0) ? "PARTIAL" : "NO_COST";
  } else {
    // Materiais realizados vêm de aquisição real ou do histórico real do
    // item: nenhuma oferta de fornecedor entra no custo de uma produção.
    quality = "COMPLETE_REAL_REFERENCE";
  }

  return {
    productionOrderId: order.id,
    productionOrderCode: order.code,
    productCode: order.productCode ?? order.product.code,
    productName: order.productName ?? order.product.name,
    formulationVersionNumber:
      order.formulationVersionNumber ?? order.formulationVersion?.versionNumber ?? null,
    industrialCostVersionId: version?.id ?? null,
    industrialCostVersionLabel: version ? `${version.code} · V${version.versionNumber}` : null,

    producedQuantity: producedQuantity.toString(),
    outputUnitCode: order.outputUnitCode,
    allocationFactor: allocationFactor ? allocationFactor.toString() : null,

    materials,
    standardApplied,
    standardAppliedManual,

    actualMaterialCostKnown: money(actualMaterialCostKnown),
    standardAppliedLaborKnown: money(laborKnown),
    standardAppliedEquipmentKnown: money(equipmentKnown),
    standardAppliedEnergy: energy ? money(energy) : null,
    standardAppliedSecondaryPackagingKnown: money(secondaryPackaging),
    standardAppliedThirdPartyKnown: money(thirdParty),
    standardAppliedOtherKnown: money(other),
    standardAppliedOverheadKnown: money(overhead),
    standardAppliedCostKnown: money(standardAppliedCostKnown),

    totalIndustrialCost: totalIndustrialCost ? money(totalIndustrialCost) : null,
    knownSubtotal: money(knownSubtotal),
    costPerProducedUnit: costPerProducedUnit ? unitMoney(costPerProducedUnit) : null,

    quality,
    // Produção em andamento ainda pode consumir e produzir mais.
    status: order.status === "COMPLETED" ? "FINAL" : "PROVISIONAL",
    hybrid: standardAppliedCostKnown.greaterThan(0) && actualMaterialCostKnown.greaterThan(0),
    hasCustomerSuppliedMaterials,
    warnings,
    snapshotId: null,
    snapshotCreatedAt: null,
  };
}

/**
 * Congela o custo industrial na conclusão da OP.
 *
 * Idempotente: concluir de novo (retry) nunca cria um segundo snapshot. A
 * partir daqui, informar o custo de um recebimento ou reajustar uma tarifa
 * não reescreve este documento — correção retroativa, se um dia existir,
 * será uma revisão explícita de custo.
 */
export async function createProductionOrderCostSnapshot(
  tx: PrismaOrTx,
  productionOrderId: string,
): Promise<void> {
  const existing = await tx.productionOrderCostSnapshot.findUnique({
    where: { productionOrderId },
  });
  if (existing) return;

  const order = await tx.productionOrder.findUnique({
    where: { id: productionOrderId },
    include: orderInclude,
  });
  if (!order) return;

  const result = await computeProductionOrderCost(tx, order);

  await tx.productionOrderCostSnapshot.create({
    data: {
      productionOrderId,
      ...(order.industrialCostVersionId
        ? { industrialCostVersionId: order.industrialCostVersionId }
        : {}),
      ...(result.formulationVersionNumber !== null
        ? { formulationVersionNumber: result.formulationVersionNumber }
        : {}),
      completedAt: order.completedAt ?? new Date(),
      producedQuantity: new Prisma.Decimal(result.producedQuantity),
      outputUnitCode: result.outputUnitCode,
      actualMaterialCostKnown: new Prisma.Decimal(result.actualMaterialCostKnown),
      standardAppliedCostKnown: new Prisma.Decimal(result.standardAppliedCostKnown),
      knownSubtotal: new Prisma.Decimal(result.knownSubtotal),
      totalIndustrialCost: result.totalIndustrialCost
        ? new Prisma.Decimal(result.totalIndustrialCost)
        : null,
      costPerProducedUnit: result.costPerProducedUnit
        ? new Prisma.Decimal(result.costPerProducedUnit)
        : null,
      quality: result.quality,
      breakdown: { ...result, status: "FINAL" } as unknown as Prisma.InputJsonValue,
    },
  });
}

/**
 * Estrutura de custos compatível com a formulação de uma OP.
 *
 * "Compatível" é literal: a EC ativa precisa apontar para a MESMA versão de
 * formulação que a OP vai executar. Vincular uma EC de outra receita seria
 * atribuir à produção premissas que não são dela.
 */
export async function findCompatibleCostVersion(
  tx: PrismaOrTx,
  params: { productId: string; formulationVersionId: string | null },
): Promise<{ id: string } | null> {
  if (!params.formulationVersionId) return null;
  return tx.industrialCostVersion.findFirst({
    where: {
      productId: params.productId,
      status: "ACTIVE",
      formulationVersionId: params.formulationVersionId,
    },
    select: { id: true },
  });
}

export { THOUSAND };
