/**
 * Recursos industriais (capacidade 44).
 *
 * Separa RECURSO — o que a fábrica consome e quanto ele custa por hora/kWh —
 * de USO DO RECURSO, que pertence à estrutura de custo de um produto. A
 * capacidade seguinte multiplica um pelo outro; aqui nada é calculado.
 */

export type IndustrialResourceType = "LABOR" | "EQUIPMENT" | "ENERGY";

export const INDUSTRIAL_RESOURCE_TYPES: readonly IndustrialResourceType[] = [
  "LABOR",
  "EQUIPMENT",
  "ENERGY",
];

export const INDUSTRIAL_RESOURCE_TYPE_LABELS: Record<IndustrialResourceType, string> = {
  LABOR: "Mão de obra",
  EQUIPMENT: "Equipamento",
  ENERGY: "Energia",
};

/**
 * Unidades das tarifas e usos industriais.
 *
 * Lista fechada e própria: hora e kWh não são unidades de ITEM, e colocá-las
 * no registro geral de UOM permitiria cadastrar matéria-prima medida em kWh.
 */
export type IndustrialRateUom = "HOUR" | "KWH";

export const INDUSTRIAL_RATE_UOM_LABELS: Record<IndustrialRateUom, string> = {
  HOUR: "hora",
  KWH: "kWh",
};

/** Mão de obra e equipamento se medem em tempo; energia, em kWh. */
export function usageUomForResourceType(type: IndustrialResourceType): IndustrialRateUom {
  return type === "ENERGY" ? "KWH" : "HOUR";
}

export type IndustrialResourceRateSource = "MANUAL" | "LEGACY_IMPORT";

export const INDUSTRIAL_RATE_SOURCE_LABELS: Record<IndustrialResourceRateSource, string> = {
  MANUAL: "Cadastrada no sistema",
  LEGACY_IMPORT: "Planilha (histórico)",
};

export type IndustrialResourceUsageBasis =
  | "FIXED_PER_REFERENCE_BATCH"
  | "PER_OUTPUT_UNIT"
  | "PER_1000_OUTPUT_UNITS";

export const INDUSTRIAL_USAGE_BASES: readonly IndustrialResourceUsageBasis[] = [
  "FIXED_PER_REFERENCE_BATCH",
  "PER_OUTPUT_UNIT",
  "PER_1000_OUTPUT_UNITS",
];

export const INDUSTRIAL_USAGE_BASIS_LABELS: Record<IndustrialResourceUsageBasis, string> = {
  FIXED_PER_REFERENCE_BATCH: "Por lote de referência",
  PER_OUTPUT_UNIT: "Por unidade acabada",
  PER_1000_OUTPUT_UNITS: "Por 1.000 unidades acabadas",
};

/**
 * `DIRECT` e `FROM_EQUIPMENT` são exclusivos: somar consumo direto com o
 * derivado dos equipamentos contaria a mesma energia duas vezes. `NONE` é
 * "ainda não estruturada" — nunca energia zero.
 */
export type EnergyCalculationMode = "NONE" | "DIRECT" | "FROM_EQUIPMENT";

export const ENERGY_CALCULATION_MODES: readonly EnergyCalculationMode[] = [
  "NONE",
  "DIRECT",
  "FROM_EQUIPMENT",
];

export const ENERGY_CALCULATION_MODE_LABELS: Record<EnergyCalculationMode, string> = {
  NONE: "Não configurada",
  DIRECT: "Consumo informado diretamente",
  FROM_EQUIPMENT: "Derivada dos equipamentos",
};

export const DEFAULT_RESOURCE_RATE_CURRENCY = "BRL";

export interface IndustrialResourceRateDTO {
  id: string;
  rateValue: string;
  currencyCode: string;
  rateUom: IndustrialRateUom;
  /** `null` = referência histórica sem vigência; nunca tarifa vigente. */
  effectiveAt: string | null;
  validUntil: string | null;
  source: IndustrialResourceRateSource;
  notes: string | null;
  createdAt: string;
  createdByName: string | null;
  isCurrent: boolean;
}

export interface IndustrialResourceDTO {
  id: string;
  code: string;
  name: string;
  type: IndustrialResourceType;
  description: string | null;
  defaultUsageUom: IndustrialRateUom;
  /** Só equipamento; `null` = potência desconhecida, nunca zero. */
  powerKw: string | null;
  notes: string | null;
  active: boolean;
  /** Tarifa vigente na data de referência; `null` quando não há. */
  currentRate: IndustrialResourceRateDTO | null;
  rateCount: number;
  createdAt: string;
  createdByName: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

export interface IndustrialResourceDetailDTO extends IndustrialResourceDTO {
  rates: IndustrialResourceRateDTO[];
}

export interface IndustrialResourceListResponse {
  resources: IndustrialResourceDTO[];
  page: number;
  pageSize: number;
  total: number;
}

/** Uso planejado do recurso na base de referência da estrutura de custo. */
export interface IndustrialCostResourceUsageDTO {
  id: string;
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  resourceType: IndustrialResourceType;
  resourceActive: boolean;
  usageBasis: IndustrialResourceUsageBasis;
  usageQuantity: string;
  usageUom: IndustrialRateUom;
  notes: string | null;

  /** Tarifa vigente hoje — referência enquanto a versão é rascunho. */
  currentRate: IndustrialResourceRateDTO | null;
  /** Potência atual do cadastro (equipamento). */
  powerKw: string | null;

  /** Congelados na ativação; `null` enquanto rascunho. */
  rateValueSnapshot: string | null;
  rateCurrencySnapshot: string | null;
  rateUomSnapshot: IndustrialRateUom | null;
  rateEffectiveAtSnapshot: string | null;
  powerKwSnapshot: string | null;
  resourceNameSnapshot: string | null;

  /** Consumo derivado (horas × kW) quando a energia vem dos equipamentos. */
  derivedEnergyKwh: string | null;
}

export interface CreateIndustrialResourceInput {
  name: string;
  type: IndustrialResourceType;
  description?: string | null;
  powerKw?: string | null;
  notes?: string | null;
}

export interface UpdateIndustrialResourceInput {
  name?: string;
  description?: string | null;
  powerKw?: string | null;
  notes?: string | null;
  active?: boolean;
}

export interface CreateIndustrialResourceRateInput {
  rateValue: string;
  currencyCode?: string;
  rateUom?: IndustrialRateUom;
  effectiveAt?: string | null;
  validUntil?: string | null;
  notes?: string | null;
}

export interface CreateIndustrialCostResourceUsageInput {
  resourceId: string;
  usageQuantity: string;
  usageBasis?: IndustrialResourceUsageBasis;
  notes?: string | null;
}

export interface UpdateEnergyModeInput {
  energyCalculationMode: EnergyCalculationMode;
}
