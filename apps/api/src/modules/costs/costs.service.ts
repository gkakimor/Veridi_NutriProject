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
import { getConsumedLotCostReference, getItemCostReference } from "../../lib/cost-reference.js";
import { selectItemCostSource } from "../../lib/cost-source-selection.js";
import type { CostSourceResolution } from "../../lib/cost-source-selection.js";
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
 *
 * A FONTE de cada custo unitário vem de `selectItemCostSource` — a mesma
 * função que o cálculo de custo industrial e o CMV chamam (PRODUCT_RULES
 * §53). Esta estimativa lia só a fundação de compras (30d → 90d → última) e
 * ignorava oferta válida e referência manual, então Formulação e CMV podiam
 * responder custos diferentes para o mesmo item na mesma data. Não existe
 * segunda hierarquia aqui: quantidade, unidade e soma são desta função; a
 * escolha da fonte, não.
 *
 * `referenceDate` é explícita: quem decide que "hoje" é a data é a borda
 * (rota), nunca o domínio.
 */
export async function getFormulationCostEstimate(
  formulationVersionId: string,
  referenceDate: Date,
): Promise<FormulationCostEstimateDTO> {
  const prisma: PrismaOrTx = getPrisma();
  const version = await prisma.formulationVersion.findUnique({
    where: { id: formulationVersionId },
    include: { components: { include: { item: true }, orderBy: { position: "asc" } } },
  });
  if (!version) throw new FormulationVersionNotFoundError(formulationVersionId);

  const units = await prisma.unitOfMeasure.findMany();

  // Uma seleção por componente Veridi, em paralelo — a mesma função resolvida
  // N vezes, sem cache nem cópia da regra. Material do cliente não pergunta
  // nada: não tem custo de aquisição Veridi, e uma referência manual no item
  // não muda isso.
  const resolutions = await Promise.all(
    version.components.map((component) =>
      component.supplyResponsibility === "CUSTOMER"
        ? Promise.resolve<CostSourceResolution>({
            unitCost: null,
            source: "EXCLUDED_CUSTOMER_SUPPLIED",
            details: null,
          })
        : selectItemCostSource(
            prisma,
            { itemId: component.itemId, itemUnitCode: component.item.unitCode, referenceDate },
            units,
          ),
    ),
  );

  const components: FormulationCostComponentDTO[] = [];
  const missingCostItems: string[] = [];
  const ambiguousCostItems: string[] = [];
  let knownSubtotal = new Prisma.Decimal(0);
  let veridiComponents = 0;
  let veridiWithCost = 0;
  let customerSupplied = 0;

  version.components.forEach((component, index) => {
    const item = component.item;
    const resolution = resolutions[index]!;
    // Reaproveita a MESMA conversao de UOM ja usada pelos Requirements —
    // nunca uma segunda implementacao.
    const normalized = convertUomDecimal(component.quantity, component.unitCode, item.unitCode, units);
    const isCustomerSupplied = resolution.source === "EXCLUDED_CUSTOMER_SUPPLIED";

    const componentCost = resolution.unitCost ? normalized.times(resolution.unitCost) : null;
    if (isCustomerSupplied) {
      customerSupplied += 1;
    } else {
      veridiComponents += 1;
      if (componentCost) {
        knownSubtotal = knownSubtotal.plus(componentCost);
        veridiWithCost += 1;
      } else if (resolution.source === "AMBIGUOUS_SUPPLIER_REFERENCE") {
        // Ofertas existem, falta escolher — a lista separa isso de "sem
        // fonte nenhuma", porque a solução é outra.
        ambiguousCostItems.push(item.code);
      } else {
        missingCostItems.push(item.code);
      }
    }

    components.push({
      itemId: item.id,
      itemCode: item.code,
      itemName: item.name,
      formulaQuantity: component.quantity.toString(),
      formulaUnitCode: component.unitCode,
      normalizedQuantity: normalized.toString(),
      stockUnitCode: item.unitCode,
      unitCost: resolution.unitCost ? formatUnitCost(resolution.unitCost) : null,
      costSource: resolution.source,
      costSourceDetails: resolution.details,
      customerSupplied: isCustomerSupplied,
      estimatedComponentCost: componentCost ? formatAmount(componentCost) : null,
    });
  });

  // Qualidade avaliada SÓ sobre o material Veridi: componente do cliente sem
  // custo não rebaixa a estimativa para PARTIAL — ele não tem custo a ter.
  let quality: FormulationCostEstimateDTO["quality"];
  if (veridiComponents === 0 || veridiWithCost === 0) {
    quality = "NO_COST";
  } else if (veridiWithCost === veridiComponents) {
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
    referenceDate: referenceDate.toISOString(),
    components,
    quality,
    estimatedMaterialCost: estimatedMaterialCost ? formatAmount(estimatedMaterialCost) : null,
    estimatedMaterialUnitCost: estimatedMaterialUnitCost ? formatUnitCost(estimatedMaterialUnitCost) : null,
    knownCostSubtotal: veridiWithCost > 0 ? formatAmount(knownSubtotal) : null,
    missingCostItems,
    ambiguousCostItems,
    hasCustomerSuppliedMaterials: customerSupplied > 0,
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
      consumptions: {
        include: { item: true, lot: { include: { ownerCustomer: true } } },
        orderBy: { createdAt: "asc" },
      },
      outputs: true,
    },
  });
  if (!order) throw new ProductionOrderNotFoundError(productionOrderId);

  const consumptions: ProductionConsumptionCostDTO[] = [];
  const missingCostItems: string[] = [];
  let knownSubtotal = new Prisma.Decimal(0);
  let withCost = 0;
  let veridiConsumptionCount = 0;
  let customerSuppliedConsumptionCount = 0;
  let allReal = true;

  for (const consumption of order.consumptions) {
    // Material do cliente NAO tem custo de aquisicao da Veridi. Isso nao e
    // "custo desconhecido": e propriedade de terceiro. Fica fora do total,
    // fora da qualidade e nunca vira zero persistido.
    const isCustomerOwned = consumption.lot?.ownerType === "CUSTOMER";

    const reference = isCustomerOwned
      ? { unitCost: null, source: "NO_COST" as const, details: null }
      : await getConsumedLotCostReference(prisma, {
          itemId: consumption.itemId,
          lotId: consumption.lotId,
          consumedAt: consumption.consumedAt,
        });

    const materialCost =
      !isCustomerOwned && reference.unitCost ? consumption.quantity.times(reference.unitCost) : null;
    if (isCustomerOwned) {
      customerSuppliedConsumptionCount += 1;
    } else {
      veridiConsumptionCount += 1;
      if (materialCost) {
        knownSubtotal = knownSubtotal.plus(materialCost);
        withCost += 1;
      } else {
        missingCostItems.push(consumption.item.code);
      }
      if (reference.source !== "REAL") allReal = false;
    }

    consumptions.push({
      consumptionId: consumption.id,
      ownerType: consumption.lot?.ownerType ?? "VERIDI",
      ownerCustomerName: consumption.lot?.ownerCustomer?.legalName ?? null,
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

  // Qualidade avaliada SO sobre os consumos da Veridi: dois componentes do
  // cliente sem preco nao transformam um custo real em PARTIAL.
  let quality: CostQuality;
  if (veridiConsumptionCount === 0 || withCost === 0) {
    quality = "NO_COST";
  } else if (withCost < veridiConsumptionCount) {
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
    hasCustomerSuppliedMaterials: customerSuppliedConsumptionCount > 0,
    customerSuppliedConsumptionCount,
    totalMaterialCost: totalMaterialCost ? formatAmount(totalMaterialCost) : null,
    knownMaterialCostSubtotal: withCost > 0 ? formatAmount(knownSubtotal) : null,
    producedQuantity: producedQuantity.toString(),
    outputUnitCode: order.outputUnitCode,
    materialUnitCost: materialUnitCost ? formatUnitCost(materialUnitCost) : null,
    missingCostItems,
  };
}
