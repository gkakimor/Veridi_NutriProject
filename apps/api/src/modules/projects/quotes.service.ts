import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, User } from "@prisma/client";
import type {
  QuoteLineDTO,
  QuotePaymentScheduleDTO,
  QuotePricingProvenanceDTO,
  QuoteVersionDTO,
} from "@veridi/shared";
import { QUOTE_CODE_PREFIX, calcularTotaisOrcamento } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import {
  IncompleteQuoteError,
  ProjectLockedError,
  ProjectNotFoundError,
  QuoteLineDuplicateError,
  QuoteLineNotFoundError,
  QuoteLineProductNotInProjectError,
  QuoteNotDraftError,
  QuoteNotFoundError,
  QuoteNotSentError,
} from "./projects.errors.js";
import { getProjectById } from "./projects.service.js";
import { buildPaymentSchedule } from "./quote-payment.js";
import {
  assertPriceEditable,
  buildLineSnapshots,
  linePricingInclude,
  pricingProvenanceForLine,
} from "./quote-pricing.service.js";
import type { RejectQuoteInput, UpdateQuoteVersionInput } from "./projects.schemas.js";

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
export const quoteInclude = {
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
    customerCode: quote.customerCode,
    customerName: quote.customerName,
    customerTradeName: quote.customerTradeName,
    customerCnpj: quote.customerCnpj,
    customerZipCode: quote.customerZipCode,
    customerStreet: quote.customerStreet,
    customerNumber: quote.customerNumber,
    customerComplement: quote.customerComplement,
    customerDistrict: quote.customerDistrict,
    customerCity: quote.customerCity,
    customerState: quote.customerState,
    projectCode: quote.projectCode,
    projectName: quote.projectName,
    projectConcept: quote.projectConcept,
    projectChannel: quote.projectChannel,
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
  if (project.status === "APPROVED" || project.status === "CANCELLED") {
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

    // As linhas da versão anterior vêm junto: quantidade, unidade e preço como
    // ponto de partida. O VÍNCULO com a precificação não é herdado — cada
    // proposta confirma a própria base econômica, então a linha nova nasce
    // MANUAL até alguém reaplicar a faixa. Herdar a proveniência afirmaria que
    // este preço veio de um cálculo que ninguém conferiu.
    if (previous) {
      const previousLines = await tx.quoteLine.findMany({
        where: { quoteVersionId: previous.id },
        orderBy: { sortOrder: "asc" },
      });
      for (const line of previousLines) {
        await tx.quoteLine.create({
          data: {
            quoteVersionId: quote.id,
            projectProductId: line.projectProductId,
            productId: line.productId,
            sortOrder: line.sortOrder,
            quotedQuantity: line.quotedQuantity,
            uomCode: line.uomCode,
            unitPrice: line.unitPrice,
            priceSource: "MANUAL",
          },
        });
      }
    }

    // A versão anterior formalmente apresentada passa a ser histórico.
    // Recusada e arquivada permanecem como estão.
    if (previous && (previous.status === "SENT" || previous.status === "ACCEPTED")) {
      await tx.quoteVersion.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
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

/** Quantidade, unidade e preço da linha. */
export async function updateQuoteLine(
  lineId: string,
  input: { quotedQuantity?: unknown; uomCode?: unknown; unitPrice?: unknown },
): Promise<QuoteVersionDTO> {
  const prisma = getPrisma();
  const line = await prisma.quoteLine.findUnique({
    where: { id: lineId },
    include: { quoteVersion: true },
  });
  if (!line) throw new QuoteLineNotFoundError(lineId);
  if (line.quoteVersion.status !== "DRAFT") throw new QuoteNotDraftError(line.quoteVersion.status);
  // Quantidade, unidade e preço pertencem à faixa enquanto houver vínculo.
  assertPriceEditable(line, input);

  await prisma.quoteLine.update({
    where: { id: lineId },
    data: {
      ...(input.quotedQuantity !== undefined
        ? { quotedQuantity: input.quotedQuantity as never }
        : {}),
      ...(input.uomCode !== undefined ? { uomCode: input.uomCode as never } : {}),
      ...(input.unitPrice !== undefined ? { unitPrice: input.unitPrice as never } : {}),
    },
  });

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
  // Proposta sem produto não é proposta; e linha sem quantidade, unidade ou
  // preço não pode virar documento do cliente.
  if (quote.lines.length === 0) throw new IncompleteQuoteError();
  if (
    quote.lines.some((line) => !line.quotedQuantity || !line.uomCode || line.unitPrice === null)
  ) {
    throw new IncompleteQuoteError();
  }

  const { project } = quote;
  const { customer } = project;

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

  const updated = await prisma.$transaction(async (tx) => {
    // No máximo uma versão aceita vigente por projeto.
    await tx.quoteVersion.updateMany({
      where: { projectId: quote.projectId, status: "ACCEPTED", id: { not: id } },
      data: { status: "SUPERSEDED" },
    });

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
