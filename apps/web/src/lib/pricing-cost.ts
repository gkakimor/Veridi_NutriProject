import { isDefaultPricingModel, type PricingTierDTO, type PricingVersionDTO } from "@veridi/shared";

/**
 * O custo que FORMA o preço — `PRODUCT_RULES.md` §84. Ausente em resposta
 * anterior ao Modelo flexível: ali o preço se formou sobre o custo do cálculo.
 * `null` é base incompleta e nunca cai para o custo do cálculo.
 *
 * A tela de Precificação e o PDF leem daqui: os dois contam a mesma história.
 */
export function custoQueFormaPreco(
  tier: Pick<PricingTierDTO, "pricingCostPerUnit" | "industrialCostPerUnit">,
): string | null {
  return tier.pricingCostPerUnit !== undefined ? tier.pricingCostPerUnit : tier.industrialCostPerUnit;
}

/**
 * Modelo que não é o padrão (§84): o custo que forma o preço deixa de ser o do
 * cálculo, e quem lê precisa ver os dois com nome próprio. Resposta sem Modelo
 * é o padrão.
 */
export function usaModeloFlexivel(pricing: Pick<PricingVersionDTO, "pricingModel">): boolean {
  return pricing.pricingModel !== undefined && !isDefaultPricingModel(pricing.pricingModel);
}
