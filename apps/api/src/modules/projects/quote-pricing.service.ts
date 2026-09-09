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
import {
  normalizarQuantidadeDeFaixa,
  quantidadesDeFaixaEquivalentes,
  unidadeCanonicaDaFaixa,
} from "../pricing/tier-quantity.js";
import { QuoteNotDraftError, QuoteNotFoundError } from "./projects.errors.js";
import { precoUnitario, resultadoTecnico } from "../../lib/decimal-serialization.js";
import { fecharPrecoUnitarioComercial } from "../../lib/commercial-price.js";
import { fecharResultadoTecnicoPersistido } from "../../lib/technical-result.js";

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
  /*
   * O snapshot congelado manda, venha o preço de onde vier — §74.
   *
   * Desde que a proposta enviada passou a congelar a economia CORRENTE também
   * para linha sem faixa (preço herdado, reajustado ou manual), exigir
   * `PRICING_TIER` aqui esconderia o que acabou de ser gravado: a linha ficava
   * com `pricing: null` sobre um snapshot que existe no banco.
   *
   * O que este bloco devolve é a REFERÊNCIA ECONÔMICA do documento, não a
   * origem do preço. Quem responde "de onde veio este preço" é `priceOrigin`,
   * e uma linha herdada continua dizendo `INHERITED_AGREEMENT` mesmo tendo
   * CMV e faixa congelados ao lado.
   */
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
      // Proveniência TÉCNICA em oito casas — PREC-P-04. Não é o preço do
      // documento: `QuoteLine.unitPrice` responde por esse, em quatro casas.
      selectedUnitPrice: quote.pricingSelectedUnitPriceSnapshot
        ? precoUnitario(quote.pricingSelectedUnitPriceSnapshot)
        : null,
      calculationCode: quote.costCalculationCodeSnapshot,
      costReferenceDate: quote.costReferenceDateSnapshot
        ? quote.costReferenceDateSnapshot.toISOString()
        : null,
      costStructureLabel: quote.costStructureLabelSnapshot,
      formulationVersionNumber: quote.formulationVersionNumberSnapshot,
      // RESULTADO TÉCNICO congelado — `DECIMAL(24,12)`, PREC-E-01. Servia seis
      // casas porque a coluna guardava seis; com ela em doze isso seria a
      // migration desfeita na saída.
      industrialCostPerUnit: quote.industrialCostPerUnitSnapshot
        ? resultadoTecnico(quote.industrialCostPerUnitSnapshot)
        : null,
      costQuality: quote.costQualitySnapshot,
      commissionPercent: quote.commissionPercentSnapshot
        ? quote.commissionPercentSnapshot.toFixed(4)
        : null,
      // RESULTADO TÉCNICO congelado — `DECIMAL(24,12)`, PREC-D-03. Servia seis
      // casas; com a coluna em doze isso seria a migration desfeita na saída.
      contributionPerUnit: quote.contributionPerUnitSnapshot
        ? resultadoTecnico(quote.contributionPerUnitSnapshot)
        : null,
      contributionMarginPercent: quote.contributionMarginSnapshot
        ? quote.contributionMarginSnapshot.toFixed(4)
        : null,
      markupPercent: quote.markupSnapshot ? quote.markupSnapshot.toFixed(4) : null,
      warnings: (quote.pricingWarningsSnapshot as unknown as IndustrialCostWarningDTO[]) ?? [],
      frozen: true,
    };
  }

  // Enquanto é rascunho, a proveniência é a leitura VIVA da faixa vinculada —
  // e só existe quando a linha foi precificada por faixa.
  if (quote.priceSource !== "PRICING_TIER") return null;
  const tier = quote.pricingTier;
  const version = quote.pricingVersion;
  if (!tier || !version) return null;

  return provenanceFromTier(version, tier);
}

/** A leitura viva de uma faixa, no formato da proveniência. */
function provenanceFromTier(
  version: PrismaTypes.PricingVersionGetPayload<object>,
  tier: PrismaTypes.PricingTierGetPayload<object>,
): QuotePricingProvenanceDTO {
  return {
    pricingVersionId: version.id,
    pricingCode: version.code,
    pricingVersionNumber: version.versionNumber,
    pricingTierId: tier.id,
    tierQuantity: tier.quantity.toString(),
    tierUomCode: tier.uomCode,
    selectedUnitPrice: tier.selectedPriceSnapshot
      ? precoUnitario(tier.selectedPriceSnapshot)
      : null,
    calculationCode: version.calculationCodeSnapshot,
    costReferenceDate: version.costReferenceDateSnapshot.toISOString(),
    costStructureLabel: version.industrialCostVersionLabelSnapshot,
    formulationVersionNumber: version.formulationVersionNumberSnapshot,
    industrialCostPerUnit: tier.costPerUnitSnapshot ? resultadoTecnico(tier.costPerUnitSnapshot) : null,
    costQuality: tier.costQualitySnapshot,
    commissionPercent: (tier.commissionPercentSnapshot ?? tier.commissionPercent).toFixed(4),
    contributionPerUnit: tier.contributionPerUnitSnapshot
      ? resultadoTecnico(tier.contributionPerUnitSnapshot)
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
      /*
       * A decisão comercial deste ciclo — §74. `priceSource` continua
       * respondendo "tecnicamente veio de faixa?"; `priceOrigin` responde
       * "qual escolha formou este preço?". Aplicar a faixa apaga qualquer
       * herança: o preço passou a ser o da precificação atual.
       */
      priceOrigin: "CURRENT_PRICING",
      inheritedFromQuoteLineId: null,
      adjustmentPercent: null,
      priceOriginReason: null,
      pricingVersionId: tier.pricingVersionId,
      pricingTierId: tier.id,
      quotedQuantity: tier.quantity,
      uomCode: tier.uomCode,
      /*
       * A FRONTEIRA técnica → comercial, e o único lugar onde ela acontece.
       *
       * A faixa guarda `4.05318764`; a linha do Orçamento congela `4.0532`.
       * A redução não é perda: é o fechamento do acordo, e `PRODUCT_RULES.md`
       * §60 diz que ele é deliberado, em código de domínio, nunca por scale de
       * coluna nem por formatter. A proveniência técnica sobrevive inteira ao
       * lado, em `pricingSelectedUnitPriceSnapshot`.
       */
      unitPrice: fecharPrecoUnitarioComercial(tier.selectedPriceSnapshot),
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
    data: {
      priceSource: "MANUAL",
      // Assumir o preço à mão é uma decisão comercial explícita, e é ela que
      // fica registrada — §74. Nenhuma herança sobrevive a isto.
      priceOrigin: "MANUAL",
      inheritedFromQuoteLineId: null,
      adjustmentPercent: null,
      priceOriginReason: null,
      pricingVersionId: null,
      pricingTierId: null,
    },
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

/**
 * A faixa da precificação ATIVA que representa a quantidade desta linha.
 *
 * Identidade por quantidade FÍSICA normalizada na unidade canônica do produto
 * — §68, a mesma regra da faixa. `1 kg` e `1000 g` são a mesma faixa; `500 g`
 * e `500 kg` não são. Sem quantidade na linha não há faixa a escolher, e
 * escolher "a mais próxima" seria inventar cenário econômico.
 */
async function faixaEquivalenteVigente(line: {
  productId: string;
  quotedQuantity: Prisma.Decimal | null;
  uomCode: string | null;
}): Promise<{
  version: PrismaTypes.PricingVersionGetPayload<object>;
  tier: PrismaTypes.PricingTierGetPayload<object>;
} | null> {
  if (!line.quotedQuantity || !line.uomCode) return null;
  const prisma = getPrisma();

  const version = await prisma.pricingVersion.findFirst({
    where: { productId: line.productId, status: "ACTIVE" },
    include: { tiers: true, product: { select: { finishedProductItem: { select: { unitCode: true } } } } },
  });
  if (!version) return null;

  const units = await prisma.unitOfMeasure.findMany();
  const unidadeCanonica = unidadeCanonicaDaFaixa(version.product.finishedProductItem?.unitCode);
  let daLinha: Prisma.Decimal;
  try {
    daLinha = normalizarQuantidadeDeFaixa(
      { quantity: line.quotedQuantity, uomCode: line.uomCode },
      unidadeCanonica,
      units,
    );
  } catch {
    // Linha em unidade de outra dimensão não casa com faixa nenhuma.
    return null;
  }

  const tier = version.tiers.find((candidata) =>
    quantidadesDeFaixaEquivalentes(candidata, daLinha, unidadeCanonica, units),
  );
  if (!tier) return null;

  const { tiers: _tiers, product: _product, ...versionRow } = version;
  return { version: versionRow, tier };
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

    /*
     * Preço que NÃO veio de faixa também congela economia — §74.
     *
     * O preço de uma linha herdada é o acordo anterior; o CUSTO dela é o de
     * hoje. Congelar o CMV antigo junto com o preço faria a proposta nova
     * descrever a economia de um documento passado, e a variação de custo
     * entre um ciclo e o outro é exatamente o que se quer medir depois.
     * Congelar nada — que era o comportamento — deixava a proposta enviada sem
     * base econômica nenhuma.
     *
     * A referência atual é a faixa da precificação ATIVA cuja quantidade
     * física é a mesma da linha (§68): mesma fonte de CMV do resto do sistema,
     * sem um segundo motor. Sem precificação ativa para aquela quantidade não
     * há custo corrente a congelar, e a linha segue só com o produto — o preço
     * do acordo não depende dele para ser válido.
     *
     * A confirmação de custo incompleto continua valendo só para quem
     * PRECIFICOU pela faixa: ali o custo formou o preço. Aqui ele é
     * referência econômica, e não pode passar a bloquear um envio que hoje
     * acontece.
     */
    if (line.priceSource !== "PRICING_TIER") {
      const corrente = await faixaEquivalenteVigente(line);
      result.push([
        line.id,
        corrente
          ? { ...productSnapshot, ...buildProvenanceSnapshot(provenanceFromTier(corrente.version, corrente.tier)) }
          : productSnapshot,
      ]);
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
    // FRONTEIRA DE PERSISTÊNCIA do resultado técnico — PREC-E-01. A
    // proveniência chega da faixa em doze casas e a coluna guardava seis: o
    // `update` deixava o PostgreSQL cortar a sétima. Medido antes de migrar:
    // `1000,00 ÷ 300` valia `3.333333333333` na faixa e `3.333333` na linha.
    industrialCostPerUnitSnapshot: provenance.industrialCostPerUnit
      ? fecharResultadoTecnicoPersistido(new Prisma.Decimal(provenance.industrialCostPerUnit))
      : null,
    costQualitySnapshot: provenance.costQuality,
    commissionPercentSnapshot: provenance.commissionPercent
      ? new Prisma.Decimal(provenance.commissionPercent)
      : null,
    // FRONTEIRA DE PERSISTÊNCIA do resultado técnico — PREC-D-03. A
    // proveniência chega da faixa já em doze casas; o fechamento explícito
    // está aqui para que o banco nunca seja a primeira camada a decidir a
    // escala deste congelamento, mesmo que a origem mude de forma.
    contributionPerUnitSnapshot: provenance.contributionPerUnit
      ? fecharResultadoTecnicoPersistido(new Prisma.Decimal(provenance.contributionPerUnit))
      : null,
    contributionMarginSnapshot: provenance.contributionMarginPercent
      ? new Prisma.Decimal(provenance.contributionMarginPercent)
      : null,
    markupSnapshot: provenance.markupPercent ? new Prisma.Decimal(provenance.markupPercent) : null,
    pricingWarningsSnapshot: provenance.warnings as unknown as Prisma.InputJsonValue,
  };
}
