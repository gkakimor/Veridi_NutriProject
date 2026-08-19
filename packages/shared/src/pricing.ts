/**
 * Precificação industrial (capacidade 46).
 *
 * Transforma um cálculo de custo SALVO (`CALC-…`) mais quantidade, comissão
 * e margem desejada em preço sugerido — e o caminho inverso, do preço
 * informado para a margem resultante.
 *
 * Três limites de vocabulário que o modelo inteiro respeita:
 *
 * 1. **contribuição não é lucro**: impostos, financeiro, inadimplência e
 *    frete comercial não estão modelados. O que existe aqui é margem de
 *    CONTRIBUIÇÃO;
 * 2. **quantidade muda o custo unitário**: custo fixo por lote, caixas
 *    inteiras e recursos por lote não diluem linearmente, então cada faixa
 *    é recalculada — nunca custo unitário × quantidade;
 * 3. **toda a versão compartilha a MESMA base econômica** (a do CALC
 *    escolhido). Uma compra nova no meio da negociação não pode fazer a
 *    faixa de 300 e a de 1000 viverem em realidades diferentes.
 */

import type { IndustrialCostQuality, IndustrialCostWarningDTO } from "./industrial-cost-calculation.js";

export type PricingVersionStatus = "DRAFT" | "ACTIVE" | "INACTIVE";

export const PRICING_VERSION_STATUS_LABELS: Record<PricingVersionStatus, string> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativa",
  INACTIVE: "Inativa",
};

/** Calcular o preço pela margem desejada, ou informar o preço e ver a margem. */
export type PriceMode = "TARGET_MARGIN" | "MANUAL_PRICE";

export const PRICE_MODES: readonly PriceMode[] = ["TARGET_MARGIN", "MANUAL_PRICE"];

export const PRICE_MODE_LABELS: Record<PriceMode, string> = {
  TARGET_MARGIN: "Calcular pela margem",
  MANUAL_PRICE: "Informar preço",
};

/**
 * Comissão incide sobre o PREÇO BRUTO de venda: R$ 100 a 5% são R$ 5. Não
 * existem outras bases de comissão nesta fase.
 */
export const COMMISSION_BASE_DESCRIPTION = "Comissão calculada sobre o preço bruto de venda.";

export const CONTRIBUTION_DEFINITION =
  "Contribuição = preço − comissão − custo industrial. Não é lucro líquido: impostos, despesas financeiras e frete comercial não estão modelados.";

/**
 * O que muda ao refazer uma precificação sobre o custo vigente.
 *
 * A tela dizia "crie uma nova versão a partir do cálculo vigente" e mandava
 * para outras duas telas, sem dizer o que a troca faria com os números. Quem
 * decide precisa ver a diferença ANTES: uma base nova pode mexer só na data
 * ou pode dobrar o custo por unidade.
 *
 * Nada aqui altera a versão atual — preço acordado não se reescreve.
 */
export interface PricingRebaseChangeDTO {
  label: string;
  from: string;
  to: string;
}

export interface PricingRebaseTierDTO {
  quantity: string;
  uomCode: string;
  /** Custo por unidade na base ATUAL da versão; `null` quando desconhecido. */
  costPerUnitFrom: string | null;
  /** Custo por unidade na base NOVA. */
  costPerUnitTo: string | null;
  /** Preço acordado da faixa — carregado como está, para comparar. */
  unitPrice: string | null;
}

export interface PricingRebasePreviewDTO {
  pricingVersionId: string;
  pricingVersionLabel: string;
  /** `null` quando não existe cálculo mais recente que o atual. */
  targetCalculationId: string | null;
  targetCalculationCode: string | null;
  /** Diferenças documento a documento — vazio quando nada mudaria. */
  changes: PricingRebaseChangeDTO[];
  tiers: PricingRebaseTierDTO[];
}

export interface PricingTierDTO {
  id: string;
  quantity: string;
  uomCode: string;
  priceMode: PriceMode;
  targetContributionMarginPercent: string | null;
  commissionPercent: string;
  manualUnitPrice: string | null;
  notes: string | null;
  sortOrder: number;

  /** Custo recalculado para ESTA quantidade, na base econômica do CALC. */
  industrialCostTotal: string | null;
  industrialCostPerUnit: string | null;
  costPer1000: string | null;
  knownSubtotal: string;
  costQuality: IndustrialCostQuality;
  /** Lotes de referência necessários — custo fixo não se dilui abaixo de 1. */
  batchCount: string;

  /** `null` quando o custo está incompleto: margem sobre custo parcial mente. */
  suggestedUnitPrice: string | null;
  selectedUnitPrice: string | null;
  commissionPerUnit: string | null;
  commissionTotal: string | null;
  grossRevenue: string | null;
  contributionPerUnit: string | null;
  contributionTotal: string | null;
  /** Pode ser negativa — preço abaixo do custo é informação, não erro. */
  contributionMarginPercent: string | null;
  /** `null` quando o custo base é zero: markup infinito não existe. */
  markupPercent: string | null;

  warnings: IndustrialCostWarningDTO[];
}

export interface PricingVersionDTO {
  id: string;
  code: string;
  label: string;
  versionNumber: number;
  status: PricingVersionStatus;

  productId: string;
  productCode: string;
  productName: string;
  customerName: string | null;

  /** Base econômica oficial desta precificação. */
  industrialCostCalculationId: string;
  calculationCode: string;
  industrialCostVersionLabel: string;
  formulationVersionNumber: number;
  costReferenceDate: string;
  costQuality: IndustrialCostQuality;
  referenceOutputQuantity: string;
  referenceOutputUomCode: string;
  minimumBatchQuantity: string | null;

  tiers: PricingTierDTO[];
  /** Toda faixa tem preço selecionado. */
  pricingComplete: boolean;
  hasCustomerSuppliedMaterials: boolean;
  warnings: IndustrialCostWarningDTO[];

  notes: string | null;
  createdAt: string;
  createdByName: string | null;
  activatedAt: string | null;
  activatedByName: string | null;
}

export interface PricingVersionSummaryDTO {
  id: string;
  code: string;
  label: string;
  versionNumber: number;
  status: PricingVersionStatus;
  productId: string;
  productCode: string;
  productName: string;
  customerName: string | null;
  calculationCode: string;
  industrialCostVersionLabel: string;
  costReferenceDate: string;
  costQuality: IndustrialCostQuality;
  tierCount: number;
  updatedAt: string;
  activatedAt: string | null;
}

export interface PricingVersionListResponse {
  pricingVersions: PricingVersionSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ProductPricingResponse {
  productId: string;
  productCode: string;
  productName: string;
  draft: PricingVersionDTO | null;
  current: PricingVersionDTO | null;
  versions: PricingVersionSummaryDTO[];
}

export interface CreatePricingVersionInput {
  industrialCostCalculationId: string;
  notes?: string | null;
}

export interface CreatePricingTierInput {
  quantity: string;
  uomCode?: string;
  priceMode: PriceMode;
  targetContributionMarginPercent?: string | null;
  commissionPercent?: string;
  manualUnitPrice?: string | null;
  notes?: string | null;
}

export interface UpdatePricingTierInput {
  quantity?: string;
  priceMode?: PriceMode;
  targetContributionMarginPercent?: string | null;
  commissionPercent?: string;
  manualUnitPrice?: string | null;
  notes?: string | null;
}

export interface ActivatePricingVersionInput {
  /** Custo incompleto só vira preço ativo com confirmação explícita. */
  confirmIncompleteCost?: boolean;
  /** A EC do CALC não é mais a ativa do produto. */
  confirmOutdatedStructure?: boolean;
}
