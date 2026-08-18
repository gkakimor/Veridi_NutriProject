/**
 * CMV do produto — visão de negócio do custo industrial para UMA quantidade.
 *
 * Não existe entidade `Cmv` no domínio, e não deve existir. CMV é a leitura
 * composta de documentos que já são a fonte da verdade:
 *
 *   FormulationVersion → IndustrialCostVersion → IndustrialCostCalculation
 *   → PricingVersion/PricingTier
 *
 * A tela existe porque a pergunta do negócio — "quanto custa produzir 1.000
 * potes deste produto?" — não deveria exigir entender EC, CALC e PREC.
 * Nenhum número aqui é calculado por um motor próprio: tudo vem do mesmo
 * `costForOutputQuantity` que a precificação usa para as faixas.
 */

import type { IndustrialCostQuality, IndustrialCostWarningDTO } from "./industrial-costs.js";

/** Categoria de apresentação — agrupa a composição do jeito que o negócio lê. */
export type CmvGroup =
  | "FORMULA_MATERIAL"
  | "PACKAGING"
  | "CUSTOMER_SUPPLIED"
  | "INDUSTRIAL_RESOURCE"
  | "OVERHEAD";

export const CMV_GROUP_LABELS: Record<CmvGroup, string> = {
  FORMULA_MATERIAL: "Materiais da formulação",
  PACKAGING: "Embalagens",
  CUSTOMER_SUPPLIED: "Materiais fornecidos pelo cliente",
  INDUSTRIAL_RESOURCE: "Recursos industriais",
  OVERHEAD: "Outros custos e overhead",
};

export interface CmvComponentDTO {
  group: CmvGroup;
  /** `null` para linhas que não são item de estoque (recurso, overhead). */
  itemId: string | null;
  code: string;
  name: string;
  /** Decimal como string — quantidade necessária para a quantidade simulada. */
  requiredQuantity: string | null;
  unitCode: string | null;
  /** Origem do custo, na mesma taxonomia do motor. `null` quando desconhecida. */
  costSource: string | null;
  unitCost: string | null;
  totalCost: string | null;
  /**
   * Material do cliente entra na estrutura física e NUNCA no custo de
   * aquisição Veridi. Não é custo zero nem custo desconhecido.
   */
  customerSupplied: boolean;
}

export interface CmvPricingMatchDTO {
  pricingVersionId: string;
  pricingVersionLabel: string;
  /** `null` quando não existe faixa para EXATAMENTE esta quantidade. */
  tierId: string | null;
  tierQuantity: string | null;
  unitPrice: string | null;
  /**
   * Quantidades das faixas vigentes — para dizer o que existe sem sugerir
   * que uma delas serve. Faixa não se interpola: 750 entre 500 e 1000 não
   * tem preço vigente, e inventar um seria inventar negociação.
   */
  availableQuantities: string[];
}

export interface ProductCmvResponse {
  productId: string;
  productCode: string;
  productName: string;
  customerName: string | null;

  /** Unidade do item de produto acabado — a unidade em que se simula. */
  outputUomCode: string;

  formulationVersionId: string | null;
  formulationVersionNumber: number | null;

  industrialCostVersionId: string | null;
  industrialCostVersionLabel: string | null;
  /** Base de produção da estrutura — a quantidade de referência da EC. */
  referenceOutputQuantity: string | null;
  referenceOutputUomCode: string | null;

  calculationId: string | null;
  calculationCode: string | null;
  /** Data de referência do cálculo usado como base econômica. */
  calculationReferenceDate: string | null;

  /** Data explícita pedida por quem chamou — nunca `Date.now()` no domínio. */
  referenceDate: string;

  /** `null` quando o produto ainda não tem cadeia de custo utilizável. */
  simulation: {
    quantity: string;
    uomCode: string;
    batchCount: string;
    /** `null` quando algum custo necessário é desconhecido. */
    totalCost: string | null;
    costPerUnit: string | null;
    /** Referência comercial derivada da simulação — nunca base persistida. */
    costPer1000: string | null;
    /** O que se sabe hoje. Existe mesmo quando o total não existe. */
    knownSubtotal: string;
    quality: IndustrialCostQuality;
    warnings: IndustrialCostWarningDTO[];
    hasCustomerSuppliedMaterials: boolean;
    components: CmvComponentDTO[];
  } | null;

  /** Por que a simulação não pôde ser feita, quando for o caso. */
  unavailableReason: string | null;

  /** Só para quem pode ver economia interna. `null` para os demais papéis. */
  pricing: CmvPricingMatchDTO | null;
}
