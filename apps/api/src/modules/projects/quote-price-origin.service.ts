import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { QuoteLineAgreementDTO } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { venceuEm } from "../../lib/business-day.js";
import { fecharPrecoUnitarioComercial } from "../../lib/commercial-price.js";
import { Decimal } from "../../lib/decimal.js";
import type { UnitOfMeasureDecimalLike } from "../items/uom.js";
import {
  normalizarQuantidadeDeFaixa,
  unidadeCanonicaDaFaixa,
} from "../pricing/tier-quantity.js";
import { QuoteLineNotFoundError, QuoteNotDraftError } from "./projects.errors.js";

/**
 * Como o preço de uma linha do orçamento é FORMADO — §74.
 *
 * A recompra é o caso normal, não a exceção: um projeto aprovado volta a
 * comprar, e quem negocia precisa responder de onde sai o preço desta vez.
 * São quatro decisões, e cada uma é uma decisão diferente:
 *
 * 1. **manter a condição acordada** — o preço que o cliente já aceitou;
 * 2. **reajustar a condição** — o mesmo acordo, mais um percentual;
 * 3. **usar a precificação atual** — a faixa vigente, com o custo de hoje;
 * 4. **preço manual** — decisão comercial explícita.
 *
 * Antes disto o sistema fazia a primeira em silêncio: a versão nova nascia com
 * `unitPrice` copiado da versão anterior e `priceSource = MANUAL`, e nada no
 * banco dizia que aquele número tinha vindo de um acordo. Não dava para
 * responder "por que R$ 12,50 apareceu aqui?" — nem para saber se a condição
 * ainda valia, nem se tinha sido negociada para outra quantidade.
 *
 * A decisão é **por linha**. Um mesmo orçamento pode manter o preço do produto
 * A, reajustar o do B, aplicar a precificação atual no C e digitar o do D.
 *
 * A conta é do SERVIDOR. A tela mostra prévia; quem fecha o valor é aqui.
 */

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

export class QuoteAgreementSourceNotFoundError extends Error {
  constructor() {
    super("Condição anterior não encontrada.");
    this.name = "QuoteAgreementSourceNotFoundError";
  }
}

/**
 * A condição apontada não serve para esta linha.
 *
 * Não é detalhe de validação: aceitar um id qualquer vindo da tela gravaria
 * uma proveniência falsa — a linha diria "herdado de ORC-000010" apontando
 * para um acordo de outro cliente, outro projeto ou outro produto. O backend
 * confere as quatro condições sempre, mesmo que a tela já tenha filtrado.
 */
export class QuoteAgreementSourceInvalidError extends Error {
  constructor(motivo: string) {
    super(`Condição anterior inválida: ${motivo}`);
    this.name = "QuoteAgreementSourceInvalidError";
  }
}

/**
 * Reutilizar a condição exige dizer por quê.
 *
 * Duas situações: a quantidade desta proposta é outra, ou a condição já
 * venceu. Nenhuma das duas bloqueia a decisão comercial — quem negocia pode
 * manter o preço mesmo assim —, mas nenhuma das duas pode acontecer em
 * silêncio. O motivo fica na linha e viaja com a proveniência.
 */
export class QuoteAgreementReasonRequiredError extends Error {
  constructor(motivo: string) {
    super(`${motivo} Informe o motivo para manter esta condição mesmo assim.`);
    this.name = "QuoteAgreementReasonRequiredError";
  }
}

/**
 * Reajuste não abaixa preço.
 *
 * Decisão de Product Ownership: esta opção representa REAJUSTE. Vender abaixo
 * do acordo anterior é preço manual ou desconto comercial do orçamento, e são
 * mecanismos que já existem. Um percentual negativo aqui confundiria "reajuste
 * da linha" com "desconto do documento", que aparecem em lugares diferentes da
 * proposta e somam de formas diferentes.
 */
export class QuoteAdjustmentNegativeError extends Error {
  constructor() {
    super("Reajuste não aceita percentual negativo — use preço manual ou o desconto do orçamento.");
    this.name = "QuoteAdjustmentNegativeError";
  }
}

const agreementSourceInclude = {
  quoteVersion: { select: { id: true, code: true, versionNumber: true, projectId: true, status: true, acceptedAt: true, validUntil: true } },
  product: { select: { id: true, finishedProductItem: { select: { unitCode: true } } } },
} as const;

type AgreementSource = Prisma.QuoteLineGetPayload<{ include: typeof agreementSourceInclude }>;

/**
 * A condição anterior mais recente para este Projeto e este Produto.
 *
 * A fonte da verdade é a QuoteLine de uma proposta ACEITA — não existe preço
 * no Projeto e não existe tabela de acordo comercial. Uma proposta aceita que
 * já virou Pedido continua servindo de histórico: ela É o acordo daquele
 * Pedido, e ter sido cumprida não a apaga.
 *
 * A escolha é determinística: `acceptedAt` mais recente, e empate resolvido
 * por `versionNumber` e depois por `id`. Sem desempate estável, duas propostas
 * aceitas no mesmo instante fariam a tela sugerir preços diferentes a cada
 * carregamento.
 */
export async function findAgreementSource(
  prisma: PrismaOrTx,
  projectId: string,
  productId: string,
  excludeQuoteVersionId?: string,
): Promise<AgreementSource | null> {
  const candidatas = await prisma.quoteLine.findMany({
    where: {
      productId,
      unitPrice: { not: null },
      quoteVersion: {
        projectId,
        status: "ACCEPTED",
        ...(excludeQuoteVersionId ? { id: { not: excludeQuoteVersionId } } : {}),
      },
    },
    include: agreementSourceInclude,
  });
  if (candidatas.length === 0) return null;

  const ordenadas = [...candidatas].sort((a, b) => {
    const aceiteA = a.quoteVersion.acceptedAt?.getTime() ?? 0;
    const aceiteB = b.quoteVersion.acceptedAt?.getTime() ?? 0;
    if (aceiteA !== aceiteB) return aceiteB - aceiteA;
    if (a.quoteVersion.versionNumber !== b.quoteVersion.versionNumber) {
      return b.quoteVersion.versionNumber - a.quoteVersion.versionNumber;
    }
    return a.id < b.id ? 1 : -1;
  });
  return ordenadas[0] ?? null;
}

/**
 * A quantidade desta linha é fisicamente a mesma da condição anterior?
 *
 * §68, a mesma regra da faixa de precificação: comparação da quantidade
 * NORMALIZADA na unidade canônica do produto, em `Decimal` exato. `1 kg` e
 * `1000 g` são a mesma condição; `10.000 un` e `500 un` não são, e é por isso
 * que a segunda não pode herdar a primeira em silêncio — o preço de dez mil
 * unidades foi negociado sobre dez mil unidades.
 *
 * Sem quantidade na linha não há equivalência a afirmar: devolve `false`.
 */
export function mesmaQuantidadeFisica(
  linha: { quotedQuantity: Prisma.Decimal | null; uomCode: string | null },
  condicao: { quotedQuantity: Prisma.Decimal | null; uomCode: string | null },
  unidadeCanonica: string,
  unidades: readonly UnitOfMeasureDecimalLike[],
): boolean {
  if (!linha.quotedQuantity || !linha.uomCode) return false;
  if (!condicao.quotedQuantity || !condicao.uomCode) return false;
  try {
    const daLinha = normalizarQuantidadeDeFaixa(
      { quantity: linha.quotedQuantity, uomCode: linha.uomCode },
      unidadeCanonica,
      unidades,
    );
    const daCondicao = normalizarQuantidadeDeFaixa(
      { quantity: condicao.quotedQuantity, uomCode: condicao.uomCode },
      unidadeCanonica,
      unidades,
    );
    return daLinha.equals(daCondicao);
  } catch {
    // Unidade de outra dimensão não é equivalente a nada — e não é erro desta
    // pergunta: massa e volume simplesmente não se comparam.
    return false;
  }
}

/**
 * A condição venceu para embasar uma negociação NOVA?
 *
 * Distinção que precisa ficar explícita: uma proposta ACEITA vale para sempre
 * como acordo do Pedido que ela originou — o histórico não expira. O que
 * expira é a sua utilidade como condição VIGENTE para a próxima negociação, e
 * quem responde isso é o `validUntil` da proposta que a registrou.
 *
 * Data civil, regra de §71/§73: o dia inteiro conta em `America/Sao_Paulo`.
 * Proposta sem validade (legado) nunca vence.
 */
export function condicaoVencida(validUntil: Date | null, agora: Date = new Date()): boolean {
  return venceuEm(validUntil, agora);
}

/** A condição anterior, do jeito que a tela precisa vê-la. */
export async function buildAgreementDTO(
  prisma: PrismaOrTx,
  linha: { quotedQuantity: Prisma.Decimal | null; uomCode: string | null },
  fonte: AgreementSource,
  agora: Date = new Date(),
): Promise<QuoteLineAgreementDTO> {
  const unidades = await prisma.unitOfMeasure.findMany();
  const unidadeCanonica = unidadeCanonicaDaFaixa(fonte.product.finishedProductItem?.unitCode);
  const mesmaQuantidade = mesmaQuantidadeFisica(linha, fonte, unidadeCanonica, unidades);
  const vencida = condicaoVencida(fonte.quoteVersion.validUntil, agora);

  return {
    sourceQuoteLineId: fonte.id,
    quoteVersionId: fonte.quoteVersion.id,
    quoteCode: fonte.quoteVersion.code,
    quoteVersionNumber: fonte.quoteVersion.versionNumber,
    acceptedAt: (fonte.quoteVersion.acceptedAt ?? new Date(0)).toISOString(),
    validUntil: fonte.quoteVersion.validUntil ? fonte.quoteVersion.validUntil.toISOString() : null,
    expired: vencida,
    unitPrice: fonte.unitPrice!.toFixed(4),
    quotedQuantity: fonte.quotedQuantity ? fonte.quotedQuantity.toString() : null,
    uomCode: fonte.uomCode,
    sameQuantity: mesmaQuantidade,
    requiresReason: vencida || !mesmaQuantidade,
    // O único caso seguro para vir marcado: vigente E mesma quantidade
    // física. Qualquer outro exige uma decisão humana explícita.
    safeDefault: !vencida && mesmaQuantidade,
  };
}

/** A condição anterior desta linha, ou `null` quando é a primeira compra. */
export async function getQuoteLineAgreement(lineId: string): Promise<QuoteLineAgreementDTO | null> {
  const prisma = getPrisma();
  const linha = await prisma.quoteLine.findUnique({
    where: { id: lineId },
    include: { quoteVersion: { select: { projectId: true, id: true } } },
  });
  if (!linha) throw new QuoteLineNotFoundError(lineId);

  const fonte = await findAgreementSource(
    prisma,
    linha.quoteVersion.projectId,
    linha.productId,
    linha.quoteVersion.id,
  );
  return fonte ? buildAgreementDTO(prisma, linha, fonte) : null;
}

interface LinhaEmEdicao {
  id: string;
  productId: string;
  quotedQuantity: Prisma.Decimal | null;
  uomCode: string | null;
  quoteVersion: { id: string; projectId: string; status: string };
}

async function requireDraftLine(prisma: PrismaOrTx, lineId: string): Promise<LinhaEmEdicao> {
  const linha = await prisma.quoteLine.findUnique({
    where: { id: lineId },
    include: { quoteVersion: { select: { id: true, projectId: true, status: true } } },
  });
  if (!linha) throw new QuoteLineNotFoundError(lineId);
  if (linha.quoteVersion.status !== "DRAFT") throw new QuoteNotDraftError(linha.quoteVersion.status);
  return linha;
}

/**
 * A condição apontada pela tela serve mesmo para esta linha?
 *
 * Quatro perguntas, todas do backend: mesmo Projeto, mesmo Produto, proposta
 * fonte ACEITA e preço existente. O id chega do navegador, e um id que passa
 * sem conferência vira proveniência inventada no banco.
 */
async function resolveAgreementSource(
  prisma: PrismaOrTx,
  linha: LinhaEmEdicao,
  sourceQuoteLineId: string,
): Promise<AgreementSource> {
  const fonte = await prisma.quoteLine.findUnique({
    where: { id: sourceQuoteLineId },
    include: agreementSourceInclude,
  });
  if (!fonte) throw new QuoteAgreementSourceNotFoundError();
  if (fonte.quoteVersion.projectId !== linha.quoteVersion.projectId) {
    throw new QuoteAgreementSourceInvalidError("ela pertence a outro projeto.");
  }
  if (fonte.productId !== linha.productId) {
    throw new QuoteAgreementSourceInvalidError("ela é de outro produto.");
  }
  if (fonte.quoteVersion.status !== "ACCEPTED") {
    throw new QuoteAgreementSourceInvalidError("a proposta de origem não foi aceita.");
  }
  if (fonte.unitPrice === null) {
    throw new QuoteAgreementSourceInvalidError("a linha de origem não tem preço.");
  }
  return fonte;
}

/** Quando a exceção precisa de motivo, e o motivo não veio. */
async function assertReason(
  prisma: PrismaOrTx,
  linha: LinhaEmEdicao,
  fonte: AgreementSource,
  reason: string | undefined,
  agora: Date,
): Promise<void> {
  const dto = await buildAgreementDTO(prisma, linha, fonte, agora);
  if (!dto.requiresReason) return;
  if (reason && reason.trim().length > 0) return;

  if (dto.expired) {
    const dia = fonte.quoteVersion.validUntil
      ? fonte.quoteVersion.validUntil.toLocaleDateString("pt-BR", { timeZone: "UTC" })
      : "—";
    throw new QuoteAgreementReasonRequiredError(`A condição anterior venceu em ${dia}.`);
  }
  throw new QuoteAgreementReasonRequiredError(
    `A condição anterior foi negociada para ${fonte.quotedQuantity?.toString() ?? "—"} ${fonte.uomCode ?? ""}`.trim() +
      ` e esta linha está em ${linha.quotedQuantity?.toString() ?? "—"} ${linha.uomCode ?? ""}`.trimEnd() +
      ".",
  );
}

/**
 * Os vínculos que não sobrevivem a uma nova origem de preço.
 *
 * Quem passa a valer por acordo não pode continuar apontando para a faixa que
 * não foi usada — seria a mesma proveniência falsa que `useManualQuoteLinePrice`
 * já evita do outro lado.
 */
const semVinculoDePrecificacao = {
  priceSource: "MANUAL",
  pricingVersionId: null,
  pricingTierId: null,
} as const;

/**
 * Manter a condição acordada: o preço da linha passa a ser o preço do acordo.
 *
 * Operação de DOMÍNIO, não um `manualPrice` preenchido pela tela. O servidor
 * valida a fonte, mede a quantidade, decide se a exceção precisa de motivo,
 * copia o preço e registra de onde ele veio. A tela que só gravasse
 * `unitPrice` produziria exatamente o problema que esta capability corrige.
 */
export async function inheritQuoteLinePrice(
  lineId: string,
  input: { sourceQuoteLineId: string; reason?: string | undefined },
  agora: Date = new Date(),
): Promise<string> {
  const prisma = getPrisma();
  const linha = await requireDraftLine(prisma, lineId);
  const fonte = await resolveAgreementSource(prisma, linha, input.sourceQuoteLineId);
  await assertReason(prisma, linha, fonte, input.reason, agora);

  await prisma.quoteLine.update({
    where: { id: lineId },
    data: {
      ...semVinculoDePrecificacao,
      priceOrigin: "INHERITED_AGREEMENT",
      inheritedFromQuoteLineId: fonte.id,
      adjustmentPercent: null,
      priceOriginReason: input.reason?.trim() || null,
      unitPrice: fonte.unitPrice,
    },
  });
  return linha.quoteVersion.id;
}

/**
 * Reajustar a condição acordada por um percentual.
 *
 * `novoPreço = preçoAnterior × (1 + percentual ÷ 100)`, fechado em quatro
 * casas com `ROUND_HALF_UP` pela mesma fronteira comercial que a faixa usa
 * (§60). A tela pode mostrar prévia; o valor gravado é o que sai daqui — sem
 * `Number` e sem `toFixed` como motor.
 *
 * MOTIVO não é exigido aqui, e a diferença com "manter" é o ponto: manter
 * afirma que o preço acordado vale para esta linha — e quando a quantidade é
 * outra, ou a condição venceu, isso precisa ser justificado. Reajustar não
 * afirma nada disso: cria um preço NOVO, num documento NOVO, usando a condição
 * apenas como base de cálculo. Por isso reajustar uma condição vencida, ou
 * negociada para outra quantidade, é legítimo sem justificativa — a
 * proveniência continua dizendo de onde a base saiu.
 */
export async function adjustQuoteLinePrice(
  lineId: string,
  input: { sourceQuoteLineId: string; adjustmentPercent: string; reason?: string | undefined },
): Promise<string> {
  const prisma = getPrisma();
  const linha = await requireDraftLine(prisma, lineId);
  const percentual = new Decimal(input.adjustmentPercent);
  if (percentual.lessThan(0)) throw new QuoteAdjustmentNegativeError();

  const fonte = await resolveAgreementSource(prisma, linha, input.sourceQuoteLineId);
  const base = new Decimal(fonte.unitPrice!.toString());
  const novoPreco = fecharPrecoUnitarioComercial(base.times(percentual.dividedBy(100).plus(1)));

  await prisma.quoteLine.update({
    where: { id: lineId },
    data: {
      ...semVinculoDePrecificacao,
      priceOrigin: "ADJUSTED_AGREEMENT",
      inheritedFromQuoteLineId: fonte.id,
      adjustmentPercent: new Prisma.Decimal(percentual.toString()),
      priceOriginReason: input.reason?.trim() || null,
      unitPrice: new Prisma.Decimal(novoPreco.toString()),
    },
  });
  return linha.quoteVersion.id;
}

/**
 * A origem que a mudança de quantidade invalidou.
 *
 * Um preço herdado de "10.000 un" não continua descrevendo uma linha que
 * passou a 500 un: a proveniência estaria mentindo, e a proposta sairia
 * dizendo que o cliente acordou aquele preço para aquela quantidade. O padrão
 * escolhido é o de `useManualQuoteLinePrice` — o vínculo cai —, com uma
 * diferença: o PREÇO cai junto. Ele nunca foi digitado por quem edita; ele era
 * o acordo, e o acordo não vale mais para esta linha. A linha volta a "não
 * precificado", e o envio já recusa linha sem preço.
 *
 * Preço MANUAL não é afetado: aquele número foi digitado por quem negocia, e
 * mudar a quantidade não o desautoriza.
 */
export function limparOrigemPorQuantidade(
  priceOrigin: string | null,
): Prisma.QuoteLineUncheckedUpdateInput {
  if (priceOrigin !== "INHERITED_AGREEMENT" && priceOrigin !== "ADJUSTED_AGREEMENT") return {};
  return {
    unitPrice: null,
    priceOrigin: null,
    inheritedFromQuoteLineId: null,
    adjustmentPercent: null,
    priceOriginReason: null,
  };
}
