import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, User } from "@prisma/client";
import type {
  IndustrialCostWarningDTO,
  PricingVersionDTO,
  QuotePricingProvenanceDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { convertUomDecimal, isUomCompatible } from "../items/uom.js";
import { getActivePricingForProduct } from "../pricing/pricing.service.js";
import { QuoteNotDraftError, QuoteNotFoundError } from "./projects.errors.js";

/**
 * Ligação entre orçamento e precificação.
 *
 * O preço de uma proposta pode ser digitado (exceção comercial continua
 * legítima) ou vir de uma FAIXA de precificação ativa. No segundo caso o
 * orçamento carrega a cadeia inteira — PREC → CALC → EC → Formulação — e é
 * isso que torna a proposta auditável meses depois.
 *
 * A faixa é um cenário econômico fechado, não um intervalo contratual: usar
 * a faixa de 1000 para cotar 700 mudaria contagem de lotes, custos fixos,
 * caixas e recursos. Por isso a quantidade tem que bater exatamente.
 */

export class PricingTierNotFoundForQuoteError extends Error {
  constructor(id: string) {
    super(`Faixa de precificação não encontrada: ${id}`);
    this.name = "PricingTierNotFoundForQuoteError";
  }
}

export class QuoteWithoutProductError extends Error {
  constructor() {
    super(
      "Este projeto ainda não tem produto técnico preparado — sem produto não existe precificação para vincular.",
    );
    this.name = "QuoteWithoutProductError";
  }
}

export class PricingProductMismatchError extends Error {
  constructor() {
    super("A precificação selecionada pertence a outro produto.");
    this.name = "PricingProductMismatchError";
  }
}

export class PricingNotActiveError extends Error {
  constructor() {
    super("Somente uma precificação ATIVA pode embasar uma proposta ao cliente.");
    this.name = "PricingNotActiveError";
  }
}

export class QuoteQuantityMismatchError extends Error {
  constructor(quoted: string, tier: string) {
    super(
      `A quantidade do orçamento (${quoted}) não corresponde à faixa de precificação (${tier}). Faixa é cenário econômico fechado: crie a faixa correspondente ou use preço manual.`,
    );
    this.name = "QuoteQuantityMismatchError";
  }
}

export class QuoteUomIncompatibleError extends Error {
  constructor(quoteUom: string, tierUom: string) {
    super(`A unidade do orçamento (${quoteUom}) não converte para a da faixa (${tierUom}).`);
    this.name = "QuoteUomIncompatibleError";
  }
}

export class TierWithoutPriceError extends Error {
  constructor() {
    super("Esta faixa não tem preço definido — nada para trazer para o orçamento.");
    this.name = "TierWithoutPriceError";
  }
}

/** Preço travado enquanto a proposta é sustentada por uma faixa. */
export class PriceLockedByPricingError extends Error {
  constructor() {
    super(
      'Quantidade, unidade e preço vêm da faixa de precificação. Use "preço manual" para editá-los à mão.',
    );
    this.name = "PriceLockedByPricingError";
  }
}

/** Custo industrial incompleto pode virar proposta — mas nunca por acidente. */
export class IncompleteCostQuoteError extends Error {
  constructor() {
    super(
      "Esta proposta utiliza preço com custo industrial incompleto. Confirme explicitamente para enviar.",
    );
    this.name = "IncompleteCostQuoteError";
  }
}

/**
 * A proveniência de preço vive na LINHA, não no cabeçalho: numa proposta com
 * três produtos, cada um tem a própria faixa, o próprio cálculo e a própria
 * qualidade de custo.
 */
type QuoteRow = PrismaTypes.QuoteLineGetPayload<{
  include: { pricingVersion: true; pricingTier: true; quoteVersion: true };
}>;

/**
 * A linha basta para montar a proveniência: o status da versão entra por
 * fora, para que o DTO da versão (que já carregou as linhas junto) não
 * precise reconsultar `quoteVersion` uma vez por linha.
 */
export type QuoteLinePricingRow = PrismaTypes.QuoteLineGetPayload<{
  include: { pricingVersion: true; pricingTier: true };
}>;

const lineInclude = {
  pricingVersion: true,
  pricingTier: true,
  quoteVersion: true,
} satisfies PrismaTypes.QuoteLineInclude;

/** Include mínimo para que uma linha carregue a própria proveniência. */
export const linePricingInclude = {
  pricingVersion: true,
  pricingTier: true,
} satisfies PrismaTypes.QuoteLineInclude;

/**
 * Proveniência do preço.
 *
 * Enquanto o orçamento é rascunho, lê a faixa vinculada (que já é imutável,
 * porque só precificação ATIVA pode ser usada). Depois do envio, lê o
 * snapshot congelado — precificação nova, cálculo novo ou compra nova não
 * podem reescrever o que foi apresentado ao cliente.
 */
export function pricingProvenanceForLine(
  quote: QuoteLinePricingRow,
  quoteVersionStatus: string,
): QuotePricingProvenanceDTO | null {
  if (quote.priceSource !== "PRICING_TIER") return null;

  if (quoteVersionStatus !== "DRAFT" && quote.pricingCodeSnapshot) {
    return {
      pricingVersionId: quote.pricingVersionId,
      pricingCode: quote.pricingCodeSnapshot,
      pricingVersionNumber: quote.pricingVersionNumberSnapshot,
      pricingTierId: quote.pricingTierId,
      tierQuantity: quote.pricingTierQuantitySnapshot
        ? quote.pricingTierQuantitySnapshot.toString()
        : null,
      tierUomCode: quote.pricingTierUomSnapshot,
      selectedUnitPrice: quote.pricingSelectedUnitPriceSnapshot
        ? quote.pricingSelectedUnitPriceSnapshot.toFixed(6)
        : null,
      calculationCode: quote.costCalculationCodeSnapshot,
      costReferenceDate: quote.costReferenceDateSnapshot
        ? quote.costReferenceDateSnapshot.toISOString()
        : null,
      costStructureLabel: quote.costStructureLabelSnapshot,
      formulationVersionNumber: quote.formulationVersionNumberSnapshot,
      industrialCostPerUnit: quote.industrialCostPerUnitSnapshot
        ? quote.industrialCostPerUnitSnapshot.toFixed(6)
        : null,
      costQuality: quote.costQualitySnapshot,
      commissionPercent: quote.commissionPercentSnapshot
        ? quote.commissionPercentSnapshot.toFixed(4)
        : null,
      contributionPerUnit: quote.contributionPerUnitSnapshot
        ? quote.contributionPerUnitSnapshot.toFixed(6)
        : null,
      contributionMarginPercent: quote.contributionMarginSnapshot
        ? quote.contributionMarginSnapshot.toFixed(4)
        : null,
      markupPercent: quote.markupSnapshot ? quote.markupSnapshot.toFixed(4) : null,
      warnings: (quote.pricingWarningsSnapshot as unknown as IndustrialCostWarningDTO[]) ?? [],
      frozen: true,
    };
  }

  const tier = quote.pricingTier;
  const version = quote.pricingVersion;
  if (!tier || !version) return null;

  return {
    pricingVersionId: version.id,
    pricingCode: version.code,
    pricingVersionNumber: version.versionNumber,
    pricingTierId: tier.id,
    tierQuantity: tier.quantity.toString(),
    tierUomCode: tier.uomCode,
    selectedUnitPrice: tier.selectedPriceSnapshot ? tier.selectedPriceSnapshot.toFixed(6) : null,
    calculationCode: version.calculationCodeSnapshot,
    costReferenceDate: version.costReferenceDateSnapshot.toISOString(),
    costStructureLabel: version.industrialCostVersionLabelSnapshot,
    formulationVersionNumber: version.formulationVersionNumberSnapshot,
    industrialCostPerUnit: tier.costPerUnitSnapshot ? tier.costPerUnitSnapshot.toFixed(6) : null,
    costQuality: tier.costQualitySnapshot,
    commissionPercent: (tier.commissionPercentSnapshot ?? tier.commissionPercent).toFixed(4),
    contributionPerUnit: tier.contributionPerUnitSnapshot
      ? tier.contributionPerUnitSnapshot.toFixed(6)
      : null,
    contributionMarginPercent: tier.contributionMarginSnapshot
      ? tier.contributionMarginSnapshot.toFixed(4)
      : null,
    markupPercent: tier.markupSnapshot ? tier.markupSnapshot.toFixed(4) : null,
    warnings: (tier.warningsSnapshot as unknown as IndustrialCostWarningDTO[]) ?? [],
    frozen: false,
  };
}

/** Mesma proveniência, para quem já carregou a linha com `quoteVersion`. */
export function toPricingProvenance(quote: QuoteRow): QuotePricingProvenanceDTO | null {
  return pricingProvenanceForLine(quote, quote.quoteVersion.status);
}

export async function getQuoteLineWithPricing(id: string): Promise<QuoteRow> {
  const line = await getPrisma().quoteLine.findUnique({ where: { id }, include: lineInclude });
  if (!line) throw new QuoteNotFoundError(id);
  return line;
}

/** Precificação ativa disponível para o PRODUTO desta linha. */
export async function getQuoteLinePricingOptions(lineId: string): Promise<PricingVersionDTO | null> {
  const line = await getPrisma().quoteLine.findUnique({ where: { id: lineId } });
  if (!line) throw new QuoteNotFoundError(lineId);
  return getActivePricingForProduct(line.productId);
}

/**
 * Vincula o orçamento a uma faixa de precificação ativa.
 *
 * Quantidade, unidade e preço passam a vir da faixa — o preço usado é o
 * SELECIONADO na precificação, não o sugerido, porque a faixa pode ter sido
 * fechada com preço manual.
 */
export async function applyQuoteLinePricing(
  lineId: string,
  tierId: string,
  _actor: User,
): Promise<string> {
  const prisma = getPrisma();
  const line = await prisma.quoteLine.findUnique({
    where: { id: lineId },
    include: { quoteVersion: true },
  });
  if (!line) throw new QuoteNotFoundError(lineId);
  if (line.quoteVersion.status !== "DRAFT") throw new QuoteNotDraftError(line.quoteVersion.status);

  const tier = await prisma.pricingTier.findUnique({
    where: { id: tierId },
    include: { pricingVersion: true },
  });
  if (!tier) throw new PricingTierNotFoundForQuoteError(tierId);
  // A faixa tem que ser do produto DESTA linha: preço de outro produto na
  // linha seria proveniência falsa, não atalho.
  if (tier.pricingVersion.productId !== line.productId) {
    throw new PricingProductMismatchError();
  }
  // Rascunho de precificação é negociação interna, não base de proposta.
  if (tier.pricingVersion.status !== "ACTIVE") throw new PricingNotActiveError();
  if (!tier.selectedPriceSnapshot) throw new TierWithoutPriceError();

  // Quantidade já informada precisa bater com a faixa — nada de escolher a
  // "faixa mais próxima" nem interpolar preço.
  if (line.quotedQuantity && line.uomCode) {
    const units = await prisma.unitOfMeasure.findMany();
    if (!isUomCompatible(line.uomCode, tier.uomCode, units)) {
      throw new QuoteUomIncompatibleError(line.uomCode, tier.uomCode);
    }
    const converted = convertUomDecimal(line.quotedQuantity, line.uomCode, tier.uomCode, units);
    if (!converted.equals(tier.quantity)) {
      throw new QuoteQuantityMismatchError(
        `${line.quotedQuantity.toString()} ${line.uomCode}`,
        `${tier.quantity.toString()} ${tier.uomCode}`,
      );
    }
  }

  await prisma.quoteLine.update({
    where: { id: lineId },
    data: {
      priceSource: "PRICING_TIER",
      pricingVersionId: tier.pricingVersionId,
      pricingTierId: tier.id,
      quotedQuantity: tier.quantity,
      uomCode: tier.uomCode,
      unitPrice: new Prisma.Decimal(tier.selectedPriceSnapshot.toFixed(4)),
    },
  });

  return line.quoteVersionId;
}

/**
 * Desvincula: o preço da linha vira manual e perde a proveniência.
 *
 * O valor atual permanece como ponto de partida, mas a linha deixa de
 * apontar PREC/CALC — manter o vínculo depois de editar à mão seria
 * proveniência falsa.
 */
export async function useManualQuoteLinePrice(lineId: string, _actor: User): Promise<string> {
  const prisma = getPrisma();
  const line = await prisma.quoteLine.findUnique({
    where: { id: lineId },
    include: { quoteVersion: true },
  });
  if (!line) throw new QuoteNotFoundError(lineId);
  if (line.quoteVersion.status !== "DRAFT") throw new QuoteNotDraftError(line.quoteVersion.status);

  await prisma.quoteLine.update({
    where: { id: lineId },
    data: { priceSource: "MANUAL", pricingVersionId: null, pricingTierId: null },
  });
  return line.quoteVersionId;
}

/** Campos econômicos travados enquanto a proposta vem de uma faixa. */
export function assertPriceEditable(
  quote: { priceSource: string },
  input: { quotedQuantity?: unknown; uomCode?: unknown; unitPrice?: unknown },
): void {
  if (quote.priceSource !== "PRICING_TIER") return;
  if (
    input.quotedQuantity !== undefined ||
    input.uomCode !== undefined ||
    input.unitPrice !== undefined
  ) {
    throw new PriceLockedByPricingError();
  }
}

/** Snapshot econômico congelado no envio da proposta. */
/**
 * Congela a economia de cada linha no envio.
 *
 * Uma proposta com três produtos tem três cadeias PREC → CALC → EC →
 * fórmula, e cada uma precisa ficar congelada por conta própria: precificar
 * o produto A de novo amanhã não pode reescrever o que o cliente recebeu
 * sobre o produto B.
 *
 * A confirmação de custo incompleto vale para a proposta inteira — se
 * QUALQUER linha estiver com custo parcial, quem envia confirma uma vez.
 */
export async function buildLineSnapshots(
  lines: { id: string }[],
  options: { confirmIncompleteCost?: boolean | undefined },
): Promise<[string, PrismaTypes.QuoteLineUpdateInput][]> {
  const result: [string, PrismaTypes.QuoteLineUpdateInput][] = [];

  for (const item of lines) {
    const line = await getQuoteLineWithPricing(item.id);
    // Nome e código do produto ficam congelados na linha: renomear o
    // cadastro amanhã não reescreve a proposta que o cliente recebeu.
    const product = await getPrisma().product.findUnique({ where: { id: line.productId } });
    const productSnapshot: PrismaTypes.QuoteLineUpdateInput = {
      productCodeSnapshot: product?.code ?? line.productCodeSnapshot,
      productNameSnapshot: product?.name ?? line.productNameSnapshot,
    };

    if (line.priceSource !== "PRICING_TIER") {
      result.push([line.id, productSnapshot]);
      continue;
    }

    const provenance = toPricingProvenance(line);
    if (!provenance) {
      result.push([line.id, productSnapshot]);
      continue;
    }

    const incomplete = provenance.costQuality === "PARTIAL" || provenance.costQuality === "NO_COST";
    if (incomplete && !options.confirmIncompleteCost) throw new IncompleteCostQuoteError();

    result.push([line.id, { ...productSnapshot, ...buildProvenanceSnapshot(provenance) }]);
  }

  return result;
}

function buildProvenanceSnapshot(
  provenance: QuotePricingProvenanceDTO,
): PrismaTypes.QuoteLineUpdateInput {
  return {
    pricingCodeSnapshot: provenance.pricingCode,
    pricingVersionNumberSnapshot: provenance.pricingVersionNumber,
    pricingTierQuantitySnapshot: provenance.tierQuantity
      ? new Prisma.Decimal(provenance.tierQuantity)
      : null,
    pricingTierUomSnapshot: provenance.tierUomCode,
    pricingSelectedUnitPriceSnapshot: provenance.selectedUnitPrice
      ? new Prisma.Decimal(provenance.selectedUnitPrice)
      : null,
    costCalculationCodeSnapshot: provenance.calculationCode,
    costReferenceDateSnapshot: provenance.costReferenceDate
      ? new Date(provenance.costReferenceDate)
      : null,
    costStructureLabelSnapshot: provenance.costStructureLabel,
    formulationVersionNumberSnapshot: provenance.formulationVersionNumber,
    industrialCostPerUnitSnapshot: provenance.industrialCostPerUnit
      ? new Prisma.Decimal(provenance.industrialCostPerUnit)
      : null,
    costQualitySnapshot: provenance.costQuality,
    commissionPercentSnapshot: provenance.commissionPercent
      ? new Prisma.Decimal(provenance.commissionPercent)
      : null,
    contributionPerUnitSnapshot: provenance.contributionPerUnit
      ? new Prisma.Decimal(provenance.contributionPerUnit)
      : null,
    contributionMarginSnapshot: provenance.contributionMarginPercent
      ? new Prisma.Decimal(provenance.contributionMarginPercent)
      : null,
    markupSnapshot: provenance.markupPercent ? new Prisma.Decimal(provenance.markupPercent) : null,
    pricingWarningsSnapshot: provenance.warnings as unknown as Prisma.InputJsonValue,
  };
}
