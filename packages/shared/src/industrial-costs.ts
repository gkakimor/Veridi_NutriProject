/**
 * Estrutura de custos industriais (capacidade 43).
 *
 * ESTRUTURA, não cálculo: aqui ficam as premissas versionadas — qual receita,
 * qual base de produção e quais custos adicionais existem. O custo industrial
 * consolidado (CMV) é calculado em outra capacidade; nada aqui guarda total.
 */

import type {
  EnergyCalculationMode,
  IndustrialCostResourceUsageDTO,
} from "./industrial-resources.js";

export type IndustrialCostVersionStatus = "DRAFT" | "ACTIVE" | "INACTIVE";

export const INDUSTRIAL_COST_VERSION_STATUS_LABELS: Record<
  IndustrialCostVersionStatus,
  string
> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativa",
  INACTIVE: "Inativa",
};

/**
 * Categorias informadas MANUALMENTE nesta fase.
 *
 * Matéria-prima e embalagem vêm da Formulação e nunca são redigitadas aqui.
 * Mão de obra, equipamento e energia ficam de fora de propósito: ganham
 * modelagem própria na capacidade 44.
 */
export type IndustrialCostCategory =
  | "SECONDARY_PACKAGING"
  | "THIRD_PARTY_SERVICE"
  | "OVERHEAD"
  | "OTHER";

export const INDUSTRIAL_COST_CATEGORIES: readonly IndustrialCostCategory[] = [
  "SECONDARY_PACKAGING",
  "THIRD_PARTY_SERVICE",
  "OVERHEAD",
  "OTHER",
];

export const INDUSTRIAL_COST_CATEGORY_LABELS: Record<IndustrialCostCategory, string> = {
  SECONDARY_PACKAGING: "Embalagem secundária / expedição",
  THIRD_PARTY_SERVICE: "Serviço terceirizado",
  OVERHEAD: "Overhead / despesas industriais",
  OTHER: "Outros",
};

export type IndustrialCostBasis =
  | "FIXED_PER_BATCH"
  | "PER_OUTPUT_UNIT"
  | "PER_1000_OUTPUT_UNITS"
  | "PER_SHIPPING_BOX"
  | "PERCENT_OF_DIRECT_INDUSTRIAL_COST";

export const INDUSTRIAL_COST_BASES: readonly IndustrialCostBasis[] = [
  "FIXED_PER_BATCH",
  "PER_OUTPUT_UNIT",
  "PER_1000_OUTPUT_UNITS",
  "PER_SHIPPING_BOX",
  "PERCENT_OF_DIRECT_INDUSTRIAL_COST",
];

export const INDUSTRIAL_COST_BASIS_LABELS: Record<IndustrialCostBasis, string> = {
  FIXED_PER_BATCH: "Valor fixo por lote de referência",
  PER_OUTPUT_UNIT: "Por unidade acabada",
  PER_1000_OUTPUT_UNITS: "Por 1.000 unidades acabadas",
  PER_SHIPPING_BOX: "Por caixa de expedição",
  PERCENT_OF_DIRECT_INDUSTRIAL_COST: "% do custo industrial direto",
};

/**
 * Percentual é lido como número inteiro de porcento (10 = 10%), não fração.
 * O teto é técnico: overhead pode passar de 100%, mas 1000% denuncia erro
 * de digitação.
 */
export const MAX_INDUSTRIAL_COST_PERCENT = 1000;

/**
 * Composição do CUSTO INDUSTRIAL DIRETO — base do percentual quando a
 * capacidade 45 calcular: materiais Veridi + embalagens Veridi + mão de obra
 * direta + equipamentos + energia, ANTES do overhead. Material fornecido
 * pelo cliente nunca entra: ele não é custo de aquisição da Veridi.
 */
export const DIRECT_INDUSTRIAL_COST_DEFINITION =
  "Materiais e embalagens Veridi + mão de obra direta + equipamentos + energia, antes do overhead. Material do cliente não entra.";

export interface IndustrialCostLineDTO {
  id: string;
  category: IndustrialCostCategory;
  description: string;
  calculationBasis: IndustrialCostBasis;
  /** `null` = valor NÃO informado. Nunca zero por omissão. */
  rateValue: string | null;
  notes: string | null;
  sortOrder: number;
}

/** Componente vindo da Formulação — read-only na estrutura de custos. */
export interface IndustrialCostMaterialDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: string;
  quantity: string;
  unitCode: string;
  basis: string;
  purityPercentApplied: string | null;
  overagePercent: string | null;
  /** `true` quando o material é fornecido pelo cliente. */
  customerSupplied: boolean;
}

/** Motivo pelo qual a estrutura ainda não está completa. */
export interface IndustrialCostPendencyDTO {
  code:
    | "RATE_NOT_INFORMED"
    | "SHIPPING_BOX_NOT_CONFIGURED"
    | "FORMULATION_NOT_STABLE"
    | "FORMULATION_OUTDATED"
    | "RESOURCE_RATE_NOT_INFORMED"
    | "ENERGY_NOT_CONFIGURED"
    | "EQUIPMENT_POWER_NOT_INFORMED"
    | "ENERGY_RESOURCE_MISSING"
    | "ENERGY_RATE_NOT_INFORMED"
    | "RESOURCE_INACTIVE";
  description: string;
}

export interface IndustrialCostVersionDTO {
  id: string;
  code: string;
  productId: string;
  productCode: string;
  productName: string;
  customerName: string | null;
  versionNumber: number;
  /** Rótulo de apresentação: "EC-000012 · V2". */
  label: string;
  status: IndustrialCostVersionStatus;

  formulationVersionId: string;
  formulationVersionNumber: number;
  formulationStatus: string;
  /** Versão ACTIVE do produto agora — pode ser diferente da usada aqui. */
  activeFormulationVersionNumber: number | null;

  referenceOutputQuantity: string;
  referenceOutputUomCode: string;
  unitsPerShippingBox: number | null;

  notes: string | null;

  materials: IndustrialCostMaterialDTO[];
  lines: IndustrialCostLineDTO[];
  /** Recursos industriais planejados nesta versão. */
  resourceUsages: IndustrialCostResourceUsageDTO[];

  energyCalculationMode: EnergyCalculationMode;
  /**
   * Consumo energético derivado dos equipamentos (Σ horas × kW). É
   * QUANTIDADE, não custo: nenhum total em dinheiro é calculado nesta fase.
   */
  derivedEnergyKwh: string | null;

  /** `true` quando toda premissa necessária tem valor e base configurada. */
  complete: boolean;
  pendencies: IndustrialCostPendencyDTO[];

  createdAt: string;
  createdByName: string | null;
  activatedAt: string | null;
  activatedByName: string | null;

  customerCodeSnapshot: string | null;
  customerNameSnapshot: string | null;
  productCodeSnapshot: string | null;
  productNameSnapshot: string | null;
}

export interface IndustrialCostVersionSummaryDTO {
  id: string;
  code: string;
  versionNumber: number;
  label: string;
  status: IndustrialCostVersionStatus;
  formulationVersionNumber: number;
  referenceOutputQuantity: string;
  referenceOutputUomCode: string;
  complete: boolean;
  activatedAt: string | null;
}

export interface ProductIndustrialCostResponse {
  productId: string;
  productCode: string;
  productName: string;
  /** Sugestão vinda do lote mínimo — o usuário confirma, nada é assumido. */
  suggestedReferenceOutputQuantity: string | null;
  referenceOutputUomCode: string | null;
  activeFormulationVersionId: string | null;
  activeFormulationVersionNumber: number | null;
  versions: IndustrialCostVersionSummaryDTO[];
  current: IndustrialCostVersionDTO | null;
  draft: IndustrialCostVersionDTO | null;
}

export interface CreateIndustrialCostVersionInput {
  /** Ausente = usa a formulação ACTIVE do produto. */
  formulationVersionId?: string;
  referenceOutputQuantity?: string;
  referenceOutputUomCode?: string;
  notes?: string | null;
}

export interface UpdateIndustrialCostVersionInput {
  formulationVersionId?: string;
  referenceOutputQuantity?: string;
  referenceOutputUomCode?: string;
  notes?: string | null;
}

export interface CreateIndustrialCostLineInput {
  category: IndustrialCostCategory;
  description: string;
  calculationBasis: IndustrialCostBasis;
  /** Omitir (ou `null`) mantém a premissa como "não informada". */
  rateValue?: string | null;
  notes?: string | null;
}

export interface ActivateIndustrialCostVersionInput {
  /** Confirmação explícita para ativar com premissas ainda não informadas. */
  confirmIncomplete?: boolean;
}
