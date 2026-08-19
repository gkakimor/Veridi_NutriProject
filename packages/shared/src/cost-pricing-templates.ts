/**
 * Bibliotecas técnicas: Estrutura de Custos e Política de Precificação.
 *
 * Mesma promessa dos templates de formulação: a matriz é versionada, aplicá-la
 * cria uma cópia independente e nada se sincroniza depois.
 *
 * Duas exclusões deliberadas, que definem o que cada biblioteca é:
 *
 * - O template de custo guarda CONFIGURAÇÃO, nunca tarifa. Ele diz "usar o
 *   misturador por 4 horas"; quanto vale a hora é resolvido pelo motor na data
 *   de referência.
 * - A política de precificação guarda REGRA, nunca preço. Preço depende do
 *   custo do produto — copiar um valor de outro produto levaria o custo alheio
 *   disfarçado de decisão comercial.
 */

import type { IndustrialCostBasis, IndustrialCostCategory } from "./industrial-costs.js";
import type {
  EnergyCalculationMode,
  IndustrialRateUom,
  IndustrialResourceType,
  IndustrialResourceUsageBasis,
} from "./industrial-resources.js";
import type { PriceMode } from "./pricing.js";

export const INDUSTRIAL_COST_TEMPLATE_CODE_PREFIX = "TEC";
export const PRICING_POLICY_TEMPLATE_CODE_PREFIX = "TPP";

/** Ciclo de vida comum às matrizes de biblioteca. */
export type TemplateVersionStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export const TEMPLATE_VERSION_STATUS_LABELS: Record<TemplateVersionStatus, string> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativa",
  ARCHIVED: "Arquivada",
};

// ─────────────────────────────────────────────── Template de Estrutura (TEC)

export interface CostTemplateResourceUsageDTO {
  id: string;
  industrialResourceId: string;
  resourceCode: string;
  resourceName: string;
  resourceType: IndustrialResourceType;
  usageBasis: IndustrialResourceUsageBasis;
  /** Decimal como string — nunca float. */
  usageQuantity: string;
  usageUom: IndustrialRateUom;
  notes: string | null;
  sortOrder: number;
}

export interface CostTemplateAdditionalCostDTO {
  id: string;
  category: IndustrialCostCategory;
  description: string;
  calculationBasis: IndustrialCostBasis;
  /**
   * Premissa DIGITADA da estrutura ("R$ 180 por 1.000 unidades"), não uma
   * tarifa resolvida de cadastro — por isso viaja com o template.
   */
  rateValue: string | null;
  notes: string | null;
  sortOrder: number;
}

export interface CostTemplateVersionDTO {
  id: string;
  industrialCostTemplateId: string;
  templateCode: string;
  templateName: string;
  versionNumber: number;
  versionLabel: string;
  status: TemplateVersionStatus;
  /** Base de produção SUGERIDA — o produto pode adotar outra. */
  referenceOutputQuantity: string;
  referenceOutputUomCode: string;
  energyCalculationMode: EnergyCalculationMode;
  energyResourceId: string | null;
  energyResourceName: string | null;
  notes: string | null;
  resourceUsages: CostTemplateResourceUsageDTO[];
  additionalCosts: CostTemplateAdditionalCostDTO[];
  createdAt: string;
  createdBy: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  archivedAt: string | null;
  sourceVersionId: string | null;
  sourceVersionNumber: number | null;
  /** Quantas estruturas de custo nasceram desta versão. */
  usageCount: number;
}

export interface CostTemplateDTO {
  id: string;
  code: string;
  name: string;
  description: string | null;
  archived: boolean;
  archivedAt: string | null;
  activeVersion: CostTemplateVersionDTO | null;
  draftVersion: CostTemplateVersionDTO | null;
  versions: CostTemplateVersionDTO[];
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
}

export interface CostTemplateSummaryDTO {
  id: string;
  code: string;
  name: string;
  description: string | null;
  archived: boolean;
  activeVersionId: string | null;
  activeVersionNumber: number | null;
  referenceOutputQuantity: string | null;
  referenceOutputUomCode: string | null;
  resourceCount: number;
  additionalCostCount: number;
  /** Nomes dos recursos da versão ativa — permite buscar por recurso. */
  resourceNames: string[];
  hasDraft: boolean;
  updatedAt: string;
}

export interface CostTemplateListResponse {
  templates: CostTemplateSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateCostTemplateInput {
  name: string;
  description?: string | null;
  referenceOutputQuantity?: string;
  referenceOutputUomCode?: string;
}

export interface CostTemplateResourceUsageInput {
  industrialResourceId: string;
  usageBasis?: IndustrialResourceUsageBasis;
  usageQuantity: string;
  usageUom: IndustrialRateUom;
  notes?: string | null;
}

export interface CostTemplateAdditionalCostInput {
  category: IndustrialCostCategory;
  description: string;
  calculationBasis: IndustrialCostBasis;
  rateValue?: string | null;
  notes?: string | null;
}

export interface UpdateCostTemplateVersionInput {
  referenceOutputQuantity?: string;
  referenceOutputUomCode?: string;
  energyCalculationMode?: EnergyCalculationMode;
  energyResourceId?: string | null;
  notes?: string | null;
  resourceUsages?: CostTemplateResourceUsageInput[];
  additionalCosts?: CostTemplateAdditionalCostInput[];
}

// ─────────────────────────────────────────── Política de Precificação (TPP)

export interface PricingPolicyTierDTO {
  id: string;
  quantity: string;
  uomCode: string;
  priceMode: PriceMode;
  targetContributionMarginPercent: string | null;
  commissionPercent: string;
  notes: string | null;
  sortOrder: number;
}

export interface PricingPolicyVersionDTO {
  id: string;
  pricingPolicyTemplateId: string;
  templateCode: string;
  templateName: string;
  versionNumber: number;
  versionLabel: string;
  status: TemplateVersionStatus;
  notes: string | null;
  tiers: PricingPolicyTierDTO[];
  createdAt: string;
  createdBy: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  archivedAt: string | null;
  sourceVersionId: string | null;
  sourceVersionNumber: number | null;
  /** Quantas precificações nasceram desta versão. */
  usageCount: number;
}

export interface PricingPolicyDTO {
  id: string;
  code: string;
  name: string;
  description: string | null;
  archived: boolean;
  archivedAt: string | null;
  activeVersion: PricingPolicyVersionDTO | null;
  draftVersion: PricingPolicyVersionDTO | null;
  versions: PricingPolicyVersionDTO[];
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
}

export interface PricingPolicySummaryDTO {
  id: string;
  code: string;
  name: string;
  description: string | null;
  archived: boolean;
  activeVersionId: string | null;
  activeVersionNumber: number | null;
  tierCount: number;
  /** Quantidades das faixas, para reconhecer a política na lista. */
  tierQuantities: string[];
  hasDraft: boolean;
  updatedAt: string;
}

export interface PricingPolicyListResponse {
  policies: PricingPolicySummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreatePricingPolicyInput {
  name: string;
  description?: string | null;
}

export interface PricingPolicyTierInput {
  quantity: string;
  uomCode?: string;
  targetContributionMarginPercent: string;
  commissionPercent?: string;
  notes?: string | null;
}

export interface UpdatePricingPolicyVersionInput {
  notes?: string | null;
  tiers?: PricingPolicyTierInput[];
}

export interface UpdateTemplateIdentityInput {
  name?: string;
  description?: string | null;
}

// ─────────────────────────────────────────────────────── aplicação e prévia

export interface ApplyCostTemplateInput {
  costTemplateVersionId: string;
}

export interface ApplyPricingPolicyInput {
  pricingPolicyVersionId: string;
  /** Cálculo de custo que serve de base. Obrigatório: o preço nasce dele. */
  industrialCostCalculationId: string;
}

/**
 * Prévia da aplicação de uma política a um produto.
 *
 * Calculada pelo motor de precificação sobre o CALC escolhido, sem persistir
 * nada. Existe para que ninguém aplique uma política e descubra o preço
 * depois — a mesma política em dois produtos dá preços diferentes, e é
 * exatamente isso que precisa estar visível antes de confirmar.
 */
export interface PricingPolicyPreviewTierDTO {
  quantity: string;
  uomCode: string;
  targetContributionMarginPercent: string | null;
  commissionPercent: string;
  /** `null` quando o custo daquela faixa é incompleto. */
  costPerUnit: string | null;
  suggestedUnitPrice: string | null;
  costQuality: string | null;
  /** Motivo de o preço não sair, quando não sai. */
  warning: string | null;
}

export interface PricingPolicyPreviewDTO {
  policyCode: string;
  policyVersionLabel: string;
  productId: string;
  productCode: string;
  calculationId: string;
  calculationCode: string;
  costReferenceDate: string;
  costQuality: string;
  tiers: PricingPolicyPreviewTierDTO[];
}

// ───────────────────────────────────────────────────── comparação e origem

export type TemplateDiffKind =
  | "BASIS"
  | "ENERGY_MODE"
  | "ENERGY_RESOURCE"
  | "RESOURCE_ADDED"
  | "RESOURCE_REMOVED"
  | "RESOURCE_CHANGED"
  | "COST_ADDED"
  | "COST_REMOVED"
  | "COST_CHANGED"
  | "TIER_ADDED"
  | "TIER_REMOVED"
  | "TIER_CHANGED";

export interface TemplateDiffEntryDTO {
  kind: TemplateDiffKind;
  label: string;
  field: string | null;
  from: string | null;
  to: string | null;
}

export interface TemplateDiffDTO {
  fromLabel: string;
  toLabel: string;
  entries: TemplateDiffEntryDTO[];
}

/** Existe versão de matriz mais recente que a que originou este documento. */
export interface TemplateUpdateAvailableDTO {
  templateId: string;
  templateCode: string;
  templateName: string;
  originVersionId: string;
  originVersionNumber: number;
  latestVersionId: string;
  latestVersionNumber: number;
}
