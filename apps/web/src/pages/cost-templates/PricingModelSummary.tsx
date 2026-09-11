import type { CustomerTaxProfile, PricingModelConfig } from "@veridi/shared";
import {
  CUSTOMER_TAX_PROFILE_LABELS,
  PRICING_ESTIMATED_TAX_MODE_LABELS,
  PRICING_INDUSTRIAL_COST_MODE_LABELS,
} from "@veridi/shared";
import { formatBRL, formatUnitPriceBRL } from "../../lib/currency";
import { formatPercent } from "../../lib/percent";

/**
 * O Modelo de Precificação por extenso — `PRODUCT_RULES.md` §84.
 *
 * Sempre com a base dita: "12% sobre custo de materiais", nunca "12%". E
 * "Não considerar" aparece escrito — ausência de linha não é R$ 0,00.
 */

export function descreverCustoIndustrial(model: PricingModelConfig): string {
  switch (model.industrialCostMode) {
    case "PERCENT_MATERIAL_COST":
      return `${formatPercent(model.industrialCostPercentOfMaterials)} sobre custo de materiais`;
    case "PER_UNIT":
      return `${formatUnitPriceBRL(model.industrialCostAmountPerUnit)} por unidade`;
    case "TOTAL":
      return `${formatBRL(model.industrialCostAmountTotal)} no total do cálculo`;
    default:
      return PRICING_INDUSTRIAL_COST_MODE_LABELS[model.industrialCostMode];
  }
}

export function descreverImpostos(model: PricingModelConfig): string {
  switch (model.estimatedTaxMode) {
    case "PERCENT_SALE_PRICE":
      return `${formatPercent(model.estimatedTaxPercentOfSalePrice)} sobre preço de venda`;
    case "PER_UNIT":
      return `${formatUnitPriceBRL(model.estimatedTaxAmountPerUnit)} por unidade`;
    case "TOTAL":
      return `${formatBRL(model.estimatedTaxAmountTotal)} no total do cálculo`;
    default:
      return PRICING_ESTIMATED_TAX_MODE_LABELS[model.estimatedTaxMode];
  }
}

interface Props {
  model: PricingModelConfig;
  /** Só o Modelo da biblioteca declara perfis; a precificação não. */
  profiles?: CustomerTaxProfile[];
}

export function PricingModelSummary({ model, profiles }: Props) {
  const fora = model.externalAdditionalCosts ? " — fora da conta (gestão externa)" : "";
  return (
    <dl className="definition-list">
      <dt>Custo industrial</dt>
      <dd>
        {descreverCustoIndustrial(model)}
        {fora}
      </dd>
      <dt>Impostos estimados</dt>
      <dd>
        {descreverImpostos(model)}
        {fora}
      </dd>
      <dt>Custos adicionais administrados externamente</dt>
      <dd>
        {model.externalAdditionalCosts
          ? "Sim — custo industrial e impostos fora da conta; o custo de materiais continua calculado"
          : "Não"}
      </dd>
      {profiles && (
        <>
          <dt>Perfis tributários aplicáveis</dt>
          <dd>
            {profiles.length === 0
              ? "Todos"
              : profiles.map((perfil) => CUSTOMER_TAX_PROFILE_LABELS[perfil]).join(", ")}
          </dd>
        </>
      )}
    </dl>
  );
}
