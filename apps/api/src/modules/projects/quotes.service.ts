import { Prisma } from "@prisma/client";
import type { Customer, Prisma as PrismaTypes, Project, User } from "@prisma/client";
import type {
  DuplicateQuoteVersionInput,
  QuoteLineDTO,
  QuotePaymentScheduleDTO,
  QuotePricingProvenanceDTO,
  QuoteVersionDTO,
} from "@veridi/shared";
import { QUOTE_CODE_PREFIX, QUOTE_STATUS_LABELS, calcularTotaisOrcamento } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { diaComercialPorExtenso, venceuEm } from "../../lib/business-day.js";
import {
  IncompleteQuoteError,
  ProjectLockedError,
  ProjectNotFoundError,
  ProjectProductNotInApprovedScopeError,
  QuoteDraftExistsError,
  QuoteExpiredError,
  QuoteLineDuplicateError,
  QuoteLineNotFoundError,
  QuoteLineProductNotInProjectError,
  QuoteNotDraftError,
  QuoteNotFoundError,
  QuoteNotSentError,
  QuoteWithoutValidUntilError,
} from "./projects.errors.js";
import { getProjectById } from "./projects.service.js";
import { buildPaymentSchedule } from "./quote-payment.js";
import {
  assertPriceEditable,
  buildLineSnapshots,
  linePricingInclude,
  pricingProvenanceForLine,
} from "./quote-pricing.service.js";
import {
  buildAgreementDTO,
  findAgreementSource,
  limparOrigemPorQuantidade,
} from "./quote-price-origin.service.js";
import type {
  RejectQuoteInput,
  UpdateQuoteLineInput,
  UpdateQuoteVersionInput,
} from "./projects.schemas.js";

/**
 * Orçamentos versionados.
 *
 * A negociação acontece por VERSÃO: só o rascunho é editável, enviar
 * congela o snapshot do cliente/projeto e torna a versão imutável, e toda
 * nova proposta é uma versão nova — nunca uma edição do que já foi
 * apresentado.
 */

const CODE_SEQUENCE = "quote_code_seq";

/**
 * DTO do orçamento.
 *
 * A proveniência econômica (PREC/CALC/custo/margem) é INFORMAÇÃO INTERNA:
 * só entra quando quem chamou pode vê-la, e nunca no documento do cliente.
 */
/**
 * Cliente e projeto como o cadastro está AGORA — o que o envio congela na
 * versão e o que o rascunho mostra enquanto nada foi congelado.
 */
const cadastroDaPropostaSelect = {
  select: {
    code: true,
    name: true,
    concept: true,
    channel: true,
    customer: {
      select: {
        code: true,
        legalName: true,
        tradeName: true,
        cnpj: true,
        zipCode: true,
        street: true,
        number: true,
        complement: true,
        district: true,
        city: true,
        state: true,
      },
    },
  },
} as const;

type CadastroDaProposta = Pick<Project, "code" | "name" | "concept" | "channel"> & {
  customer: Pick<
    Customer,
    | "code"
    | "legalName"
    | "tradeName"
    | "cnpj"
    | "zipCode"
    | "street"
    | "number"
    | "complement"
    | "district"
    | "city"
    | "state"
  >;
};

/** Os campos de cliente e projeto do documento, lidos do cadastro. */
function cadastroDaProposta(project: CadastroDaProposta) {
  const { customer } = project;
  return {
    customerCode: customer.code,
    customerName: customer.legalName,
    customerTradeName: customer.tradeName,
    customerCnpj: customer.cnpj,
    customerZipCode: customer.zipCode,
    customerStreet: customer.street,
    customerNumber: customer.number,
    customerComplement: customer.complement,
    customerDistrict: customer.district,
    customerCity: customer.city,
    customerState: customer.state,
    projectCode: project.code,
    projectName: project.name,
    projectConcept: project.concept,
    projectChannel: project.channel,
  };
}

export const quoteInclude = {
  // Rascunho ainda não congelou cliente e projeto: o documento lê o cadastro
  // atual neste mesmo carregamento — nunca uma consulta por campo.
  project: cadastroDaPropostaSelect,
  // O Pedido gerado entra no include para a navegação não ser de mão única:
  // quem abre a proposta aceita precisa chegar ao pedido sem buscar por texto.
  sourcedCustomerOrder: {
    select: { id: true, code: true, status: true, createdAt: true },
  },
  lines: {
    orderBy: { sortOrder: "asc" as const },
    // `pricingVersion`/`pricingTier` vêm junto porque a proveniência é
    // montada aqui: sem elas o DTO devolvia `pricing: null` mesmo em linha
    // com `priceSource = PRICING_TIER`, e a UI perdia PREC/faixa/qualidade
    // de custo — inclusive a detecção de custo incompleto no envio.
    include: { product: true, ...linePricingInclude },
  },
} as const;

export type QuoteWithLines = PrismaTypes.QuoteVersionGetPayload<{ include: typeof quoteInclude }>;

function toQuoteLineDTO(
  line: QuoteWithLines["lines"][number],
  pricing: QuotePricingProvenanceDTO | null,
  /** Vem de `calcularTotaisOrcamento` — a mesma conta que a tela usa na prévia. */
  total: string | null,
): QuoteLineDTO {
  return {
    id: line.id,
    quoteVersionId: line.quoteVersionId,
    projectProductId: line.projectProductId,
    productId: line.productId,
    productCode: line.productCodeSnapshot ?? line.product.code,
    productName: line.productNameSnapshot ?? line.product.name,
    sortOrder: line.sortOrder,
    quotedQuantity: line.quotedQuantity ? line.quotedQuantity.toString() : null,
    uomCode: line.uomCode,
    unitPrice: line.unitPrice !== null ? line.unitPrice.toFixed(4) : null,
    total,
    priceSource: line.priceSource,
    priceOrigin: line.priceOrigin,
    inheritedFromQuoteLineId: line.inheritedFromQuoteLineId,
    adjustmentPercent: line.adjustmentPercent ? line.adjustmentPercent.toFixed(4) : null,
    priceOriginReason: line.priceOriginReason,
    pricing,
  };
}

/**
 * Custo, margem, markup e comissão são informação interna: só quem negocia
 * (ou administra) recebe a proveniência econômica.
 */
export function canSeePricingProvenance(role: string): boolean {
  return role === "COMMERCIAL" || role === "ADMIN";
}

export function toQuoteVersionDTO(
  quote: QuoteWithLines,
  includePricing: boolean,
): QuoteVersionDTO {
  /*
   * Total de linha e subtotal saem de `calcularTotaisOrcamento`, em
   * `@veridi/shared` — a MESMA função que a tela usa para mostrar o efeito
   * de mudar quantidade ou preço antes de salvar. Total derivado nunca é
   * persistido, e só existe quando TODAS as linhas têm preço: somar o que
   * está precificado e ignorar o resto entregaria um número menor que a
   * proposta, com cara de total.
   */
  const totais = calcularTotaisOrcamento(
    quote.lines.map((line) => ({
      quotedQuantity: line.quotedQuantity ? line.quotedQuantity.toString() : null,
      unitPrice: line.unitPrice !== null ? line.unitPrice.toString() : null,
    })),
  );
  const lines = quote.lines.map((line, indice) =>
    toQuoteLineDTO(
      line,
      includePricing ? pricingProvenanceForLine(line, quote.status) : null,
      totais.lineTotals[indice] ?? null,
    ),
  );
  const subtotal = totais.subtotal;

  // O plano é derivado: desconto, entrada, parcelas e juros saem daqui, nunca
  // de um valor digitado. `total` passa a ser o preço à vista JÁ COM desconto
  // — é o que a proposta vale, e o que a lista de versões mostra.
  const paymentSchedule =
    subtotal === null
      ? null
      : buildPaymentSchedule({
          subtotal: new Prisma.Decimal(subtotal),
          discountPercent: quote.discountPercent,
          method: quote.paymentMethod,
          downPaymentPercent: quote.downPaymentPercent,
          installmentCount: quote.installmentCount,
          installmentIntervalDays: quote.installmentIntervalDays,
          monthlyInterestPercent: quote.monthlyInterestPercent,
        });
  const total = paymentSchedule ? paymentSchedule.total : null;

  /*
   * Cliente e projeto do documento. O ENVIO congela o snapshot, e dali em
   * diante o documento nunca relê o cadastro — nem quando o snapshot falta
   * (versão legada): história não muda porque o cadastro mudou. Antes do
   * envio não existe snapshot; o rascunho mostra o cadastro atual, o mesmo
   * que o envio vai congelar — a regra do Pedido e da OP, ao vivo até o
   * congelamento. Sem isso o rascunho saía com Cliente, CNPJ e Projeto "—".
   */
  const parte = quote.status === "DRAFT" ? cadastroDaProposta(quote.project) : quote;

  return {
    id: quote.id,
    code: quote.code,
    projectId: quote.projectId,
    versionNumber: quote.versionNumber,
    versionLabel: `${quote.code} · V${quote.versionNumber}`,
    externalCode: quote.externalCode,
    status: quote.status,
    source: quote.source,
    quoteDate: quote.quoteDate.toISOString(),
    validUntil: quote.validUntil ? quote.validUntil.toISOString() : null,
    /*
     * Vencida é estado DERIVADO, calculado a cada leitura — nada varre o banco
     * à meia-noite e nenhum status `EXPIRED` existe. Só vale enquanto a
     * proposta está ENVIADA: a validade fecha a janela de aceite, e aceita que
     * virou acordo não vence retroativamente por causa do calendário.
     */
    expired: quote.status === "SENT" && venceuEm(quote.validUntil, new Date()),
    currencyCode: quote.currencyCode,
    lines,
    total,
    subtotal,
    discountPercent: quote.discountPercent ? quote.discountPercent.toFixed(4) : null,
    paymentMethod: quote.paymentMethod,
    downPaymentPercent: quote.downPaymentPercent ? quote.downPaymentPercent.toFixed(4) : null,
    installmentCount: quote.installmentCount,
    installmentIntervalDays: quote.installmentIntervalDays,
    monthlyInterestPercent: quote.monthlyInterestPercent
      ? quote.monthlyInterestPercent.toFixed(4)
      : null,
    paymentSchedule,
    sourcedOrder: quote.sourcedCustomerOrder
      ? {
          id: quote.sourcedCustomerOrder.id,
          code: quote.sourcedCustomerOrder.code,
          status: quote.sourcedCustomerOrder.status,
          createdAt: quote.sourcedCustomerOrder.createdAt.toISOString(),
        }
      : null,
    commercialNotes: quote.commercialNotes,
    paymentTerms: quote.paymentTerms,
    leadTimeDays: quote.leadTimeDays,
    sentAt: quote.sentAt ? quote.sentAt.toISOString() : null,
    sentByName: quote.sentByNameSnapshot,
    acceptedAt: quote.acceptedAt ? quote.acceptedAt.toISOString() : null,
    acceptedByName: quote.acceptedByNameSnapshot,
    rejectedAt: quote.rejectedAt ? quote.rejectedAt.toISOString() : null,
    rejectedByName: quote.rejectedByNameSnapshot,
    rejectionReason: quote.rejectionReason,
    customerCode: parte.customerCode,
    customerName: parte.customerName,
    customerTradeName: parte.customerTradeName,
    customerCnpj: parte.customerCnpj,
    customerZipCode: parte.customerZipCode,
    customerStreet: parte.customerStreet,
    customerNumber: parte.customerNumber,
    customerComplement: parte.customerComplement,
    customerDistrict: parte.customerDistrict,
    customerCity: parte.customerCity,
    customerState: parte.customerState,
    projectCode: parte.projectCode,
    projectName: parte.projectName,
    projectConcept: parte.projectConcept,
    projectChannel: parte.projectChannel,
    createdAt: quote.createdAt.toISOString(),
    createdByName: quote.createdByNameSnapshot,
  };
}

export async function getQuoteById(
  id: string,
  includePricing = false,
): Promise<QuoteVersionDTO | null> {
  const quote = await getPrisma().quoteVersion.findUnique({ where: { id }, include: quoteInclude });
  return quote ? toQuoteVersionDTO(quote, includePricing) : null;
}

async function requireQuoteWithLines(id: string): Promise<QuoteWithLines> {
  const quote = await getPrisma().quoteVersion.findUnique({ where: { id }, include: quoteInclude });
  if (!quote) throw new QuoteNotFoundError(id);
  return quote;
}

/**
 * Cria a próxima versão. Se já existe rascunho aberto, devolve o próprio
 * rascunho — negociação não tem duas propostas em edição ao mesmo tempo.
 * Os dados comerciais da última versão são copiados como ponto de partida;
 * status, timestamps e auditoria nunca são.
 */
/**
 * Esta versão pode virar histórico quando outra a substitui?
 *
 * SENT sim, sempre: proposta apresentada e não fechada é rascunho de
 * negociação. ACEITA depende do que ela produziu — e a evidência é o Pedido,
 * não um status novo.
 *
 * Uma proposta aceita que JÁ GEROU PEDIDO é o acordo que originou aquele
 * Pedido. Marcá-la SUPERSEDED porque o cliente comprou de novo em março
 * reescreveria a origem do que foi vendido em janeiro: o Pedido apontaria para
 * um documento que o próprio sistema chama de superado. Aceita que ainda não
 * virou Pedido é outra coisa — é oferta em aberto, e a versão nova a substitui.
 */
async function superseder(
  tx: Prisma.TransactionClient,
  quoteVersionId: string,
  status: string,
): Promise<boolean> {
  if (status !== "ACCEPTED") return true;
  const pedido = await tx.customerOrder.findUnique({
    where: { sourceQuoteVersionId: quoteVersionId },
    select: { id: true },
  });
  return pedido === null;
}

export async function createQuoteVersion(
  projectId: string,
  actor: User,
): Promise<QuoteVersionDTO> {
  const prisma = getPrisma();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { quoteVersions: { orderBy: { versionNumber: "desc" } } },
  });
  if (!project) throw new ProjectNotFoundError(projectId);
  /*
   * Projeto APROVADO recebe orçamento novo.
   *
   * `APPROVED` diz que o desenvolvimento técnico e comercial inicial foi
   * aprovado — não que a relação com o cliente acabou. Todo novo compromisso
   * de compra é uma nova proposta, e o cliente que volta a comprar em março o
   * que fechou em janeiro negocia dentro do MESMO projeto: mesmos produtos,
   * mesma história técnica. Abrir projeto novo a cada recompra multiplicaria
   * o cadastro pelo calendário.
   *
   * Cancelado continua fechado: ali a negociação acabou de verdade.
   */
  if (project.status === "CANCELLED") {
    throw new ProjectLockedError(project.status);
  }

  const existingDraft = project.quoteVersions.find((quote) => quote.status === "DRAFT");
  if (existingDraft) return (await getQuoteById(existingDraft.id)) as QuoteVersionDTO;

  const previous = project.quoteVersions[0] ?? null;
  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, QUOTE_CODE_PREFIX);

  const created = await prisma.$transaction(async (tx) => {
    // Trava o projeto: duas criações simultâneas não podem gerar o mesmo
    // número de versão.
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;

    const maxVersion = await tx.quoteVersion.aggregate({
      where: { projectId },
      _max: { versionNumber: true },
    });

    const quote = await tx.quoteVersion.create({
      data: {
        code,
        projectId,
        versionNumber: (maxVersion._max.versionNumber ?? 0) + 1,
        status: "DRAFT",
        quoteDate: new Date(),
        // Condições comerciais servem de ponto de partida.
        ...(previous
          ? {
              currencyCode: previous.currencyCode,
              commercialNotes: previous.commercialNotes,
              paymentTerms: previous.paymentTerms,
              leadTimeDays: previous.leadTimeDays,
              // Desconto e plano de pagamento também são condição comercial:
              // renegociar quase sempre parte do que já estava na mesa.
              discountPercent: previous.discountPercent,
              paymentMethod: previous.paymentMethod,
              downPaymentPercent: previous.downPaymentPercent,
              installmentCount: previous.installmentCount,
              installmentIntervalDays: previous.installmentIntervalDays,
              monthlyInterestPercent: previous.monthlyInterestPercent,
            }
          : {}),
        createdByUserId: actor.id,
        createdByNameSnapshot: actor.name,
      },
    });

    /*
     * As linhas da versão anterior vêm junto — quantidade e unidade como ponto
     * de partida. O PREÇO é outra história, e foi o que esta capability
     * corrigiu (§74).
     *
     * Antes, `unitPrice` era copiado com `priceSource = MANUAL` e nada dizia
     * de onde aquele número tinha vindo. Era herança silenciosa: a proposta
     * nova saía com o preço da anterior sem que ninguém tivesse decidido
     * mantê-lo, sem conferir se a condição ainda valia e sem notar que ela
     * tinha sido negociada para outra quantidade.
     *
     * Agora o preço só nasce preenchido no ÚNICO caso seguro: existe condição
     * acordada (proposta ACEITA do mesmo projeto e produto), ela ainda está
     * vigente, e a quantidade física é a mesma. Aí ele nasce com proveniência
     * — `INHERITED_AGREEMENT` apontando para a linha reutilizada —, que é o
     * happy path da recompra. Em qualquer outro caso a linha nasce SEM preço e
     * quem negocia escolhe: manter mesmo assim, reajustar, usar a precificação
     * atual ou digitar.
     *
     * O vínculo com a precificação continua não sendo herdado: cada proposta
     * confirma a própria base econômica.
     */
    let validadeSugerida: Date | null = null;
    let todasHerdadas = previous !== null;
    if (previous) {
      const previousLines = await tx.quoteLine.findMany({
        where: { quoteVersionId: previous.id },
        orderBy: { sortOrder: "asc" },
      });
      for (const line of previousLines) {
        const fonte = await findAgreementSource(tx, projectId, line.productId, quote.id);
        const acordo = fonte ? await buildAgreementDTO(tx, line, fonte) : null;
        const herdavel = acordo?.safeDefault === true && fonte !== null;

        if (!herdavel) todasHerdadas = false;
        else if (validadeSugerida === null) validadeSugerida = fonte!.quoteVersion.validUntil;
        else if (validadeSugerida.getTime() !== (fonte!.quoteVersion.validUntil?.getTime() ?? -1)) {
          // Linhas herdadas de propostas com validades diferentes não sugerem
          // validade nenhuma: escolher uma delas seria arbitrar.
          todasHerdadas = false;
        }

        await tx.quoteLine.create({
          data: {
            quoteVersionId: quote.id,
            projectProductId: line.projectProductId,
            productId: line.productId,
            sortOrder: line.sortOrder,
            quotedQuantity: line.quotedQuantity,
            uomCode: line.uomCode,
            priceSource: "MANUAL",
            ...(herdavel
              ? {
                  unitPrice: fonte!.unitPrice,
                  priceOrigin: "INHERITED_AGREEMENT" as const,
                  inheritedFromQuoteLineId: fonte!.id,
                }
              : {}),
          },
        });
      }

      /*
       * Validade SUGERIDA, nunca imposta — §74. Quando a proposta nova é a
       * mesma condição vigente inteira, repetir o prazo dela poupa uma
       * digitação e é o que quem negocia esperaria ver. O campo continua sendo
       * do documento novo: dá para trocar, e COM-CORE segue exigindo validade
       * antes do envio.
       */
      if (todasHerdadas && validadeSugerida && previousLines.length > 0) {
        await tx.quoteVersion.update({
          where: { id: quote.id },
          data: { validUntil: validadeSugerida },
        });
      }
    }

    // A versão anterior formalmente apresentada passa a ser histórico —
    // exceto a aceita que JÁ VIROU PEDIDO. Recusada e arquivada permanecem
    // como estão. Ver `superseder`.
    if (previous && (previous.status === "SENT" || previous.status === "ACCEPTED")) {
      if (await superseder(tx, previous.id, previous.status)) {
        await tx.quoteVersion.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
      }
    }

    return quote;
  });

  return (await getQuoteById(created.id)) as QuoteVersionDTO;
}

/**
 * Duplica uma versão ESCOLHIDA como a próxima — QUOTE-DUPLICATE-01, §85.
 *
 * A fonte é a versão que quem negocia está lendo, não a mais recente: com V3
 * existindo, partir da V1 é pedido legítimo. A versão nova nasce `DRAFT`, com
 * o próximo número do projeto, os mesmos produtos, quantidades, unidades,
 * ordem e condições comerciais — e NADA do que é história da origem: status,
 * envio, aceite, recusa, snapshots de cliente e de custo congelados no envio.
 *
 * O PREÇO é a escolha explícita recebida (`priceStrategy`), sem padrão:
 *
 * - `KEEP_PRICES` copia `unitPrice` exatamente. Não recalcula, não rebaseia,
 *   não lê a precificação atual e não cria vínculo com faixa nenhuma. A
 *   proveniência diz o que aconteceu: de proposta ACEITA é a condição acordada
 *   (`INHERITED_AGREEMENT`, apontando para a linha real, como §74); de
 *   qualquer outra é referência que alguém decidiu manter (`MANUAL`), nunca
 *   "acordo";
 * - `REVIEW_PRICES` deixa a linha sem preço — o estado canônico de "aguardando
 *   decisão de preço", o mesmo que a linha nova já tem.
 *
 * Nenhuma outra versão muda: nem a origem, nem a enviada mais recente. Tudo
 * numa transação — ou nasce a versão inteira, ou nada.
 */
export async function duplicateQuoteVersion(
  sourceId: string,
  input: DuplicateQuoteVersionInput,
  actor: User,
): Promise<QuoteVersionDTO> {
  const prisma = getPrisma();
  const source = await prisma.quoteVersion.findUnique({
    where: { id: sourceId },
    include: {
      project: { select: { status: true } },
      lines: {
        orderBy: { sortOrder: "asc" },
        include: {
          projectProduct: { select: { status: true } },
          product: { select: { code: true } },
        },
      },
    },
  });
  if (!source) throw new QuoteNotFoundError(sourceId);
  if (source.project.status === "CANCELLED") throw new ProjectLockedError(source.project.status);

  // Num projeto aprovado a versão nova negocia o ESCOPO APROVADO — a mesma
  // regra de quem adiciona produto à proposta (`addQuoteLine`).
  if (source.project.status === "APPROVED") {
    const fora = source.lines.find(
      (line) => line.projectProduct !== null && line.projectProduct.status !== "APPROVED",
    );
    if (fora) throw new ProjectProductNotInApprovedScopeError(fora.product.code);
  }

  const rascunhoAberto = async (client: Prisma.TransactionClient | typeof prisma) => {
    const rascunho = await client.quoteVersion.findFirst({
      where: { projectId: source.projectId, status: "DRAFT" },
      select: { versionNumber: true },
    });
    if (rascunho) throw new QuoteDraftExistsError(rascunho.versionNumber);
  };
  // Antes de consumir número de documento — e de novo dentro da trava.
  await rascunhoAberto(prisma);

  const agora = new Date();
  const manter = input.priceStrategy === "KEEP_PRICES";
  const acordo = source.status === "ACCEPTED";
  const motivo = acordo
    ? `Preço mantido da V${source.versionNumber} (condição aceita) ao duplicar a versão.`
    : `Preço mantido da V${source.versionNumber} (${QUOTE_STATUS_LABELS[source.status]}) ao duplicar a versão — referência, não acordo.`;
  /*
   * A validade vem junto enquanto ainda vale. Vencida, a versão nova nasce sem
   * ela: copiar um prazo que já passou deixaria enviar uma proposta vencida no
   * mesmo instante, que ninguém conseguiria aceitar — e o envio pede a nova.
   */
  const validade = source.validUntil && !venceuEm(source.validUntil, agora) ? source.validUntil : null;

  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, QUOTE_CODE_PREFIX);

  const created = await prisma.$transaction(async (tx) => {
    // Trava o projeto: número de versão e "um rascunho por projeto" são
    // decididos com ninguém mais criando versão ao mesmo tempo.
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${source.projectId} FOR UPDATE`;
    await rascunhoAberto(tx);

    const maxVersion = await tx.quoteVersion.aggregate({
      where: { projectId: source.projectId },
      _max: { versionNumber: true },
    });

    const quote = await tx.quoteVersion.create({
      data: {
        code,
        projectId: source.projectId,
        versionNumber: (maxVersion._max.versionNumber ?? 0) + 1,
        status: "DRAFT",
        quoteDate: agora,
        validUntil: validade,
        currencyCode: source.currencyCode,
        commercialNotes: source.commercialNotes,
        paymentTerms: source.paymentTerms,
        leadTimeDays: source.leadTimeDays,
        discountPercent: source.discountPercent,
        paymentMethod: source.paymentMethod,
        downPaymentPercent: source.downPaymentPercent,
        installmentCount: source.installmentCount,
        installmentIntervalDays: source.installmentIntervalDays,
        monthlyInterestPercent: source.monthlyInterestPercent,
        createdByUserId: actor.id,
        createdByNameSnapshot: actor.name,
      },
    });

    if (source.lines.length > 0) {
      await tx.quoteLine.createMany({
        data: source.lines.map((line) => {
          const preco = manter ? line.unitPrice : null;
          return {
            quoteVersionId: quote.id,
            projectProductId: line.projectProductId,
            productId: line.productId,
            sortOrder: line.sortOrder,
            quotedQuantity: line.quotedQuantity,
            uomCode: line.uomCode,
            // Nenhum vínculo com faixa: o preço mantido é o histórico, e a
            // precificação atual não é consultada.
            priceSource: "MANUAL" as const,
            ...(preco !== null
              ? {
                  unitPrice: preco,
                  priceOrigin: acordo ? ("INHERITED_AGREEMENT" as const) : ("MANUAL" as const),
                  inheritedFromQuoteLineId: acordo ? line.id : null,
                  priceOriginReason: motivo,
                }
              : {}),
          };
        }),
      });
    }

    return quote;
  });

  return (await getQuoteById(created.id)) as QuoteVersionDTO;
}

/**
 * Como ficaria o plano com estas condições, sem gravar nada.
 *
 * A conta continua sendo do backend — a tela desenha o resultado, nunca o
 * calcula. Sem isto, ver o efeito de um desconto exigia salvar primeiro: a
 * pessoa gravava para descobrir e depois gravava de novo para desfazer, e o
 * número na tela sempre descrevia a decisão anterior.
 *
 * O subtotal vem das LINHAS, não do que a tela mandou: aceitar um subtotal
 * de fora deixaria simular um desconto sobre um valor que a proposta não tem.
 */
export async function previewQuotePaymentSchedule(
  id: string,
  input: UpdateQuoteVersionInput,
): Promise<QuotePaymentScheduleDTO | null> {
  const quote = await requireQuoteWithLines(id);
  const atual = toQuoteVersionDTO(quote, false);
  if (atual.subtotal === null) return null;

  const decimal = (value: string | null | undefined, atualValue: string | null) => {
    if (value === undefined) return atualValue === null ? null : new Prisma.Decimal(atualValue);
    return value === null ? null : new Prisma.Decimal(value);
  };
  const inteiro = (value: number | null | undefined, atualValue: number | null) =>
    value === undefined ? atualValue : value;

  const method = input.paymentMethod ?? atual.paymentMethod;
  return buildPaymentSchedule({
    subtotal: new Prisma.Decimal(atual.subtotal),
    discountPercent: decimal(input.discountPercent, atual.discountPercent),
    method,
    // À vista não simula entrada nem parcela: mostrar o parcelamento que a
    // pessoa acabou de desligar contradiz a escolha na própria tela.
    downPaymentPercent:
      method === "CASH" ? null : decimal(input.downPaymentPercent, atual.downPaymentPercent),
    installmentCount:
      method === "CASH" ? null : inteiro(input.installmentCount, atual.installmentCount),
    installmentIntervalDays:
      method === "CASH"
        ? null
        : inteiro(input.installmentIntervalDays, atual.installmentIntervalDays),
    monthlyInterestPercent:
      method === "CASH"
        ? null
        : decimal(input.monthlyInterestPercent, atual.monthlyInterestPercent),
  });
}

export async function updateQuoteVersion(
  id: string,
  input: UpdateQuoteVersionInput,
): Promise<QuoteVersionDTO> {
  const quote = await requireQuoteWithLines(id);
  // Proposta apresentada é histórico: renegociar cria versão nova.
  if (quote.status !== "DRAFT") throw new QuoteNotDraftError(quote.status);

  await getPrisma().quoteVersion.update({
    where: { id },
    data: {
      ...(input.quoteDate !== undefined ? { quoteDate: input.quoteDate } : {}),
      ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
      ...(input.currencyCode !== undefined ? { currencyCode: input.currencyCode } : {}),
      ...(input.commercialNotes !== undefined ? { commercialNotes: input.commercialNotes } : {}),
      ...(input.paymentTerms !== undefined ? { paymentTerms: input.paymentTerms } : {}),
      ...(input.leadTimeDays !== undefined ? { leadTimeDays: input.leadTimeDays } : {}),
      ...(input.discountPercent !== undefined
        ? {
            discountPercent:
              input.discountPercent === null ? null : new Prisma.Decimal(input.discountPercent),
          }
        : {}),
      ...(input.paymentMethod !== undefined ? { paymentMethod: input.paymentMethod } : {}),
      /*
       * À vista não guarda entrada, parcelas nem juros. Deixar os números da
       * negociação anterior escondidos no registro faria o plano ressuscitar
       * sozinho na hora que alguém voltasse para "Parcelado".
       */
      ...(input.paymentMethod === "CASH"
        ? {
            downPaymentPercent: null,
            installmentCount: null,
            installmentIntervalDays: null,
            monthlyInterestPercent: null,
          }
        : {
            ...(input.downPaymentPercent !== undefined
              ? {
                  downPaymentPercent:
                    input.downPaymentPercent === null
                      ? null
                      : new Prisma.Decimal(input.downPaymentPercent),
                }
              : {}),
            ...(input.installmentCount !== undefined
              ? { installmentCount: input.installmentCount }
              : {}),
            ...(input.installmentIntervalDays !== undefined
              ? { installmentIntervalDays: input.installmentIntervalDays }
              : {}),
            ...(input.monthlyInterestPercent !== undefined
              ? {
                  monthlyInterestPercent:
                    input.monthlyInterestPercent === null
                      ? null
                      : new Prisma.Decimal(input.monthlyInterestPercent),
                }
              : {}),
          }),
    },
  });

  return (await getQuoteById(id)) as QuoteVersionDTO;
}

/**
 * Adiciona um produto à proposta.
 *
 * Só produto associado ao projeto entra: a proposta é da negociação, e um
 * produto de outro projeto na mesma proposta seria vínculo inventado.
 */
export async function addQuoteLine(
  quoteVersionId: string,
  input: { projectProductId: string },
): Promise<QuoteVersionDTO> {
  const prisma = getPrisma();
  const quote = await requireQuoteWithLines(quoteVersionId);
  if (quote.status !== "DRAFT") throw new QuoteNotDraftError(quote.status);

  const link = await prisma.projectProduct.findUnique({
    where: { id: input.projectProductId },
    include: { product: { select: { code: true } } },
  });
  if (!link || link.projectId !== quote.projectId) {
    throw new QuoteLineProductNotInProjectError(input.projectProductId);
  }
  if (quote.lines.some((line) => line.productId === link.productId)) {
    throw new QuoteLineDuplicateError(link.product.code);
  }

  /*
   * Num projeto já aprovado, a recompra negocia o ESCOPO APROVADO.
   *
   * A aprovação separou o que o cliente fechou (`APPROVED`) do que ficou em
   * desenvolvimento (`OUT_OF_SCOPE`). Deixar o produto fora do escopo entrar
   * numa proposta nova o traria de volta pela porta lateral — sem passar pela
   * aprovação que o excluiu. Antes da aprovação nada muda: `ACTIVE` é o estado
   * normal de quem ainda está sendo desenvolvido.
   */
  const projeto = await prisma.project.findUniqueOrThrow({
    where: { id: quote.projectId },
    select: { status: true },
  });
  if (projeto.status === "APPROVED" && link.status !== "APPROVED") {
    throw new ProjectProductNotInApprovedScopeError(link.product.code);
  }

  /*
   * A unidade vem do item de produto acabado.
   *
   * O sistema já sabe em que unidade aquele produto é vendido; pedir que a
   * pessoa digite de novo é atrito, e uma linha sem unidade só denuncia o
   * problema na hora de enviar. Produto sem item acabado continua sem
   * unidade — não se inventa uma.
   */
  const produto = await prisma.product.findUnique({
    where: { id: link.productId },
    include: { finishedProductItem: true },
  });
  const unidade = produto?.finishedProductItem?.unitCode ?? null;

  await prisma.quoteLine.create({
    data: {
      quoteVersionId,
      projectProductId: link.id,
      productId: link.productId,
      sortOrder: quote.lines.length + 1,
      priceSource: "MANUAL",
      ...(unidade ? { uomCode: unidade } : {}),
    },
  });

  return (await getQuoteById(quoteVersionId)) as QuoteVersionDTO;
}

/**
 * O valor informado é o gravado? Por VALOR, com `Decimal` — nunca texto nem
 * `Number` (§66): `1000` e `1000.000000000000` são a mesma quantidade.
 * Ausência só equivale a ausência.
 */
function mesmoDecimal(informado: string | null, gravado: Prisma.Decimal | null): boolean {
  if (informado === null || gravado === null) return informado === null && gravado === null;
  return new Prisma.Decimal(informado).equals(gravado);
}

/** Quantidade, unidade e preço da linha. */
export async function updateQuoteLine(
  lineId: string,
  input: UpdateQuoteLineInput,
): Promise<QuoteVersionDTO> {
  const prisma = getPrisma();
  const line = await prisma.quoteLine.findUnique({
    where: { id: lineId },
    include: { quoteVersion: true },
  });
  if (!line) throw new QuoteLineNotFoundError(lineId);
  if (line.quoteVersion.status !== "DRAFT") throw new QuoteNotDraftError(line.quoteVersion.status);
  /*
   * PRESENÇA de campo não é MUDANÇA de negócio (QUOTE-LINE-NOOP-BLUR-01).
   * Mandar a quantidade que já está gravada — um Tab por cima do campo, na
   * tela — soltava o preço herdado da linha, porque a limpeza de origem olhava
   * só para a chave no pedido. Cada campo é comparado com o gravado pelo
   * VALOR, e só o que mudou de verdade trava, limpa ou grava.
   */
  const { quotedQuantity, uomCode, unitPrice } = input;
  const quantidadeMudou =
    quotedQuantity !== undefined && !mesmoDecimal(quotedQuantity, line.quotedQuantity);
  const unidadeMudou = uomCode !== undefined && uomCode !== line.uomCode;
  const precoMudou = unitPrice !== undefined && !mesmoDecimal(unitPrice, line.unitPrice);

  // Nada mudou: a linha fica exatamente como está, e nem UPDATE acontece.
  if (!quantidadeMudou && !unidadeMudou && !precoMudou) {
    return (await getQuoteById(line.quoteVersionId)) as QuoteVersionDTO;
  }

  // Quantidade, unidade e preço pertencem à faixa enquanto houver vínculo — e
  // o que a trava recusa é MUDÁ-los.
  assertPriceEditable(line, {
    ...(quantidadeMudou ? { quotedQuantity } : {}),
    ...(unidadeMudou ? { uomCode } : {}),
    ...(precoMudou ? { unitPrice } : {}),
  });

  /*
   * Mudou a quantidade: a origem comercial precisa ser decidida de novo —
   * §74. Um preço vindo de um acordo de 10.000 un não descreve uma linha que
   * passou a 500 un, e deixar a proveniência ali seria fazê-la mentir. Ver
   * `limparOrigemPorQuantidade`: preço manual não é afetado.
   */
  const limpeza =
    quantidadeMudou || unidadeMudou ? limparOrigemPorQuantidade(line.priceOrigin) : {};

  /*
   * Preço digitado à mão É uma decisão comercial, e passa a constar como tal.
   * Sem isto, editar o valor de uma linha herdada deixaria `priceOrigin` em
   * `INHERITED_AGREEMENT` sobre um número que o acordo não tem. O MESMO valor
   * não é decisão nova, e a origem fica.
   *
   * O preço informado vem DEPOIS da limpeza de propósito: quem manda
   * quantidade e preço na mesma edição está dizendo os dois, e o explícito
   * ganha do implícito — se a limpeza acabou de apagar o preço, o informado
   * volta, mesmo igual ao que havia.
   */
  const digitouPreco = unitPrice !== undefined && (precoMudou || "unitPrice" in limpeza);

  const data: PrismaTypes.QuoteLineUncheckedUpdateInput = {
    ...limpeza,
    ...(quantidadeMudou ? { quotedQuantity } : {}),
    ...(unidadeMudou ? { uomCode } : {}),
    ...(digitouPreco
      ? {
          unitPrice,
          priceOrigin: "MANUAL" as const,
          inheritedFromQuoteLineId: null,
          adjustmentPercent: null,
          priceOriginReason: null,
        }
      : {}),
  };
  await prisma.quoteLine.update({ where: { id: lineId }, data });

  return (await getQuoteById(line.quoteVersionId)) as QuoteVersionDTO;
}

/** Remover linha só em rascunho: proposta enviada é história. */
export async function removeQuoteLine(lineId: string): Promise<QuoteVersionDTO> {
  const prisma = getPrisma();
  const line = await prisma.quoteLine.findUnique({
    where: { id: lineId },
    include: { quoteVersion: true },
  });
  if (!line) throw new QuoteLineNotFoundError(lineId);
  if (line.quoteVersion.status !== "DRAFT") throw new QuoteNotDraftError(line.quoteVersion.status);

  await prisma.quoteLine.delete({ where: { id: lineId } });
  return (await getQuoteById(line.quoteVersionId)) as QuoteVersionDTO;
}

/**
 * Marca como apresentado ao cliente. NÃO envia e-mail: registra o fato
 * comercial e congela o snapshot que a impressão vai usar para sempre.
 */
export async function sendQuoteVersion(
  id: string,
  actor: User,
  options: { confirmIncompleteCost?: boolean | undefined } = {},
): Promise<QuoteVersionDTO> {
  const prisma = getPrisma();
  const quote = await prisma.quoteVersion.findUnique({
    where: { id },
    include: { project: { include: { customer: true } }, lines: true },
  });
  if (!quote) throw new QuoteNotFoundError(id);
  if (quote.status !== "DRAFT") throw new QuoteNotDraftError(quote.status);
  /*
   * Rascunho pode não ter validade — é trabalho em andamento. O documento que
   * vai ao cliente, não: o preço nele foi calculado sobre o custo de uma data,
   * e uma oferta sem prazo é uma oferta que nunca vence.
   */
  if (!quote.validUntil) throw new QuoteWithoutValidUntilError();
  // Proposta sem produto não é proposta; e linha sem quantidade, unidade ou
  // preço não pode virar documento do cliente.
  if (quote.lines.length === 0) throw new IncompleteQuoteError();
  if (
    quote.lines.some((line) => !line.quotedQuantity || !line.uomCode || line.unitPrice === null)
  ) {
    throw new IncompleteQuoteError();
  }

  const { project } = quote;

  // Custo industrial incompleto pode virar proposta — mas nunca por
  // acidente; e o que for enviado fica congelado aqui, LINHA A LINHA: cada
  // produto tem a própria cadeia PREC → CALC → EC → fórmula.
  const lineSnapshots = await buildLineSnapshots(quote.lines, options);

  const updated = await prisma.quoteVersion.update({
    where: { id },
    data: {
      status: "SENT",
      sentAt: new Date(),
      sentByUserId: actor.id,
      sentByNameSnapshot: actor.name,
      // O mesmo cadastro que o rascunho mostrava — agora congelado.
      ...cadastroDaProposta(project),
    } as PrismaTypes.QuoteVersionUpdateInput,
  });

  for (const [lineId, data] of lineSnapshots) {
    await prisma.quoteLine.update({ where: { id: lineId }, data });
  }

  return (await getQuoteById(updated.id)) as QuoteVersionDTO;
}

/**
 * Registro operacional de que o cliente aceitou aquela versão. Não é
 * assinatura eletrônica.
 */
export async function acceptQuoteVersion(id: string, actor: User): Promise<QuoteVersionDTO> {
  const prisma = getPrisma();
  const quote = await prisma.quoteVersion.findUnique({ where: { id } });
  if (!quote) throw new QuoteNotFoundError(id);
  if (quote.status !== "SENT") throw new QuoteNotSentError(quote.status);
  /*
   * A validade controla a janela de ACEITE, e só ela. Depois de aceita, a
   * proposta virou acordo: o Pedido pode ser materializado semanas depois sem
   * que o preço mude — ver `createOrderFromAcceptedQuote`, que não olha
   * `validUntil`.
   */
  if (venceuEm(quote.validUntil, new Date())) {
    throw new QuoteExpiredError(diaComercialPorExtenso(quote.validUntil!));
  }

  const updated = await prisma.$transaction(async (tx) => {
    /*
     * O invariante "uma aceita por projeto" caiu com o ciclo único.
     *
     * Enquanto um projeto tinha uma negociação só, toda aceita anterior era
     * uma versão superada da MESMA proposta. Com recompra no mesmo projeto,
     * V1 aceita em janeiro (que virou PED-001) e V2 aceita em março (que vai
     * virar PED-002) são dois acordos diferentes, e os dois valeram. Segue
     * caindo o que ainda não virou Pedido: oferta em aberto substituída pela
     * versão nova.
     */
    const aceitas = await tx.quoteVersion.findMany({
      where: { projectId: quote.projectId, status: "ACCEPTED", id: { not: id } },
      select: { id: true },
    });
    for (const aceita of aceitas) {
      if (await superseder(tx, aceita.id, "ACCEPTED")) {
        await tx.quoteVersion.update({ where: { id: aceita.id }, data: { status: "SUPERSEDED" } });
      }
    }

    return tx.quoteVersion.update({
      where: { id },
      data: {
        status: "ACCEPTED",
        acceptedAt: new Date(),
        acceptedByUserId: actor.id,
        acceptedByNameSnapshot: actor.name,
      },
    });
  });

  return (await getQuoteById(updated.id)) as QuoteVersionDTO;
}

/** Recusar não cancela o projeto: outra versão pode ser negociada. */
export async function rejectQuoteVersion(
  id: string,
  input: RejectQuoteInput,
  actor: User,
): Promise<QuoteVersionDTO> {
  const prisma = getPrisma();
  const quote = await prisma.quoteVersion.findUnique({ where: { id } });
  if (!quote) throw new QuoteNotFoundError(id);
  if (quote.status !== "SENT") throw new QuoteNotSentError(quote.status);

  const updated = await prisma.quoteVersion.update({
    where: { id },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectedByUserId: actor.id,
      rejectedByNameSnapshot: actor.name,
      ...(input.reason ? { rejectionReason: input.reason } : {}),
    },
  });

  return (await getQuoteById(updated.id)) as QuoteVersionDTO;
}

/** Recarrega o projeto — as ações de orçamento mudam o resumo do projeto. */
export async function getProjectAfterQuoteChange(projectId: string) {
  return getProjectById(projectId);
}

export { Prisma as QuotePrisma };
