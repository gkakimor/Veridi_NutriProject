import { Prisma } from "@prisma/client";
import { computePrice as computePriceCanonico } from "@veridi/shared";
import type { IndustrialCostWarningDTO, PriceMode } from "@veridi/shared";

/**
 * Preço, contribuição e markup de uma faixa — adaptador sobre a conta
 * canônica de `@veridi/shared` (`computePrice`).
 *
 * A conta morava aqui, em `Prisma.Decimal`. A prévia da faixa na tela precisa
 * dela antes de gravar, e uma cópia no navegador seria um segundo motor; por
 * isso a matemática desceu para o pacote compartilhado, pura, com string na
 * entrada e na saída. Este arquivo só traduz `Prisma.Decimal` de ida e de
 * volta — a API continua sendo quem valida e persiste.
 */
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

const decimal = (value: string | null): Prisma.Decimal | null =>
  value === null ? null : new Prisma.Decimal(value);

export function computePrice(input: PriceComputationInput): PriceComputationResult {
  const resultado = computePriceCanonico({
    priceMode: input.priceMode,
    quantity: input.quantity.toString(),
    costPerUnit: input.costPerUnit ? input.costPerUnit.toString() : null,
    targetMarginPercent: input.targetMarginPercent ? input.targetMarginPercent.toString() : null,
    commissionPercent: input.commissionPercent.toString(),
    manualUnitPrice: input.manualUnitPrice ? input.manualUnitPrice.toString() : null,
  });
  return {
    suggestedUnitPrice: decimal(resultado.suggestedUnitPrice),
    selectedUnitPrice: decimal(resultado.selectedUnitPrice),
    commissionPerUnit: decimal(resultado.commissionPerUnit),
    commissionTotal: decimal(resultado.commissionTotal),
    grossRevenue: decimal(resultado.grossRevenue),
    contributionPerUnit: decimal(resultado.contributionPerUnit),
    contributionTotal: decimal(resultado.contributionTotal),
    contributionMarginPercent: decimal(resultado.contributionMarginPercent),
    markupPercent: decimal(resultado.markupPercent),
    warnings: resultado.warnings,
  };
}
