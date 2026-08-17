import { Prisma } from "@prisma/client";
import type { IndustrialCostWarningDTO, PriceMode } from "@veridi/shared";

const HUNDRED = new Prisma.Decimal(100);

export interface PriceComputationInput {
  priceMode: PriceMode;
  quantity: Prisma.Decimal;
  /** `null` quando o custo da faixa está incompleto. */
  costPerUnit: Prisma.Decimal | null;
  targetMarginPercent: Prisma.Decimal | null;
  commissionPercent: Prisma.Decimal;
  manualUnitPrice: Prisma.Decimal | null;
}

export interface PriceComputationResult {
  suggestedUnitPrice: Prisma.Decimal | null;
  selectedUnitPrice: Prisma.Decimal | null;
  commissionPerUnit: Prisma.Decimal | null;
  commissionTotal: Prisma.Decimal | null;
  grossRevenue: Prisma.Decimal | null;
  contributionPerUnit: Prisma.Decimal | null;
  contributionTotal: Prisma.Decimal | null;
  contributionMarginPercent: Prisma.Decimal | null;
  markupPercent: Prisma.Decimal | null;
  warnings: IndustrialCostWarningDTO[];
}

/**
 * Preço, contribuição e markup de uma faixa.
 *
 * Vocabulário é regra aqui: o que se calcula é margem de CONTRIBUIÇÃO
 * (preço − comissão − custo industrial), nunca lucro — impostos, despesas
 * financeiras e frete comercial não estão modelados. A comissão incide
 * sobre o preço BRUTO de venda.
 *
 * Custo incompleto não vira preço pela margem: uma margem calculada sobre
 * subtotal conhecido pareceria segura e não seria.
 */
export function computePrice(input: PriceComputationInput): PriceComputationResult {
  const warnings: IndustrialCostWarningDTO[] = [];
  const commissionFraction = input.commissionPercent.dividedBy(HUNDRED);

  let suggestedUnitPrice: Prisma.Decimal | null = null;
  if (input.priceMode === "TARGET_MARGIN" && input.targetMarginPercent) {
    if (!input.costPerUnit) {
      warnings.push({
        code: "TARGET_PRICE_UNAVAILABLE",
        message:
          "Não é possível calcular preço pela margem porque o custo desta faixa está incompleto.",
      });
    } else {
      // P = C / (1 − m − c). O denominador é garantido positivo pela
      // validação de margem + comissão < 100%.
      const denominator = new Prisma.Decimal(1)
        .minus(input.targetMarginPercent.dividedBy(HUNDRED))
        .minus(commissionFraction);
      if (denominator.lessThanOrEqualTo(0)) {
        warnings.push({
          code: "TARGET_PRICE_IMPOSSIBLE",
          message: "Margem somada à comissão atinge 100% — não existe preço que satisfaça.",
        });
      } else {
        suggestedUnitPrice = input.costPerUnit.dividedBy(denominator);
      }
    }
  }

  const selectedUnitPrice =
    input.priceMode === "TARGET_MARGIN" ? suggestedUnitPrice : input.manualUnitPrice;

  if (!selectedUnitPrice) {
    return {
      suggestedUnitPrice,
      selectedUnitPrice: null,
      commissionPerUnit: null,
      commissionTotal: null,
      grossRevenue: null,
      contributionPerUnit: null,
      contributionTotal: null,
      contributionMarginPercent: null,
      markupPercent: null,
      warnings,
    };
  }

  const commissionPerUnit = selectedUnitPrice.times(commissionFraction);
  const grossRevenue = selectedUnitPrice.times(input.quantity);
  const commissionTotal = grossRevenue.times(commissionFraction);

  // Sem custo total conhecido não existe contribuição: usar o subtotal
  // conhecido daria uma margem otimista e falsa.
  if (!input.costPerUnit) {
    warnings.push({
      code: "MARGIN_UNAVAILABLE",
      message: "Custo incompleto: margem, markup e contribuição não são calculáveis.",
    });
    return {
      suggestedUnitPrice,
      selectedUnitPrice,
      commissionPerUnit,
      commissionTotal,
      grossRevenue,
      contributionPerUnit: null,
      contributionTotal: null,
      contributionMarginPercent: null,
      markupPercent: null,
      warnings,
    };
  }

  const contributionPerUnit = selectedUnitPrice.minus(commissionPerUnit).minus(input.costPerUnit);
  const contributionTotal = contributionPerUnit.times(input.quantity);

  // Contribuição negativa é informação comercial legítima — nunca zerada.
  const contributionMarginPercent = selectedUnitPrice.greaterThan(0)
    ? contributionPerUnit.dividedBy(selectedUnitPrice).times(HUNDRED)
    : null;

  let markupPercent: Prisma.Decimal | null = null;
  if (input.costPerUnit.greaterThan(0)) {
    markupPercent = selectedUnitPrice.dividedBy(input.costPerUnit).minus(1).times(HUNDRED);
  } else {
    warnings.push({
      code: "MARKUP_UNDEFINED",
      message: "Markup não definido para custo base zero.",
    });
  }

  if (contributionPerUnit.lessThan(0)) {
    warnings.push({
      code: "NEGATIVE_CONTRIBUTION",
      message: "Preço abaixo do custo industrial mais comissão — contribuição negativa.",
    });
  }

  return {
    suggestedUnitPrice,
    selectedUnitPrice,
    commissionPerUnit,
    commissionTotal,
    grossRevenue,
    contributionPerUnit,
    contributionTotal,
    contributionMarginPercent,
    markupPercent,
    warnings,
  };
}
