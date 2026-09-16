import { z } from "zod";
import type { QuoteStatus } from "@veridi/shared";
import { QUOTE_DUPLICATE_PRICE_STRATEGIES, QUOTE_STATUSES } from "@veridi/shared";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import {
  diaCivilDeFiltroSchema,
  recusarPeriodoInvertido,
  requiredDateSchema,
} from "../../lib/date-schema.js";
import { CASAS_PRECO_COMERCIAL, optionalDecimalStringSchema } from "../../lib/decimal-schema.js";
import { inteiroDeConsultaSchema } from "../../lib/integer-schema.js";
import {
  camposDoParcelamento,
  optionalPercent,
  optionalPositiveInt,
  paymentInstrumentSchema,
} from "../../lib/payment-condition-schema.js";
import { listaDeStatusSchema } from "../../lib/status-list-schema.js";

const statusEnum = z.enum(["WAITING", "SAMPLE", "APPROVED", "CANCELLED", "STAND_BY"]);
const cancelReasonEnum = z.enum(["PRICE", "COMPETITOR", "PROJECT_CHANGED", "NOT_MET", "OTHER"]);

/**
 * Decimal opcional — a implementação compartilhada, não uma cópia local.
 *
 * A versão que morava aqui não aceitava vírgula e recusava com "Valor
 * inválido (não pode ser negativo)", mensagem que descreve outro defeito.
 */
const optionalDecimal = optionalDecimalStringSchema();

/**
 * Preço unitário COMERCIAL da linha do Orçamento — até quatro casas.
 *
 * `PRODUCT_RULES.md` §58 e §60. `QuoteLine.unitPrice` é `DECIMAL(14,4)` por
 * decisão comercial: é o preço do documento, e o valor do documento assinado é
 * o valor do documento. Antes deste teto, digitar `4,05318` fazia o PostgreSQL
 * gravar `4,0532` sem dizer que trocou o número — exatamente o defeito que a
 * fundação numérica existe para eliminar, do lado comercial.
 *
 * A precificação técnica continua com oito casas; o fechamento para quatro é
 * feito pelo domínio, em `fecharPrecoUnitarioComercial`, não pelo operador nem
 * pelo banco.
 */
const precoComercial = optionalDecimalStringSchema({ maxDecimals: CASAS_PRECO_COMERCIAL });

/**
 * Conceito e canal são vocabulário ABERTO: texto livre com sugestão pelos
 * valores já usados. Nunca enum — o vocabulário do negócio evolui.
 */
const projectBaseFields = {
  name: z.string().trim().min(3, "Nome do projeto é obrigatório").max(200),
  concept: optionalNullableText(120),
  channel: optionalNullableText(120),
  externalCode: optionalNullableText(40),
  responsibleUserId: z.string().trim().min(1).nullish(),
  entryDate: requiredDateSchema.optional(),
  notes: optionalNullableText(2000),
  dosageForm: z.enum(["CAPSULE", "POWDER", "TABLET", "LIQUID", "OTHER"]).nullish(),
  presentationType: z.enum(["POT", "POUCH", "CARTON", "BULK", "BOTTLE", "OTHER"]).nullish(),
  doseAmount: optionalDecimal,
  doseUomCode: optionalNullableText(20),
  dosesPerPackage: optionalPositiveInt,
  targetAgeGroup: z.enum(["ADULT", "CHILD", "PREGNANT", "LACTATING", "OTHER"]).nullish(),
  minimumBatchQuantity: optionalDecimal,
  shelfLifeMonths: optionalPositiveInt,
};

export const createProjectSchema = z.object({
  customerId: z.string().trim().min(1, "Cliente é obrigatório"),
  ...projectBaseFields,
});

export const updateProjectSchema = z.object({
  customerId: z.string().trim().min(1).optional(),
  ...projectBaseFields,
  name: projectBaseFields.name.optional(),
});

export const changeProjectStatusSchema = z.object({
  status: statusEnum,
  reason: z.string().trim().max(500).optional(),
});

export const cancelProjectSchema = z.object({
  cancelReason: cancelReasonEnum,
  cancelReasonDetails: z.string().trim().max(1000).optional(),
});

export const approveProjectSchema = z.object({
  finishedUnitCode: z.string().trim().min(1).optional(),
});

export const listProjectsQuerySchema = z
  .object({
    search: z.string().trim().min(1).optional(),
    customerId: z.string().trim().min(1).optional(),
    status: statusEnum.optional(),
    channel: z.string().trim().min(1).optional(),
    concept: z.string().trim().min(1).optional(),
    responsibleUserId: z.string().trim().min(1).optional(),
    entryFrom: requiredDateSchema.optional(),
    entryTo: requiredDateSchema.optional(),
    page: inteiroDeConsultaSchema({ minimo: 1, padrao: 1 }),
    pageSize: inteiroDeConsultaSchema({ minimo: 1, maximo: 100, padrao: 20 }),
  })
  .superRefine(recusarPeriodoInvertido("entryFrom", "entryTo"));

/**
 * Lista geral de Orçamentos — QUOTES-HUB-01. Uma linha por VERSÃO, de todos os
 * projetos.
 *
 * Os contratos das listas de sempre: status um ou vários separados por vírgula
 * (a tela abre em "Em aberto", Rascunho + Enviado, numa consulta só), período
 * em dia civil `YYYY-MM-DD` com a recusa do invertido, e página e tamanho
 * inteiros decimais estritos.
 */
export const listQuoteVersionsQuerySchema = z
  .object({
    search: z.string().trim().min(1).optional(),
    customerId: z.string().trim().min(1).optional(),
    projectId: z.string().trim().min(1).optional(),
    status: listaDeStatusSchema(
      z.enum(QUOTE_STATUSES as unknown as [QuoteStatus, ...QuoteStatus[]]),
    ).optional(),
    /** Data do orçamento — a mesma que a lista e a página da versão mostram. */
    dateFrom: diaCivilDeFiltroSchema,
    dateTo: diaCivilDeFiltroSchema,
    page: inteiroDeConsultaSchema({ minimo: 1, padrao: 1 }),
    pageSize: inteiroDeConsultaSchema({ minimo: 1, maximo: 100, padrao: 20 }),
  })
  .superRefine(recusarPeriodoInvertido("dateFrom", "dateTo"));

/**
 * Cabeçalho da proposta: condições comerciais. Preço vive na linha.
 *
 * Entrada, parcelas, intervalo e juros saem de `payment-condition-schema.ts`,
 * os mesmos campos do pagamento padrão do Cliente. "Parcelado sem parcelas"
 * depende do que está gravado e é recusado no service.
 */
export const updateQuoteVersionSchema = z.object({
  quoteDate: requiredDateSchema.optional(),
  validUntil: requiredDateSchema.nullish(),
  currencyCode: z.string().trim().length(3).optional(),
  commercialNotes: optionalNullableText(2000),
  paymentTerms: optionalNullableText(500),
  leadTimeDays: optionalPositiveInt,
  discountPercent: optionalPercent(99.99),
  paymentMethod: z.enum(["CASH", "INSTALLMENTS"]).optional(),
  ...camposDoParcelamento,
  // Forma de pagamento: ausente não mexe, `null` limpa.
  paymentInstrument: paymentInstrumentSchema.nullable().optional(),
});

/** Só produto já associado ao projeto entra na proposta. */
export const addQuoteLineSchema = z.object({
  projectProductId: z.string().trim().min(1),
});

export const updateQuoteLineSchema = z.object({
  quotedQuantity: optionalDecimal,
  uomCode: optionalNullableText(20),
  // Preço `null` = ainda não precificado; `0` é preço zero explícito.
  unitPrice: precoComercial,
});

/**
 * Produto do projeto: cria um novo ou vincula um existente.
 *
 * São as duas formas legítimas — e nenhuma delas é "digitar um nome e
 * deixar o resto para depois": produto tem ciclo de vida e regras.
 */
export const addProjectProductSchema = z.union([
  z.object({
    operation: z.literal("create"),
    name: z.string().trim().min(1).max(200).optional(),
    finishedUnitCode: z.string().trim().min(1).optional(),
  }),
  z.object({
    operation: z.literal("link"),
    productId: z.string().trim().min(1),
  }),
]);

export const rejectQuoteSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

/**
 * Duplicar como nova versão — QUOTE-DUPLICATE-01, §85.
 *
 * A estratégia de preço é OBRIGATÓRIA e não tem padrão: ausente, nula ou
 * desconhecida é 400 antes de qualquer escrita. Um default aqui seria a
 * herança silenciosa de volta, só que no servidor.
 */
export const duplicateQuoteVersionSchema = z.object({
  priceStrategy: z.enum(QUOTE_DUPLICATE_PRICE_STRATEGIES, {
    errorMap: () => ({
      message:
        'Escolha como tratar os preços: "Manter os preços desta versão" ou "Revisar os preços".',
    }),
  }),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ChangeProjectStatusInput = z.infer<typeof changeProjectStatusSchema>;
export type CancelProjectInput = z.infer<typeof cancelProjectSchema>;
export type ApproveProjectInput = z.infer<typeof approveProjectSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
export type ListQuoteVersionsQuery = z.infer<typeof listQuoteVersionsQuerySchema>;
export type UpdateQuoteVersionInput = z.infer<typeof updateQuoteVersionSchema>;
export type AddQuoteLineInput = z.infer<typeof addQuoteLineSchema>;
export type UpdateQuoteLineInput = z.infer<typeof updateQuoteLineSchema>;
export type AddProjectProductInput = z.infer<typeof addProjectProductSchema>;
export type RejectQuoteInput = z.infer<typeof rejectQuoteSchema>;

/** Unidade do produto acabado: exigida quando o brief não a define. */
export const prepareTechnicalProductSchema = z.object({
  finishedUnitCode: z.string().trim().min(1).optional(),
});

export const applyQuotePricingSchema = z.object({
  pricingTierId: z.string().trim().min(1, "Selecione a faixa de precificação"),
});

/**
 * Manter a condição comercial anterior nesta linha.
 *
 * O `sourceQuoteLineId` é conferido no servidor — mesmo Projeto, mesmo
 * Produto, proposta ACEITA e com preço. O `reason` só é exigido quando a
 * quantidade difere ou a condição venceu, e quem decide isso é o domínio.
 */
export const inheritQuoteLinePriceSchema = z.object({
  sourceQuoteLineId: z.string().trim().min(1, "Selecione a condição anterior"),
  reason: z.string().trim().min(1).optional(),
});

/**
 * Reajustar a condição anterior por um percentual.
 *
 * O percentual chega como texto e o SERVIDOR fecha o preço: a tela mostra
 * prévia, nunca autoridade. O sinal é aceito aqui de propósito — recusar no
 * schema devolveria "valor decimal inválido", e a regra tem nome: reajuste não
 * abaixa preço, e o domínio explica o que usar no lugar.
 */
export const adjustQuoteLinePriceSchema = z.object({
  sourceQuoteLineId: z.string().trim().min(1, "Selecione a condição anterior"),
  adjustmentPercent: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim().replace(",", "."))
    .refine((value) => /^-?\d+(\.\d+)?$/.test(value), {
      message: "Percentual de reajuste inválido.",
    })
    .refine((value) => Math.abs(Number(value)) <= 9999, {
      message: "Percentual de reajuste fora da faixa aceita.",
    }),
  reason: z.string().trim().min(1).optional(),
});

export const sendQuoteVersionSchema = z.object({
  /** Proposta com custo industrial incompleto é decisão explícita. */
  confirmIncompleteCost: z.boolean().optional(),
});

export type PrepareTechnicalProductInput = z.infer<typeof prepareTechnicalProductSchema>;
export type ApplyQuotePricingInput = z.infer<typeof applyQuotePricingSchema>;
export type InheritQuoteLinePriceInput = z.infer<typeof inheritQuoteLinePriceSchema>;
export type AdjustQuoteLinePriceInput = z.infer<typeof adjustQuoteLinePriceSchema>;
export type SendQuoteVersionInput = z.infer<typeof sendQuoteVersionSchema>;
