import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type {
  CostQuality,
  CostReferenceDTO,
  FormulationCostComponentDTO,
  FormulationCostEstimateDTO,
  ProductionConsumptionCostDTO,
  ProductionOrderMaterialCostDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import {
  getConsumedLotCostReference,
  getItemCostReference,
  getItemCostReferences,
} from "../../lib/cost-reference.js";
import { convertUomDecimal } from "../items/uom.js";
import { ItemNotFoundError } from "../inventory/inventory.errors.js";
import { FormulationVersionNotFoundError } from "./costs.errors.js";
import { ProductionOrderNotFoundError } from "../production-orders/production-orders.errors.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/** Dinheiro/custo unitario sempre com 4 casas; valores compostos com 2. */
function formatUnitCost(value: Prisma.Decimal): string {
  return value.toFixed(4);
}

function formatAmount(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

export async function getItemCostReferenceDTO(
  itemId: string,
  referenceDate?: Date,
): Promise<CostReferenceDTO> {
  const prisma = getPrisma();
  const item = await prisma.item.findUnique({ where: { id: itemId } });
  if (!item) throw new ItemNotFoundError(itemId);

  const reference = await getItemCostReference(prisma, itemId, referenceDate ?? new Date());
  return {
    itemId: item.id,
    itemCode: item.code,
    itemName: item.name,
    unitCode: item.unitCode,
    unitCost: reference.unitCost ? formatUnitCost(reference.unitCost) : null,
    source: reference.source,
    referenceDate: reference.referenceDate.toISOString(),
    details: reference.details,
  };
}

/**
 * Custo estimado de uma versao de formulacao. SEMPRE uma previsao — mesmo
 * com todos os componentes em referencia recente, a fórmula e um plano,
 * nao um realizado. Por isso a qualidade agregada nunca e `REAL` aqui.
 * Nunca persistido: a versao e historica/imutavel, a referencia de custo
 * muda com o tempo.
 */
export async function getFormulationCostEstimate(
  formulationVersionId: string,
  referenceDate?: Date,
): Promise<FormulationCostEstimateDTO> {
  const prisma: PrismaOrTx = getPrisma();
  const version = await prisma.formulationVersion.findUnique({
    where: { id: formulationVersionId },
    include: { components: { include: { item: true }, orderBy: { position: "asc" } } },
  });
  if (!version) throw new FormulationVersionNotFoundError(formulationVersionId);

  const effectiveDate = referenceDate ?? new Date();
  const [units, costByItem] = await Promise.all([
    prisma.unitOfMeasure.findMany(),
    getItemCostReferences(
      prisma,
      version.components.map((component) => component.itemId),
      effectiveDate,
    ),
  ]);

  const components: FormulationCostComponentDTO[] = [];
  const missingCostItems: string[] = [];
  let knownSubtotal = new Prisma.Decimal(0);
  let componentsWithCost = 0;

  for (const component of version.components) {
    const item = component.item;
    // Reaproveita a MESMA conversao de UOM ja usada pelos Requirements —
    // nunca uma segunda implementacao.
    const normalized = convertUomDecimal(component.quantity, component.unitCode, item.unitCode, units);
    const reference = costByItem.get(item.id)!;

    const componentCost = reference.unitCost ? normalized.times(reference.unitCost) : null;
    if (componentCost) {
      knownSubtotal = knownSubtotal.plus(componentCost);
      componentsWithCost += 1;
    } else {
      missingCostItems.push(item.code);
    }

    components.push({
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      formulaQuantity: component.quantity.toString(),
      formulaUnitCode: component.unitCode,
      normalizedQuantity: normalized.toString(),
      stockUnitCode: item.unitCode,
      unitCost: reference.unitCost ? formatUnitCost(reference.unitCost) : null,
      costSource: reference.source,
      estimatedComponentCost: componentCost ? formatAmount(componentCost) : null,
    });
  }

  let quality: FormulationCostEstimateDTO["quality"];
  if (components.length === 0 || componentsWithCost === 0) {
    quality = "NO_COST";
  } else if (componentsWithCost === components.length) {
    quality = "ESTIMATED";
  } else {
    quality = "PARTIAL";
  }

  // `PARTIAL` nunca apresenta o subtotal conhecido como total completo.
  const estimatedMaterialCost = quality === "ESTIMATED" ? knownSubtotal : null;
  const estimatedMaterialUnitCost =
    estimatedMaterialCost && version.basisQuantity.greaterThan(0)
      ? estimatedMaterialCost.dividedBy(version.basisQuantity)
      : null;

  return {
    formulationVersionId: version.id,
    basisQuantity: version.basisQuantity.toString(),
    outputUnitCode: version.outputUnitCode,
    referenceDate: effectiveDate.toISOString(),
    components,
    quality,
    estimatedMaterialCost: estimatedMaterialCost ? formatAmount(estimatedMaterialCost) : null,
    estimatedMaterialUnitCost: estimatedMaterialUnitCost ? formatUnitCost(estimatedMaterialUnitCost) : null,
    knownCostSubtotal: componentsWithCost > 0 ? formatAmount(knownSubtotal) : null,
    missingCostItems,
  };
}

/**
 * Custo de materiais de uma OP a partir do `ProductionConsumption`
 * REALMENTE registrado — nunca Requirement, Reservation, sugestao FEFO ou
 * formulacao planejada. Cada consumo usa o custo do LOTE efetivamente
 * consumido quando ele existe (`REAL`); caso contrario, fallback
 * historico do Item na data do proprio consumo.
 */
export async function getProductionOrderMaterialCost(
  productionOrderId: string,
): Promise<ProductionOrderMaterialCostDTO> {
  const prisma = getPrisma();
  const order = await prisma.productionOrder.findUnique({
    where: { id: productionOrderId },
    include: {
      consumptions: { include: { item: true, lot: true }, orderBy: { createdAt: "asc" } },
      outputs: true,
    },
  });
  if (!order) throw new ProductionOrderNotFoundError(productionOrderId);

  const consumptions: ProductionConsumptionCostDTO[] = [];
  const missingCostItems: string[] = [];
  let knownSubtotal = new Prisma.Decimal(0);
  let withCost = 0;
  let allReal = true;

  for (const consumption of order.consumptions) {
    const reference = await getConsumedLotCostReference(prisma, {
      itemId: consumption.itemId,
      lotId: consumption.lotId,
      consumedAt: consumption.consumedAt,
    });

    const materialCost = reference.unitCost ? consumption.quantity.times(reference.unitCost) : null;
    if (materialCost) {
      knownSubtotal = knownSubtotal.plus(materialCost);
      withCost += 1;
    } else {
      missingCostItems.push(consumption.item.code);
    }
    if (reference.source !== "REAL") allReal = false;

    consumptions.push({
      consumptionId: consumption.id,
      itemId: consumption.itemId,
      itemCode: consumption.item.code,
      itemName: consumption.item.name,
      lotId: consumption.lotId,
      lotCode: consumption.lot ? consumption.lot.code : null,
      quantity: consumption.quantity.toString(),
      unitCode: consumption.item.unitCode,
      unitCost: reference.unitCost ? formatUnitCost(reference.unitCost) : null,
      costSource: reference.source,
      materialCost: materialCost ? formatAmount(materialCost) : null,
      referenceDate: consumption.consumedAt.toISOString(),
    });
  }

  let quality: CostQuality;
  if (consumptions.length === 0 || withCost === 0) {
    quality = "NO_COST";
  } else if (withCost < consumptions.length) {
    quality = "PARTIAL";
  } else if (allReal) {
    quality = "REAL";
  } else {
    quality = "ESTIMATED";
  }

  // `PARTIAL` nunca apresenta o subtotal conhecido como total completo.
  const totalMaterialCost = quality === "REAL" || quality === "ESTIMATED" ? knownSubtotal : null;

  // Divisor SEMPRE a producao real (soma dos ProductionOutput), nunca a
  // quantidade planejada — e isso que faz o custo unitario refletir
  // naturalmente o rendimento/perda da OP.
  const producedQuantity = order.outputs.reduce(
    (sum, output) => sum.plus(output.quantity),
    new Prisma.Decimal(0),
  );
  const materialUnitCost =
    totalMaterialCost && producedQuantity.greaterThan(0)
      ? totalMaterialCost.dividedBy(producedQuantity)
      : null;

  return {
    productionOrderId: order.id,
    consumptions,
    quality,
    totalMaterialCost: totalMaterialCost ? formatAmount(totalMaterialCost) : null,
    knownMaterialCostSubtotal: withCost > 0 ? formatAmount(knownSubtotal) : null,
    producedQuantity: producedQuantity.toString(),
    outputUnitCode: order.outputUnitCode,
    materialUnitCost: materialUnitCost ? formatUnitCost(materialUnitCost) : null,
    missingCostItems,
  };
}
