import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, PrismaClient, User } from "@prisma/client";
import type {
  CustomerSuppliedMaterialDTO,
  IndustrialCostCalculationDTO,
  IndustrialCostQuality,
  IndustrialCostWarningDTO,
  IndustrialManualCostLineDTO,
  IndustrialMaterialCostLineDTO,
  IndustrialResourceCostLineDTO,
} from "@veridi/shared";
import { REAL_REFERENCE_SOURCES } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { convertUomDecimal } from "../items/uom.js";
import { computeFormulationRequirements } from "../production-orders/requirement-calc.js";
import { pickCurrentRate } from "../industrial-resources/industrial-resources.service.js";
import { IndustrialCostVersionNotFoundError } from "../industrial-costs/industrial-costs.errors.js";
import { resolveMaterialCost } from "./material-cost.js";

type PrismaOrTx = PrismaClient | PrismaTypes.TransactionClient;

const THOUSAND = new Prisma.Decimal(1000);
const HUNDRED = new Prisma.Decimal(100);

/** Dinheiro composto com 2 casas; custo unitário mantém 6. */
export function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

export function unitMoney(value: Prisma.Decimal): string {
  return value.toFixed(6);
}

const versionInclude = {
  product: true,
  formulationVersion: true,
  energyResource: { include: { rates: true } },
  lines: { orderBy: { sortOrder: "asc" } as PrismaTypes.IndustrialCostLineOrderByWithRelationInput },
  resourceUsages: {
    include: { industrialResource: { include: { rates: true } } },
    orderBy: { sortOrder: "asc" } as PrismaTypes.IndustrialCostResourceUsageOrderByWithRelationInput,
  },
} satisfies PrismaTypes.IndustrialCostVersionInclude;

export type VersionForCalculation = PrismaTypes.IndustrialCostVersionGetPayload<{
  include: typeof versionInclude;
}>;

type UsageRow = VersionForCalculation["resourceUsages"][number];
type LineRow = VersionForCalculation["lines"][number];

/**
 * Consumo de um recurso escalado para uma quantidade de saída.
 *
 * A base declara o que a fábrica planejou: por lote de referência, por
 * unidade acabada ou por mil unidades. Escalar é aritmética da base — não
 * há modelagem de setup versus tempo de máquina nesta fase.
 */
export function scaledUsageQuantity(
  usage: { usageBasis: string; usageQuantity: Prisma.Decimal },
  outputQuantity: Prisma.Decimal,
  referenceOutputQuantity: Prisma.Decimal,
): Prisma.Decimal {
  if (usage.usageBasis === "PER_OUTPUT_UNIT") return usage.usageQuantity.times(outputQuantity);
  if (usage.usageBasis === "PER_1000_OUTPUT_UNITS") {
    return usage.usageQuantity.times(outputQuantity.dividedBy(THOUSAND));
  }
  // FIXED_PER_REFERENCE_BATCH: proporcional à fração da base produzida.
  if (referenceOutputQuantity.lessThanOrEqualTo(0)) return usage.usageQuantity;
  return usage.usageQuantity.times(outputQuantity.dividedBy(referenceOutputQuantity));
}

/**
 * Tarifa aplicável a um uso de recurso.
 *
 * Versão congelada usa o snapshot da ativação — reajustar a hora hoje não
 * reescreve custo histórico. Rascunho usa a tarifa vigente na data de
 * referência, e isso fica explicitamente marcado como referência.
 */
export function rateForUsage(
  usage: UsageRow,
  frozen: boolean,
  referenceDate: Date,
): { rate: Prisma.Decimal | null; draftReference: boolean } {
  if (frozen) return { rate: usage.rateValueSnapshot, draftReference: false };
  const current = pickCurrentRate(usage.industrialResource.rates, referenceDate);
  return { rate: current?.rateValue ?? null, draftReference: true };
}

/** Caixas são inteiras: ninguém expede 2,08 caixas. */
export function shippingBoxes(
  outputQuantity: Prisma.Decimal,
  unitsPerBox: number | null,
): Prisma.Decimal | null {
  if (!unitsPerBox || unitsPerBox <= 0) return null;
  return outputQuantity.dividedBy(new Prisma.Decimal(unitsPerBox)).ceil();
}

export interface ManualLineComputation {
  line: IndustrialManualCostLineDTO;
  /** Percentuais são calculados depois, sobre o custo direto. */
  percentOfDirect: boolean;
  amount: Prisma.Decimal | null;
  known: boolean;
}

/**
 * Premissa manual aplicada a uma quantidade de saída.
 *
 * Percentual não entra na base: uma porcentagem sobre custo direto que
 * também compusesse o custo direto seria percentual recursivo.
 */
export function computeManualLine(
  line: LineRow,
  outputQuantity: Prisma.Decimal,
  referenceOutputQuantity: Prisma.Decimal,
  unitsPerBox: number | null,
): ManualLineComputation {
  const base: IndustrialManualCostLineDTO = {
    lineId: line.id,
    category: line.category,
    description: line.description,
    calculationBasis: line.calculationBasis,
    rateValue: line.rateValue ? line.rateValue.toString() : null,
    computedUnits: null,
    subtotal: null,
  };

  if (line.calculationBasis === "PERCENT_OF_DIRECT_INDUSTRIAL_COST") {
    return { line: base, percentOfDirect: true, amount: null, known: line.rateValue !== null };
  }

  // Valor não informado continua desconhecido — nunca R$ 0,00.
  if (line.rateValue === null) {
    return { line: base, percentOfDirect: false, amount: null, known: false };
  }

  if (line.calculationBasis === "FIXED_PER_BATCH") {
    const factor = referenceOutputQuantity.greaterThan(0)
      ? outputQuantity.dividedBy(referenceOutputQuantity)
      : new Prisma.Decimal(1);
    const amount = line.rateValue.times(factor);
    return {
      line: { ...base, subtotal: money(amount) },
      percentOfDirect: false,
      amount,
      known: true,
    };
  }

  if (line.calculationBasis === "PER_OUTPUT_UNIT") {
    const amount = line.rateValue.times(outputQuantity);
    return {
      line: { ...base, subtotal: money(amount) },
      percentOfDirect: false,
      amount,
      known: true,
    };
  }

  if (line.calculationBasis === "PER_1000_OUTPUT_UNITS") {
    const amount = line.rateValue.times(outputQuantity.dividedBy(THOUSAND));
    return {
      line: { ...base, subtotal: money(amount) },
      percentOfDirect: false,
      amount,
      known: true,
    };
  }

  // PER_SHIPPING_BOX
  const boxes = shippingBoxes(outputQuantity, unitsPerBox);
  if (!boxes) {
    return { line: base, percentOfDirect: false, amount: null, known: false };
  }
  const amount = line.rateValue.times(boxes);
  return {
    line: { ...base, computedUnits: boxes.toString(), subtotal: money(amount) },
    percentOfDirect: false,
    amount,
    known: true,
  };
}

/**
 * Tarifa que valoriza o kWh derivado dos equipamentos.
 *
 * Vem do recurso de energia ESCOLHIDO na estrutura. O modo derivado não tem
 * linha de consumo de energia (isso é exclusivo do modo direto), e adivinhar
 * a tarifa a partir do cadastro — "o único ativo", "o mais recente" — seria
 * inventar premissa econômica.
 */
export function derivedEnergyRate(
  version: VersionForCalculation,
  referenceDate: Date,
): { rate: Prisma.Decimal | null; resourceName: string | null; selected: boolean } {
  if (!version.energyResource) return { rate: null, resourceName: null, selected: false };
  const current = pickCurrentRate(version.energyResource.rates, referenceDate);
  return {
    rate: current?.rateValue ?? null,
    resourceName: version.energyResource.name,
    selected: true,
  };
}

export interface ResourceCostResult {
  lines: IndustrialResourceCostLineDTO[];
  laborKnown: Prisma.Decimal;
  equipmentKnown: Prisma.Decimal;
  /** `null` quando a energia deveria compor o custo e não é conhecida. */
  energy: Prisma.Decimal | null;
  derivedEnergyKwh: Prisma.Decimal | null;
  missing: boolean;
  warnings: IndustrialCostWarningDTO[];
  draftReference: boolean;
}

/**
 * Custo dos recursos industriais para uma quantidade de saída.
 *
 * Mão de obra e equipamento: consumo × tarifa. Energia depende do modo —
 * direto usa o kWh planejado, derivado usa Σ(horas × kW) e a tarifa do
 * cadastro. `NONE` significa energia não estruturada, o que deixa o custo
 * incompleto: nunca energia zero.
 */
export async function computeResourceCosts(
  _prisma: PrismaOrTx,
  version: VersionForCalculation,
  outputQuantity: Prisma.Decimal,
  referenceDate: Date,
): Promise<ResourceCostResult> {
  const frozen = version.status !== "DRAFT";
  const lines: IndustrialResourceCostLineDTO[] = [];
  const warnings: IndustrialCostWarningDTO[] = [];

  let laborKnown = new Prisma.Decimal(0);
  let equipmentKnown = new Prisma.Decimal(0);
  let energy: Prisma.Decimal | null = null;
  let derivedEnergyKwh: Prisma.Decimal | null = null;
  let missing = false;
  let draftReference = false;

  let derivedTotal = new Prisma.Decimal(0);
  let derivedComplete = true;
  let hasEquipment = false;

  for (const usage of version.resourceUsages) {
    const type = usage.resourceTypeSnapshot ?? usage.industrialResource.type;
    const quantity = scaledUsageQuantity(usage, outputQuantity, version.referenceOutputQuantity);
    const { rate, draftReference: isDraftRate } = rateForUsage(usage, frozen, referenceDate);
    if (isDraftRate) draftReference = true;

    const name = usage.resourceNameSnapshot ?? usage.industrialResource.name;
    const subtotal = rate ? quantity.times(rate) : null;

    if (type === "LABOR" || type === "EQUIPMENT") {
      if (subtotal) {
        if (type === "LABOR") laborKnown = laborKnown.plus(subtotal);
        else equipmentKnown = equipmentKnown.plus(subtotal);
      } else {
        missing = true;
        warnings.push({
          code: "RESOURCE_RATE_UNKNOWN",
          message: `"${name}" não tem tarifa conhecida — o custo deste recurso ficou em aberto.`,
        });
      }
    }

    if (type === "EQUIPMENT") {
      hasEquipment = true;
      const power = usage.powerKwSnapshot ?? usage.industrialResource.powerKw;
      if (power) derivedTotal = derivedTotal.plus(quantity.times(power));
      else derivedComplete = false;
    }

    lines.push({
      resourceId: usage.industrialResourceId,
      resourceCode: usage.industrialResource.code,
      resourceName: name,
      resourceType: type,
      quantity: quantity.toString(),
      quantityUom: usage.usageUom,
      rateValue: rate ? rate.toString() : null,
      rateIsDraftReference: isDraftRate,
      subtotal: subtotal ? money(subtotal) : null,
    });
  }

  if (version.energyCalculationMode === "NONE") {
    // Energia não estruturada não é energia zero: o custo fica incompleto.
    missing = true;
    warnings.push({
      code: "ENERGY_NOT_CONFIGURED",
      message: "A energia desta estrutura não foi configurada — o custo de energia é desconhecido.",
    });
  }

  if (version.energyCalculationMode === "DIRECT") {
    const energyUsages = version.resourceUsages.filter(
      (usage) => (usage.resourceTypeSnapshot ?? usage.industrialResource.type) === "ENERGY",
    );
    if (energyUsages.length === 0) {
      missing = true;
      warnings.push({
        code: "ENERGY_RESOURCE_MISSING",
        message: "Modo de energia direto sem consumo informado.",
      });
    } else {
      let total = new Prisma.Decimal(0);
      let complete = true;
      for (const usage of energyUsages) {
        const quantity = scaledUsageQuantity(usage, outputQuantity, version.referenceOutputQuantity);
        const { rate } = rateForUsage(usage, frozen, referenceDate);
        if (!rate) {
          complete = false;
          continue;
        }
        total = total.plus(quantity.times(rate));
      }
      if (complete) energy = total;
      else missing = true;
    }
  }

  if (version.energyCalculationMode === "FROM_EQUIPMENT") {
    if (!hasEquipment) {
      missing = true;
      warnings.push({
        code: "ENERGY_RESOURCE_MISSING",
        message: "Energia derivada dos equipamentos, mas nenhum equipamento foi planejado.",
      });
    } else if (!derivedComplete) {
      // Um equipamento sem potência deixa o consumo em aberto: somar só os
      // conhecidos mostraria um consumo menor como se fosse o real.
      missing = true;
      warnings.push({
        code: "EQUIPMENT_POWER_UNKNOWN",
        message: "Há equipamento sem potência informada — a energia derivada ficou em aberto.",
      });
    } else {
      derivedEnergyKwh = derivedTotal;
      const selected = derivedEnergyRate(version, referenceDate);
      if (selected.rate) {
        energy = derivedTotal.times(selected.rate);
        warnings.push({
          code: "ENERGY_RATE_CURRENT_REFERENCE",
          message: `Energia derivada valorizada pela tarifa vigente de "${selected.resourceName}" na data de referência.`,
        });
      } else {
        missing = true;
        warnings.push({
          code: selected.selected ? "ENERGY_RATE_UNKNOWN" : "ENERGY_RATE_NOT_SELECTED",
          message: selected.selected
            ? `"${selected.resourceName}" não tem tarifa vigente para valorizar o consumo derivado.`
            : "Nenhum recurso de energia foi escolhido para valorizar o consumo derivado dos equipamentos.",
        });
      }
    }
  }

  return {
    lines,
    laborKnown,
    equipmentKnown,
    energy,
    derivedEnergyKwh,
    missing,
    warnings,
    draftReference,
  };
}

/**
 * Cálculo do custo industrial PADRÃO/PROSPECTIVO de uma estrutura numa data.
 *
 * Responde "quanto custa produzir a base de referência desta EC pelas
 * informações conhecidas nesta data". Não é o custo realizado de nenhuma
 * produção, e a data nunca é `new Date()` escondido no domínio: quem chama
 * decide, e recalcular amanhã pode dar outro número — por isso existe
 * snapshot.
 */
export async function calculateIndustrialCost(
  versionId: string,
  costReferenceDate: Date,
): Promise<IndustrialCostCalculationDTO> {
  const prisma = getPrisma();
  const version = await prisma.industrialCostVersion.findUnique({
    where: { id: versionId },
    include: versionInclude,
  });
  if (!version) throw new IndustrialCostVersionNotFoundError(versionId);

  const units = await prisma.unitOfMeasure.findMany();
  const warnings: IndustrialCostWarningDTO[] = [];

  // A base da EC pode estar numa unidade diferente da saída da formulação —
  // a conversão usa o mesmo registro de UOM de todo o resto.
  const referenceOutputInFormulaUom = convertUomDecimal(
    version.referenceOutputQuantity,
    version.referenceOutputUomCode,
    version.formulationVersion.outputUnitCode,
    units,
  );

  // Quantidade física vem da MESMA matemática dos Requirements — pureza e
  // overage inclusos, sem segunda implementação da fórmula.
  const requirements = await computeFormulationRequirements(
    prisma,
    version.formulationVersionId,
    referenceOutputInFormulaUom,
  );

  const materials: IndustrialMaterialCostLineDTO[] = [];
  const customerSuppliedMaterials: CustomerSuppliedMaterialDTO[] = [];
  let materialsSubtotalKnown = new Prisma.Decimal(0);
  let materialMissing = false;
  let anyEstimate = false;
  let veridiMaterialCount = 0;

  for (const requirement of requirements) {
    if (requirement.supplyResponsibility === "CUSTOMER") {
      // Material do cliente pertence à estrutura física, não ao custo
      // Veridi. Isso não é custo zero nem custo desconhecido.
      customerSuppliedMaterials.push({
        itemId: requirement.itemId,
        itemCode: requirement.itemCode,
        itemName: requirement.itemName,
        requiredQuantity: requirement.requiredQuantity.toString(),
        unitCode: requirement.stockUnitCode,
      });
      materials.push({
        itemId: requirement.itemId,
        itemCode: requirement.itemCode,
        itemName: requirement.itemName,
        requiredQuantity: requirement.requiredQuantity.toString(),
        unitCode: requirement.stockUnitCode,
        customerSupplied: true,
        unitCost: null,
        costSource: "EXCLUDED_CUSTOMER_SUPPLIED",
        costSourceDetails: null,
        subtotal: null,
      });
      continue;
    }

    veridiMaterialCount += 1;
    const resolution = await resolveMaterialCost(
      prisma,
      {
        itemId: requirement.itemId,
        itemUnitCode: requirement.stockUnitCode,
        referenceDate: costReferenceDate,
      },
      units,
    );

    const subtotal = resolution.unitCost
      ? requirement.requiredQuantity.times(resolution.unitCost)
      : null;
    if (subtotal) {
      materialsSubtotalKnown = materialsSubtotalKnown.plus(subtotal);
      if (!REAL_REFERENCE_SOURCES.includes(resolution.source)) anyEstimate = true;
    } else {
      materialMissing = true;
      warnings.push({
        code:
          resolution.source === "AMBIGUOUS_SUPPLIER_REFERENCE"
            ? "AMBIGUOUS_SUPPLIER_REFERENCE"
            : "MATERIAL_COST_UNKNOWN",
        message:
          resolution.source === "AMBIGUOUS_SUPPLIER_REFERENCE"
            ? `${requirement.itemCode}: há múltiplas referências de fornecedor e nenhum preferencial.`
            : `${requirement.itemCode}: sem custo conhecido.`,
      });
    }

    materials.push({
      itemId: requirement.itemId,
      itemCode: requirement.itemCode,
      itemName: requirement.itemName,
      requiredQuantity: requirement.requiredQuantity.toString(),
      unitCode: requirement.stockUnitCode,
      customerSupplied: false,
      unitCost: resolution.unitCost ? unitMoney(resolution.unitCost) : null,
      costSource: resolution.source,
      costSourceDetails: resolution.details,
      subtotal: subtotal ? money(subtotal) : null,
    });
  }

  const resourceCosts = await computeResourceCosts(
    prisma,
    version,
    version.referenceOutputQuantity,
    costReferenceDate,
  );
  warnings.push(...resourceCosts.warnings);

  const unitsPerBox = version.unitsPerShippingBoxSnapshot ?? version.product.unitsPerShippingBox;
  const manualLines: IndustrialManualCostLineDTO[] = [];
  const buckets = {
    SECONDARY_PACKAGING: new Prisma.Decimal(0),
    THIRD_PARTY_SERVICE: new Prisma.Decimal(0),
    OTHER: new Prisma.Decimal(0),
    OVERHEAD: new Prisma.Decimal(0),
  };
  let manualMissing = false;
  const percentLines: { line: LineRow; index: number }[] = [];

  for (const line of version.lines) {
    const computed = computeManualLine(
      line,
      version.referenceOutputQuantity,
      version.referenceOutputQuantity,
      unitsPerBox,
    );
    manualLines.push(computed.line);

    if (computed.percentOfDirect) {
      if (!computed.known) {
        manualMissing = true;
        warnings.push({
          code: "MANUAL_RATE_UNKNOWN",
          message: `"${line.description}" está sem valor informado.`,
        });
      } else {
        percentLines.push({ line, index: manualLines.length - 1 });
      }
      continue;
    }

    if (!computed.known || !computed.amount) {
      manualMissing = true;
      warnings.push({
        code:
          line.calculationBasis === "PER_SHIPPING_BOX" && !unitsPerBox
            ? "SHIPPING_BOX_NOT_CONFIGURED"
            : "MANUAL_RATE_UNKNOWN",
        message:
          line.calculationBasis === "PER_SHIPPING_BOX" && !unitsPerBox
            ? `"${line.description}" usa caixa de expedição, mas o produto não tem unidades por caixa.`
            : `"${line.description}" está sem valor informado.`,
      });
      continue;
    }

    buckets[line.category] = buckets[line.category].plus(computed.amount);
  }

  // Custo industrial direto: tudo que o processo daquele produto exige,
  // antes do overhead. Material do cliente nunca entra.
  const directKnown = materialsSubtotalKnown
    .plus(resourceCosts.laborKnown)
    .plus(resourceCosts.equipmentKnown)
    .plus(resourceCosts.energy ?? new Prisma.Decimal(0))
    .plus(buckets.SECONDARY_PACKAGING)
    .plus(buckets.THIRD_PARTY_SERVICE)
    .plus(buckets.OTHER);

  const directComplete = !materialMissing && !resourceCosts.missing && !manualMissing;
  const directIndustrialCost = directComplete ? directKnown : null;

  // Percentuais só existem sobre um custo direto completo — aplicar sobre
  // subtotal parcial produziria um overhead menor que o real.
  let overheadKnown = buckets.OVERHEAD;
  for (const percent of percentLines) {
    if (!directIndustrialCost || !percent.line.rateValue) continue;
    const amount = directIndustrialCost.times(percent.line.rateValue).dividedBy(HUNDRED);
    overheadKnown = overheadKnown.plus(amount);
    manualLines[percent.index] = { ...manualLines[percent.index]!, subtotal: money(amount) };
  }
  if (percentLines.length > 0 && !directIndustrialCost) {
    warnings.push({
      code: "PERCENT_BASE_UNKNOWN",
      message:
        "Há premissa percentual sobre o custo industrial direto, que ainda não está completo.",
    });
  }

  const totalIndustrialCost = directIndustrialCost
    ? directIndustrialCost.plus(overheadKnown)
    : null;
  const knownSubtotal = directKnown.plus(buckets.OVERHEAD);

  const costPerUnit =
    totalIndustrialCost && version.referenceOutputQuantity.greaterThan(0)
      ? totalIndustrialCost.dividedBy(version.referenceOutputQuantity)
      : null;

  let quality: IndustrialCostQuality;
  if (!directComplete) {
    quality = knownSubtotal.greaterThan(0) ? "PARTIAL" : "NO_COST";
  } else if (veridiMaterialCount > 0 && anyEstimate) {
    quality = "COMPLETE_WITH_ESTIMATES";
  } else {
    quality = "COMPLETE_REAL_REFERENCE";
  }

  if (version.status === "DRAFT") {
    warnings.push({
      code: "DRAFT_REFERENCE",
      message:
        "Estrutura em rascunho: tarifas e premissas ainda podem mudar até a ativação.",
    });
  }

  return {
    industrialCostVersionId: version.id,
    industrialCostVersionLabel: `${version.code} · V${version.versionNumber}`,
    structureStatus: version.status,
    draftReference: version.status === "DRAFT" || resourceCosts.draftReference,

    productId: version.productId,
    productCode: version.productCodeSnapshot ?? version.product.code,
    productName: version.productNameSnapshot ?? version.product.name,
    customerName: version.customerNameSnapshot,
    formulationVersionNumber:
      version.formulationVersionNumberSnapshot ?? version.formulationVersion.versionNumber,

    referenceOutputQuantity: version.referenceOutputQuantity.toString(),
    referenceOutputUomCode: version.referenceOutputUomCode,
    unitsPerShippingBox: unitsPerBox,
    costReferenceDate: costReferenceDate.toISOString(),
    calculatedAt: new Date().toISOString(),

    materials,
    resources: resourceCosts.lines,
    manualLines,
    customerSuppliedMaterials,
    hasCustomerSuppliedMaterials: customerSuppliedMaterials.length > 0,

    energyCalculationMode: version.energyCalculationMode,
    derivedEnergyKwh: resourceCosts.derivedEnergyKwh
      ? resourceCosts.derivedEnergyKwh.toString()
      : null,

    materialsSubtotalKnown: money(materialsSubtotalKnown),
    laborSubtotalKnown: money(resourceCosts.laborKnown),
    equipmentSubtotalKnown: money(resourceCosts.equipmentKnown),
    energySubtotal: resourceCosts.energy ? money(resourceCosts.energy) : null,
    secondaryPackagingSubtotalKnown: money(buckets.SECONDARY_PACKAGING),
    thirdPartySubtotalKnown: money(buckets.THIRD_PARTY_SERVICE),
    otherSubtotalKnown: money(buckets.OTHER),
    overheadSubtotalKnown: money(overheadKnown),

    directIndustrialCost: directIndustrialCost ? money(directIndustrialCost) : null,
    totalIndustrialCost: totalIndustrialCost ? money(totalIndustrialCost) : null,
    knownSubtotal: money(knownSubtotal),
    costPerUnit: costPerUnit ? unitMoney(costPerUnit) : null,
    costPer1000: costPerUnit ? money(costPerUnit.times(THOUSAND)) : null,

    quality,
    warnings,
  };
}

/** Actor opcional: o cálculo em si não escreve nada. */
export type CalculationActor = Pick<User, "id" | "name">;
