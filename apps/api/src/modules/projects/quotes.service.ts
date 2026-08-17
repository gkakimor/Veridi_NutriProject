import { Prisma } from "@prisma/client";
import type { Prisma as PrismaTypes, QuoteVersion, User } from "@prisma/client";
import type { QuotePricingProvenanceDTO, QuoteVersionDTO } from "@veridi/shared";
import { QUOTE_CODE_PREFIX } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import {
  IncompleteQuoteError,
  ProjectLockedError,
  ProjectNotFoundError,
  QuoteNotDraftError,
  QuoteNotFoundError,
  QuoteNotSentError,
} from "./projects.errors.js";
import { getProjectById } from "./projects.service.js";
import { assertPriceEditable, buildPricingSnapshotData } from "./quote-pricing.service.js";
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
export function toQuoteVersionDTO(
  quote: QuoteVersion,
  pricing: QuotePricingProvenanceDTO | null = null,
): QuoteVersionDTO {
  // Total é derivado; só existe quando quantidade E preço existem. Preço
  // `null` (não precificado) nunca vira zero.
  const total =
    quote.quotedQuantity && quote.unitPrice
      ? quote.quotedQuantity.times(quote.unitPrice).toFixed(2)
      : null;

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
    quotedQuantity: quote.quotedQuantity ? quote.quotedQuantity.toString() : null,
    uomCode: quote.uomCode,
    unitPrice: quote.unitPrice ? quote.unitPrice.toFixed(4) : null,
    currencyCode: quote.currencyCode,
    total,
    commercialNotes: quote.commercialNotes,
    paymentTerms: quote.paymentTerms,
    leadTimeDays: quote.leadTimeDays,
    priceSource: quote.priceSource,
    pricing,
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

export async function getQuoteById(id: string): Promise<QuoteVersionDTO | null> {
  const quote = await getPrisma().quoteVersion.findUnique({ where: { id } });
  return quote ? toQuoteVersionDTO(quote) : null;
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
  if (existingDraft) return toQuoteVersionDTO(existingDraft);

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
        // Valores comerciais servem de ponto de partida; o VÍNCULO com a
        // precificação não é herdado — cada proposta confirma sua própria
        // base econômica.
        ...(previous
          ? {
              quotedQuantity: previous.quotedQuantity,
              uomCode: previous.uomCode,
              unitPrice: previous.unitPrice,
              currencyCode: previous.currencyCode,
              commercialNotes: previous.commercialNotes,
              paymentTerms: previous.paymentTerms,
              leadTimeDays: previous.leadTimeDays,
            }
          : {}),
        createdByUserId: actor.id,
        createdByNameSnapshot: actor.name,
      },
    });

    // A versão anterior formalmente apresentada passa a ser histórico.
    // Recusada e arquivada permanecem como estão.
    if (previous && (previous.status === "SENT" || previous.status === "ACCEPTED")) {
      await tx.quoteVersion.update({ where: { id: previous.id }, data: { status: "SUPERSEDED" } });
    }

    return quote;
  });

  return toQuoteVersionDTO(created);
}

export async function updateQuoteVersion(
  id: string,
  input: UpdateQuoteVersionInput,
): Promise<QuoteVersionDTO> {
  const quote = await getPrisma().quoteVersion.findUnique({ where: { id } });
  if (!quote) throw new QuoteNotFoundError(id);
  // Proposta apresentada é histórico: renegociar cria versão nova.
  if (quote.status !== "DRAFT") throw new QuoteNotDraftError(quote.status);
  // Quantidade, unidade e preço pertencem à faixa enquanto houver vínculo.
  assertPriceEditable(quote, input);

  const updated = await getPrisma().quoteVersion.update({
    where: { id },
    data: {
      ...(input.quoteDate !== undefined ? { quoteDate: input.quoteDate } : {}),
      ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
      ...(input.quotedQuantity !== undefined ? { quotedQuantity: input.quotedQuantity } : {}),
      ...(input.uomCode !== undefined ? { uomCode: input.uomCode } : {}),
      ...(input.unitPrice !== undefined ? { unitPrice: input.unitPrice } : {}),
      ...(input.currencyCode !== undefined ? { currencyCode: input.currencyCode } : {}),
      ...(input.commercialNotes !== undefined ? { commercialNotes: input.commercialNotes } : {}),
      ...(input.paymentTerms !== undefined ? { paymentTerms: input.paymentTerms } : {}),
      ...(input.leadTimeDays !== undefined ? { leadTimeDays: input.leadTimeDays } : {}),
    },
  });

  return toQuoteVersionDTO(updated);
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
    include: { project: { include: { customer: true } } },
  });
  if (!quote) throw new QuoteNotFoundError(id);
  if (quote.status !== "DRAFT") throw new QuoteNotDraftError(quote.status);
  if (!quote.quotedQuantity || !quote.uomCode || quote.unitPrice === null) {
    throw new IncompleteQuoteError();
  }

  const { project } = quote;
  const { customer } = project;

  // Custo industrial incompleto pode virar proposta — mas nunca por
  // acidente; e o que for enviado fica congelado aqui.
  const pricingSnapshot = await buildPricingSnapshotData(id, options);

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
      ...pricingSnapshot,
    } as PrismaTypes.QuoteVersionUpdateInput,
  });

  return toQuoteVersionDTO(updated);
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

  return toQuoteVersionDTO(updated);
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

  return toQuoteVersionDTO(updated);
}

/** Recarrega o projeto — as ações de orçamento mudam o resumo do projeto. */
export async function getProjectAfterQuoteChange(projectId: string) {
  return getProjectById(projectId);
}

export { Prisma as QuotePrisma };
