import {
  isDefaultPricingModel,
  resumoDoModeloDePrecificacao,
  type FormatosDoModelo,
  type PricingModelConfig,
  type PricingTierDTO,
  type PricingVersionDTO,
} from "@veridi/shared";
import { formatBRL, formatUnitPriceBRL } from "./currency";
import { formatPercent } from "./percent";

/**
 * Os valores do Modelo como a tela e o PDF os escrevem. As palavras vêm do
 * shared — as mesmas do CSV (PRICING-MODEL-VIEW-REPORTS-01).
 */
export const FORMATOS_DO_MODELO: FormatosDoModelo = {
  percentual: formatPercent,
  porUnidade: formatUnitPriceBRL,
  total: formatBRL,
};

/** O Modelo numa linha — "Padrão", ou o que entrou no custo p/ preço. */
export function resumoDoModelo(modelo: PricingModelConfig): string {
  return resumoDoModeloDePrecificacao(modelo, FORMATOS_DO_MODELO);
}

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
