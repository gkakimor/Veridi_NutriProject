import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, PrismaClient } from "@prisma/client";
import type {
  IndustrialCostCalculationDTO,
  IndustrialCostQuality,
  IndustrialCostWarningDTO,
} from "@veridi/shared";
import { REAL_REFERENCE_SOURCES } from "@veridi/shared";
import { convertUomDecimal } from "../items/uom.js";
import { computeFormulationRequirements } from "../production-orders/requirement-calc.js";
import {
  batchCountFor,
  computeManualLine,
  money,
  scaledUsageQuantity,
  shippingBoxes,
  unitMoney,
} from "../industrial-cost-calculation/calculation.service.js";

type PrismaOrTx = PrismaClient | PrismaTypes.TransactionClient;

const THOUSAND = new Prisma.Decimal(1000);
const HUNDRED = new Prisma.Decimal(100);

export const pricingVersionInclude = {
  energyResource: true,
  product: true,
  formulationVersion: true,
  lines: { orderBy: { sortOrder: "asc" } as PrismaTypes.IndustrialCostLineOrderByWithRelationInput },
  resourceUsages: {
    include: { industrialResource: true },
    orderBy: { sortOrder: "asc" } as PrismaTypes.IndustrialCostResourceUsageOrderByWithRelationInput,
  },
} satisfies PrismaTypes.IndustrialCostVersionInclude;

export type CostVersionForPricing = PrismaTypes.IndustrialCostVersionGetPayload<{
  include: typeof pricingVersionInclude;
}>;

export interface TierCostResult {
  quantity: Prisma.Decimal;
  batchCount: Prisma.Decimal;
  total: Prisma.Decimal | null;
  perUnit: Prisma.Decimal | null;
  per1000: Prisma.Decimal | null;
  knownSubtotal: Prisma.Decimal;
  quality: IndustrialCostQuality;
  warnings: IndustrialCostWarningDTO[];
  hasCustomerSuppliedMaterials: boolean;
}

/**
 * Base econômica CONGELADA de um cálculo salvo.
 *
 * Preço unitário de material, tarifa de recurso, tarifa de energia e valor
 * de premissa saem do `CALC`, nunca de uma nova consulta: se uma compra
 * entrar enquanto alguém negocia 300, 500 e 1000 unidades, as três faixas
 * precisam continuar falando da mesma realidade econômica.
 */
function frozenBasis(calculation: IndustrialCostCalculationDTO) {
  const materialUnitCost = new Map<
    string,
    { unitCost: Prisma.Decimal | null; source: string }
  >();
  for (const material of calculation.materials) {
    materialUnitCost.set(material.itemId, {
      unitCost: material.unitCost ? new Prisma.Decimal(material.unitCost) : null,
      source: material.costSource,
    });
  }

  const resourceRate = new Map<string, Prisma.Decimal | null>();
  for (const resource of calculation.resources) {
    resourceRate.set(
      resource.resourceId,
      resource.rateValue ? new Prisma.Decimal(resource.rateValue) : null,
    );
  }

  const manualRate = new Map<string, Prisma.Decimal | null>();
  for (const line of calculation.manualLines) {
    manualRate.set(line.lineId, line.rateValue ? new Prisma.Decimal(line.rateValue) : null);
  }

  // Cálculos salvos antes da tarifa de energia existir no resultado: deriva
  // do próprio par kWh × dinheiro em vez de buscar tarifa nova.
  let energyRate = calculation.energyRate ? new Prisma.Decimal(calculation.energyRate) : null;
  if (!energyRate && calculation.energySubtotal && calculation.derivedEnergyKwh) {
    const kwh = new Prisma.Decimal(calculation.derivedEnergyKwh);
    if (kwh.greaterThan(0)) energyRate = new Prisma.Decimal(calculation.energySubtotal).dividedBy(kwh);
  }

  return { materialUnitCost, resourceRate, manualRate, energyRate };
}

/**
 * Custo industrial para UMA quantidade, na base econômica do cálculo salvo.
 *
 * Quantidade muda custo unitário: custo fixo por lote não se dilui abaixo de
 * um lote, caixa de expedição é inteira e recurso por lote de referência
 * acompanha a contagem de lotes. Por isso nunca se multiplica o custo
 * unitário do `CALC` por uma quantidade qualquer.
 */
export async function costForOutputQuantity(
  prisma: PrismaOrTx,
  params: {
    costVersion: CostVersionForPricing;
    calculation: IndustrialCostCalculationDTO;
    quantity: Prisma.Decimal;
    quantityUomCode: string;
  },
): Promise<TierCostResult> {
  const { costVersion, calculation, quantity } = params;
  const basis = frozenBasis(calculation);
  const warnings: IndustrialCostWarningDTO[] = [];
  const units = await prisma.unitOfMeasure.findMany();

  const quantityInReferenceUom = convertUomDecimal(
    quantity,
    params.quantityUomCode,
    costVersion.referenceOutputUomCode,
    units,
  );
  const batchCount = batchCountFor(quantityInReferenceUom, costVersion.referenceOutputQuantity);

  // ── materiais ─────────────────────────────────────────────
  const quantityInFormulaUom = convertUomDecimal(
    quantity,
    params.quantityUomCode,
    costVersion.formulationVersion.outputUnitCode,
    units,
  );
  const requirements = await computeFormulationRequirements(
    prisma,
    costVersion.formulationVersionId,
    quantityInFormulaUom,
  );

  let materialsKnown = new Prisma.Decimal(0);
  let materialMissing = false;
  let anyEstimate = false;
  let hasCustomerSuppliedMaterials = false;

  for (const requirement of requirements) {
    if (requirement.supplyResponsibility === "CUSTOMER") {
      // Material do cliente é estrutura física, não custo Veridi — e isso
      // não degrada a qualidade do custo.
      hasCustomerSuppliedMaterials = true;
      continue;
    }
    const frozen = basis.materialUnitCost.get(requirement.itemId);
    if (!frozen || !frozen.unitCost) {
      materialMissing = true;
      warnings.push({
        code: "MATERIAL_COST_UNKNOWN",
        message: `${requirement.itemCode}: sem custo conhecido no cálculo de referência.`,
      });
      continue;
    }
    if (!REAL_REFERENCE_SOURCES.includes(frozen.source as never)) anyEstimate = true;
    materialsKnown = materialsKnown.plus(requirement.requiredQuantity.times(frozen.unitCost));
  }

  if (hasCustomerSuppliedMaterials) {
    warnings.push({
      code: "CUSTOMER_SUPPLIED_MATERIAL",
      message: "Contém material fornecido pelo cliente, que não entra no custo Veridi.",
    });
  }

  // ── recursos ──────────────────────────────────────────────
  let laborKnown = new Prisma.Decimal(0);
  let equipmentKnown = new Prisma.Decimal(0);
  let energy: Prisma.Decimal | null = null;
  let resourceMissing = false;

  let derivedKwh = new Prisma.Decimal(0);
  let derivedComplete = true;
  let hasEquipment = false;

  for (const usage of costVersion.resourceUsages) {
    const type = usage.resourceTypeSnapshot ?? usage.industrialResource.type;
    const scaled = scaledUsageQuantity(
      usage,
      quantityInReferenceUom,
      costVersion.referenceOutputQuantity,
      "BATCH_AWARE",
    );
    const rate = basis.resourceRate.get(usage.industrialResourceId) ?? null;

    if (type === "LABOR" || type === "EQUIPMENT") {
      if (rate) {
        const amount = scaled.times(rate);
        if (type === "LABOR") laborKnown = laborKnown.plus(amount);
        else equipmentKnown = equipmentKnown.plus(amount);
      } else {
        resourceMissing = true;
        warnings.push({
          code: "RESOURCE_RATE_UNKNOWN",
          message: `"${usage.resourceNameSnapshot ?? usage.industrialResource.name}" sem tarifa no cálculo de referência.`,
        });
      }
    }

    if (type === "EQUIPMENT") {
      hasEquipment = true;
      const power = usage.powerKwSnapshot ?? usage.industrialResource.powerKw;
      if (power) derivedKwh = derivedKwh.plus(scaled.times(power));
      else derivedComplete = false;
    }

    if (type === "ENERGY" && costVersion.energyCalculationMode === "DIRECT") {
      if (rate) energy = (energy ?? new Prisma.Decimal(0)).plus(scaled.times(rate));
      else resourceMissing = true;
    }
  }

  if (costVersion.energyCalculationMode === "NONE") {
    // Energia não estruturada nunca é energia de graça.
    resourceMissing = true;
    warnings.push({
      code: "ENERGY_NOT_CONFIGURED",
      message: "A energia desta estrutura não foi configurada.",
    });
  }

  if (costVersion.energyCalculationMode === "DIRECT" && energy === null) {
    resourceMissing = true;
    warnings.push({
      code: "ENERGY_RESOURCE_MISSING",
      message: "Modo de energia direto sem consumo utilizável no cálculo de referência.",
    });
  }

  if (costVersion.energyCalculationMode === "FROM_EQUIPMENT") {
    if (!hasEquipment || !derivedComplete || !basis.energyRate) {
      // Um equipamento sem potência ou sem tarifa deixa a energia em aberto:
      // somar só o que é conhecido mostraria consumo menor que o real.
      resourceMissing = true;
      warnings.push({
        code: "ENERGY_UNKNOWN",
        message: "Energia derivada indisponível no cálculo de referência.",
      });
    } else {
      energy = derivedKwh.times(basis.energyRate);
    }
  }

  // ── premissas manuais ─────────────────────────────────────
  const unitsPerBox =
    costVersion.unitsPerShippingBoxSnapshot ?? costVersion.product.unitsPerShippingBox;
  let secondaryPackaging = new Prisma.Decimal(0);
  let thirdParty = new Prisma.Decimal(0);
  let other = new Prisma.Decimal(0);
  let overhead = new Prisma.Decimal(0);
  let manualMissing = false;
  const percentRates: Prisma.Decimal[] = [];

  for (const line of costVersion.lines) {
    // O valor vem do CALC quando ele congelou a linha; a estrutura ativa é
    // imutável, mas a base econômica oficial continua sendo o cálculo.
    const frozenRate = basis.manualRate.has(line.id)
      ? basis.manualRate.get(line.id)!
      : line.rateValue;
    const computed = computeManualLine(
      { ...line, rateValue: frozenRate },
      quantityInReferenceUom,
      costVersion.referenceOutputQuantity,
      unitsPerBox,
      "BATCH_AWARE",
    );

    if (computed.percentOfDirect) {
      if (!computed.known || !frozenRate) manualMissing = true;
      else percentRates.push(frozenRate);
      continue;
    }
    if (!computed.known || !computed.amount) {
      manualMissing = true;
      warnings.push({
        code:
          line.calculationBasis === "PER_SHIPPING_BOX" && !unitsPerBox
            ? "SHIPPING_BOX_NOT_CONFIGURED"
            : "MANUAL_RATE_UNKNOWN",
        message: `"${line.description}" sem valor utilizável no cálculo de referência.`,
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

  const directKnown = materialsKnown
    .plus(laborKnown)
    .plus(equipmentKnown)
    .plus(energy ?? new Prisma.Decimal(0))
    .plus(secondaryPackaging)
    .plus(thirdParty)
    .plus(other);

  const complete = !materialMissing && !resourceMissing && !manualMissing;
  const direct = complete ? directKnown : null;

  // Percentual só existe sobre custo direto completo — aplicar sobre
  // subtotal parcial produziria overhead menor que o real.
  for (const rate of percentRates) {
    if (!direct) continue;
    overhead = overhead.plus(direct.times(rate).dividedBy(HUNDRED));
  }

  const total = direct ? direct.plus(overhead) : null;
  const knownSubtotal = directKnown.plus(overhead);
  const perUnit = total && quantity.greaterThan(0) ? total.dividedBy(quantity) : null;

  let quality: IndustrialCostQuality;
  if (!complete) quality = knownSubtotal.greaterThan(0) ? "PARTIAL" : "NO_COST";
  else if (anyEstimate) quality = "COMPLETE_WITH_ESTIMATES";
  else quality = "COMPLETE_REAL_REFERENCE";

  return {
    quantity,
    batchCount,
    total,
    perUnit,
    per1000: perUnit ? perUnit.times(THOUSAND) : null,
    knownSubtotal,
    quality,
    warnings,
    hasCustomerSuppliedMaterials,
  };
}

export { HUNDRED, THOUSAND, money, unitMoney, shippingBoxes };
