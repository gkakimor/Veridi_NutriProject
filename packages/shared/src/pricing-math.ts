import { Decimal, type DecimalInstance } from "./decimal-config.js";
import type { IndustrialCostWarningDTO } from "./industrial-cost-calculation.js";
import type { PriceMode } from "./pricing.js";

/**
 * Preço, contribuição e markup de UMA faixa — a conta canônica, pura.
 *
 * Morava só na API (`pricing-math.ts`). A prévia da faixa na tela precisa da
 * mesma conta antes de gravar, e uma cópia em JavaScript de navegador seria o
 * segundo motor que a precificação existe para não ter. Por isso a conta vive
 * aqui, em `Decimal`, com string na entrada e na saída: a API a embrulha em
 * `Prisma.Decimal` e formata; a tela a chama com o custo que o servidor já
 * devolveu para a quantidade. A persistência e a validação final continuam
 * sendo do servidor — a tela só mostra o que a conta diz.
 *
 * Vocabulário é regra: o que se calcula é margem de CONTRIBUIÇÃO
 * (preço − comissão − custo industrial), nunca lucro — impostos, despesas
 * financeiras e frete comercial não estão modelados. A comissão incide sobre
 * o preço BRUTO de venda.
 *
 * Custo incompleto não vira preço pela margem: uma margem calculada sobre
 * subtotal conhecido pareceria segura e não seria.
 */

const HUNDRED = new Decimal(100);

export interface PriceComputationInput {
  priceMode: PriceMode;
  quantity: string;
  /** `null` quando o custo da faixa está incompleto. */
  costPerUnit: string | null;
  targetMarginPercent: string | null;
  commissionPercent: string;
  manualUnitPrice: string | null;
  /**
   * Impostos estimados em % sobre o preço de venda — `PRODUCT_RULES.md` §84.
   * Entram no divisor com margem e comissão. Ausente ou `null` é Modelo que não
   * os considera, e a conta é exatamente a de antes.
   */
  estimatedTaxPercent?: string | null;
}

export interface PriceComputationResult {
  suggestedUnitPrice: string | null;
  selectedUnitPrice: string | null;
  commissionPerUnit: string | null;
  commissionTotal: string | null;
  /** Impostos sobre a venda por unidade (`preço × %`); `null` quando o Modelo não os considera. */
  estimatedTaxPerUnit: string | null;
  estimatedTaxTotal: string | null;
  grossRevenue: string | null;
  contributionPerUnit: string | null;
  contributionTotal: string | null;
  /** Pode ser negativa — preço abaixo do custo é informação, não erro. */
  contributionMarginPercent: string | null;
  /** `null` quando o custo base é zero: markup infinito não existe. */
  markupPercent: string | null;
  warnings: IndustrialCostWarningDTO[];
}

const texto = (value: DecimalInstance | null): string | null => (value === null ? null : value.toString());

export function computePrice(input: PriceComputationInput): PriceComputationResult {
  const warnings: IndustrialCostWarningDTO[] = [];
  const quantity = new Decimal(input.quantity);
  const costPerUnit = input.costPerUnit === null ? null : new Decimal(input.costPerUnit);
  const targetMargin = input.targetMarginPercent === null ? null : new Decimal(input.targetMarginPercent);
  const commissionFraction = new Decimal(input.commissionPercent).dividedBy(HUNDRED);
  const manualUnitPrice = input.manualUnitPrice === null ? null : new Decimal(input.manualUnitPrice);
  const taxFraction =
    input.estimatedTaxPercent == null ? null : new Decimal(input.estimatedTaxPercent).dividedBy(HUNDRED);

  let suggestedUnitPrice: DecimalInstance | null = null;
  if (input.priceMode === "TARGET_MARGIN" && targetMargin) {
    if (!costPerUnit) {
      warnings.push({
        code: "TARGET_PRICE_UNAVAILABLE",
        message:
          "Não é possível calcular preço pela margem porque o custo desta faixa está incompleto.",
      });
    } else {
      // P = C / (1 − m − c − t). A validação de margem + comissão + impostos
      // sobre a venda < 100% garante o denominador positivo; se chegar aqui
      // inválido, é fail-closed.
      const semImposto = new Decimal(1).minus(targetMargin.dividedBy(HUNDRED)).minus(commissionFraction);
      const denominator = taxFraction === null ? semImposto : semImposto.minus(taxFraction);
      if (denominator.lessThanOrEqualTo(0)) {
        warnings.push({
          code: "TARGET_PRICE_IMPOSSIBLE",
          message:
            taxFraction === null
              ? "Margem somada à comissão atinge 100% — não existe preço que satisfaça."
              : "Margem somada à comissão e aos impostos sobre a venda atinge 100% — não existe preço que satisfaça.",
        });
      } else {
        suggestedUnitPrice = costPerUnit.dividedBy(denominator);
      }
    }
  }

  const selectedUnitPrice = input.priceMode === "TARGET_MARGIN" ? suggestedUnitPrice : manualUnitPrice;

  if (!selectedUnitPrice) {
    return {
      suggestedUnitPrice: texto(suggestedUnitPrice),
      selectedUnitPrice: null,
      commissionPerUnit: null,
      commissionTotal: null,
      estimatedTaxPerUnit: null,
      estimatedTaxTotal: null,
      grossRevenue: null,
      contributionPerUnit: null,
      contributionTotal: null,
      contributionMarginPercent: null,
      markupPercent: null,
      warnings,
    };
  }

  const commissionPerUnit = selectedUnitPrice.times(commissionFraction);
  const grossRevenue = selectedUnitPrice.times(quantity);
  const commissionTotal = grossRevenue.times(commissionFraction);
  const estimatedTaxPerUnit = taxFraction === null ? null : selectedUnitPrice.times(taxFraction);
  const estimatedTaxTotal = taxFraction === null ? null : grossRevenue.times(taxFraction);

  // Sem custo total conhecido não existe contribuição: usar o subtotal
  // conhecido daria uma margem otimista e falsa.
  if (!costPerUnit) {
    warnings.push({
      code: "MARGIN_UNAVAILABLE",
      message: "Custo incompleto: margem, markup e contribuição não são calculáveis.",
    });
    return {
      suggestedUnitPrice: texto(suggestedUnitPrice),
      selectedUnitPrice: texto(selectedUnitPrice),
      commissionPerUnit: texto(commissionPerUnit),
      commissionTotal: texto(commissionTotal),
      estimatedTaxPerUnit: texto(estimatedTaxPerUnit),
      estimatedTaxTotal: texto(estimatedTaxTotal),
      grossRevenue: texto(grossRevenue),
      contributionPerUnit: null,
      contributionTotal: null,
      contributionMarginPercent: null,
      markupPercent: null,
      warnings,
    };
  }

  // Imposto sobre a venda sai de dentro do preço, como a comissão.
  const liquido = selectedUnitPrice.minus(commissionPerUnit);
  const contributionPerUnit = (estimatedTaxPerUnit === null ? liquido : liquido.minus(estimatedTaxPerUnit)).minus(
    costPerUnit,
  );
  const contributionTotal = contributionPerUnit.times(quantity);

  // Contribuição negativa é informação comercial legítima — nunca zerada.
  const contributionMarginPercent = selectedUnitPrice.greaterThan(0)
    ? contributionPerUnit.dividedBy(selectedUnitPrice).times(HUNDRED)
    : null;

  let markupPercent: DecimalInstance | null = null;
  if (costPerUnit.greaterThan(0)) {
    markupPercent = selectedUnitPrice.dividedBy(costPerUnit).minus(1).times(HUNDRED);
  } else {
    warnings.push({ code: "MARKUP_UNDEFINED", message: "Markup não definido para custo base zero." });
  }

  if (contributionPerUnit.lessThan(0)) {
    warnings.push({
      code: "NEGATIVE_CONTRIBUTION",
      message: "Preço abaixo do custo industrial mais comissão — contribuição negativa.",
    });
  }

  return {
    suggestedUnitPrice: texto(suggestedUnitPrice),
    selectedUnitPrice: texto(selectedUnitPrice),
    commissionPerUnit: texto(commissionPerUnit),
    commissionTotal: texto(commissionTotal),
    estimatedTaxPerUnit: texto(estimatedTaxPerUnit),
    estimatedTaxTotal: texto(estimatedTaxTotal),
    grossRevenue: texto(grossRevenue),
    contributionPerUnit: texto(contributionPerUnit),
    contributionTotal: texto(contributionTotal),
    contributionMarginPercent: texto(contributionMarginPercent),
    markupPercent: texto(markupPercent),
    warnings,
  };
}
