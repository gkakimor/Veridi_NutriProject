import type {
  IndustrialCostCalculationSnapshotDTO,
  IndustrialCostMaterialDTO,
  IndustrialCostResourceUsageDTO,
  IndustrialCostVersionDTO,
  IndustrialResourceCostLineDTO,
  ProductCmvResponse,
} from "@veridi/shared";

/**
 * Amostras de teste da Estrutura de custos, do CMV e do Cálculo de custo com
 * a quantidade de recursos (§87) e os ajustes de Formulação — compartilhadas
 * pelo teste de conteúdo (DOM) e pelo teste de arquivo (PDF real).
 *
 * Os números vêm prontos, como a API entrega: o total do recurso é do
 * servidor, nunca multiplicado aqui.
 */

export function usoDeRecurso(extra: Partial<IndustrialCostResourceUsageDTO>): IndustrialCostResourceUsageDTO {
  return {
    id: "uso-1",
    resourceId: "res-1",
    resourceCode: "RIN-000001",
    resourceName: "Operador de produção",
    resourceNameSnapshot: null,
    resourceType: "LABOR",
    usageQuantity: "2",
    usageUom: "HOUR",
    resourceCount: 1,
    totalUsageQuantity: "2",
    usageBasis: "FIXED_PER_REFERENCE_BATCH",
    notes: null,
    currentRate: null,
    rateValueSnapshot: "42.00",
    rateUomSnapshot: "HOUR",
    derivedEnergyKwh: null,
    ...extra,
  } as unknown as IndustrialCostResourceUsageDTO;
}

function material(
  itemCode: string,
  itemName: string,
  quantity: string,
  unitCode: string,
  purityPercentApplied: string | null,
  overagePercent: string | null,
  extra: Partial<IndustrialCostMaterialDTO> = {},
): IndustrialCostMaterialDTO {
  return {
    itemId: `item-${itemCode}`,
    itemCode,
    itemName,
    itemType: unitCode === "un" ? "PACKAGING" : "RAW_MATERIAL",
    quantity,
    unitCode,
    basis: unitCode === "un" ? "PER_FINISHED_UNIT" : "FIXED_BASIS",
    purityPercentApplied,
    overagePercent,
    customerSupplied: false,
    ...extra,
  };
}

/** Pureza/overage de propósito: valor informado, 0% informado e não informado (null). */
export const MATERIAIS_BASE: IndustrialCostMaterialDTO[] = [
  material("MP-000101", "Whey Protein Concentrado 80% (WPC 80)", "1450", "kg", "80", "2"),
  material("MP-000117", "Vitamina C (ácido ascórbico)", "2.7", "kg", "0", null),
  material("EMB-000206", "Rótulo BOPP 900 g — Baunilha", "3000", "un", null, "0", { customerSupplied: true }),
];

export const RECURSOS_BASE: IndustrialCostResourceUsageDTO[] = [
  // Dois operadores iguais, 2 h cada: 4 h de mão de obra (total do servidor).
  usoDeRecurso({
    id: "uso-op",
    resourceCode: "RIN-000001",
    resourceName: "Operador de produção",
    resourceCount: 2,
    usageQuantity: "2",
    totalUsageQuantity: "4",
  }),
  // Um equipamento: leitura simples; a energia derivada vem pronta.
  usoDeRecurso({
    id: "uso-mix",
    resourceCode: "RIN-000010",
    resourceName: "Misturador em V 500 L",
    resourceType: "EQUIPMENT",
    usageQuantity: "3",
    totalUsageQuantity: "3",
    rateValueSnapshot: "35.00",
    derivedEnergyKwh: "22.5",
  }),
  // Energia direta: o kWh já é o total — nunca há quantidade de recursos.
  usoDeRecurso({
    id: "uso-kwh",
    resourceCode: "RIN-000020",
    resourceName: "Energia elétrica — linha de pó",
    resourceType: "ENERGY",
    usageQuantity: "50",
    usageUom: "KWH",
    totalUsageQuantity: "50",
    rateValueSnapshot: "0.92",
    rateUomSnapshot: "KWH",
  }),
];

export function estrutura(extra: Partial<IndustrialCostVersionDTO> = {}): IndustrialCostVersionDTO {
  return {
    id: "ec-12",
    code: "EC-000012",
    versionNumber: 3,
    status: "ACTIVE",
    productId: "prod-45",
    productCode: "PROD-000045",
    productName: "Whey Protein Concentrado 900 g — Baunilha",
    productCodeSnapshot: null,
    productNameSnapshot: null,
    customerName: "NutriViva Suplementos Ltda",
    customerNameSnapshot: null,
    formulationVersionNumber: 4,
    referenceOutputQuantity: "3000",
    referenceOutputUomCode: "un",
    unitsPerShippingBox: 6,
    complete: true,
    createdByName: "Marina Albuquerque",
    activatedAt: "2026-09-10T17:42:00.000Z",
    activatedByName: "Ricardo Menezes",
    notes: null,
    materials: MATERIAIS_BASE,
    lines: [
      {
        id: "linha-overhead",
        category: "OVERHEAD",
        description: "Overhead industrial",
        calculationBasis: "PERCENT_OF_DIRECT_INDUSTRIAL_COST",
        rateValue: "8",
        notes: null,
        sortOrder: 0,
      },
    ],
    resourceUsages: RECURSOS_BASE,
    energyCalculationMode: "DIRECT",
    derivedEnergyKwh: null,
    pendencies: [],
    ...extra,
  } as unknown as IndustrialCostVersionDTO;
}

/** Fórmula longa o bastante para a tabela de materiais atravessar a folha. */
export function estruturaGrande(): IndustrialCostVersionDTO {
  const extras = Array.from({ length: 48 }, (_, i) => {
    const n = String(i + 200).padStart(6, "0");
    return material(`MP-${n}`, `Matéria-prima de teste ${n}`, `${(i % 9) + 1}.5`, "kg", i % 3 === 0 ? "98" : null, i % 4 === 0 ? "1.5" : null);
  });
  return estrutura({ materials: [...MATERIAIS_BASE, ...extras] });
}

export function cmv(extra: Partial<ProductCmvResponse> = {}): ProductCmvResponse {
  return {
    productId: "prod-45",
    productCode: "PROD-000045",
    productName: "Whey Protein Concentrado 900 g — Baunilha",
    customerName: "NutriViva Suplementos Ltda",
    outputUomCode: "un",
    formulationVersionId: "form-4",
    formulationVersionNumber: 4,
    basisFormulationVersionId: "form-4",
    basisFormulationVersionNumber: 4,
    industrialCostVersionId: "ec-12",
    industrialCostVersionLabel: "EC-000012 · V3",
    referenceOutputQuantity: "3000",
    referenceOutputUomCode: "un",
    calculationId: "calc-123",
    calculationCode: "CALC-000123",
    calculationReferenceDate: "2026-09-01T00:00:00.000Z",
    referenceDate: "2026-09-09T00:00:00.000Z",
    live: null,
    simulation: {
      quantity: "3000",
      uomCode: "un",
      batchCount: "1",
      totalCost: "56207.00",
      costPerUnit: "18.735666",
      costPer1000: "18735.67",
      knownSubtotal: "56207.00",
      quality: "COMPLETE_REAL_REFERENCE",
      warnings: [],
      hasCustomerSuppliedMaterials: false,
      components: [
        {
          group: "FORMULA_MATERIAL",
          itemId: "item-MP-000101",
          code: "MP-000101",
          name: "Whey Protein Concentrado 80% (WPC 80)",
          requiredQuantity: "1450",
          unitCode: "kg",
          costSource: "WEIGHTED_AVG_30D",
          customerSupplied: false,
          unitCost: "38.50",
          totalCost: "55825.00",
        },
        {
          group: "INDUSTRIAL_RESOURCE",
          itemId: null,
          code: "LABOR",
          name: "Operador de produção",
          requiredQuantity: "8",
          unitCode: "HOUR",
          costSource: null,
          customerSupplied: false,
          unitCost: "42.00",
          totalCost: "336.00",
          resourceCount: 2,
          quantityPerResource: "4",
        },
        {
          group: "INDUSTRIAL_RESOURCE",
          itemId: null,
          code: "ENERGY",
          name: "Energia elétrica — linha de pó",
          requiredQuantity: "50",
          unitCode: "KWH",
          costSource: null,
          customerSupplied: false,
          unitCost: "0.92",
          totalCost: "46.00",
        },
      ],
    },
    unavailableReason: null,
    pricing: null,
    ...extra,
  } as unknown as ProductCmvResponse;
}

function linhaDeRecurso(extra: Partial<IndustrialResourceCostLineDTO>): IndustrialResourceCostLineDTO {
  return {
    resourceId: "res-1",
    resourceCode: "RIN-000001",
    resourceName: "Operador de produção",
    resourceType: "LABOR",
    quantity: "4",
    quantityUom: "HOUR",
    rateValue: "42.00",
    rateIsDraftReference: false,
    subtotal: "168.00",
    ...extra,
  } as IndustrialResourceCostLineDTO;
}

/** Cálculo congelado com um recurso de 2 equivalentes, um salvo antes do campo e energia. */
export function calculoComRecursos(): IndustrialCostCalculationSnapshotDTO {
  return {
    id: "calc-123",
    code: "CALC-000123",
    calculatedByName: "Marina Albuquerque",
    structureStatusAtCalculation: "ACTIVE",
    notes: null,
    industrialCostVersionId: "ec-12",
    industrialCostVersionLabel: "EC-000012 · V3",
    structureStatus: "ACTIVE",
    draftReference: false,
    productId: "prod-45",
    productCode: "PROD-000045",
    productName: "Whey Protein Concentrado 900 g — Baunilha",
    customerName: "NutriViva Suplementos Ltda",
    formulationVersionNumber: 4,
    referenceOutputQuantity: "3000",
    referenceOutputUomCode: "un",
    unitsPerShippingBox: 6,
    costReferenceDate: "2026-09-01T00:00:00.000Z",
    calculatedAt: "2026-09-10T17:42:10.000Z",
    materials: [],
    resources: [
      linhaDeRecurso({ resourceCount: 2, quantityPerResource: "2", quantity: "4" }),
      // Cálculo salvo antes do campo existir: sem `resourceCount`, lê-se 1.
      linhaDeRecurso({
        resourceId: "res-2",
        resourceCode: "RIN-000010",
        resourceName: "Misturador em V 500 L",
        resourceType: "EQUIPMENT",
        quantity: "3",
        rateValue: "35.00",
        subtotal: "105.00",
      }),
      linhaDeRecurso({
        resourceId: "res-3",
        resourceCode: "RIN-000020",
        resourceName: "Energia elétrica — linha de pó",
        resourceType: "ENERGY",
        quantity: "50",
        quantityUom: "KWH",
        resourceCount: 1,
        quantityPerResource: "50",
        rateValue: "0.92",
        subtotal: "46.00",
      }),
    ],
    manualLines: [],
    customerSuppliedMaterials: [],
    hasCustomerSuppliedMaterials: false,
    energyCalculationMode: "DIRECT",
    derivedEnergyKwh: null,
    energyRate: "0.92",
    materialsSubtotalKnown: "0.00",
    laborSubtotalKnown: "168.00",
    equipmentSubtotalKnown: "105.00",
    energySubtotal: "46.00",
    secondaryPackagingSubtotalKnown: "0.00",
    thirdPartySubtotalKnown: "0.00",
    otherSubtotalKnown: "0.00",
    overheadSubtotalKnown: "0.00",
    directIndustrialCost: "319.00",
    totalIndustrialCost: "319.00",
    knownSubtotal: "319.00",
    costPerUnit: "0.106333333333",
    costPer1000: "106.33",
    quality: "COMPLETE_REAL_REFERENCE",
    warnings: [],
  } as unknown as IndustrialCostCalculationSnapshotDTO;
}
