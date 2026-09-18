import { z } from "zod";
import { inteiroDeConsultaSchema } from "../../lib/integer-schema.js";
import {
  BR_STATE_CODES,
  CNAE_CODE_PATTERN,
  CNPJ_ESTABLISHMENT_TYPES,
  CNPJ_REGISTRATION_TEXT_MAX_LENGTHS,
  CUSTOMER_COMMERCIAL_STATUSES,
  CUSTOMER_FIELD_MAX_LENGTHS,
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_REASON_MAX_LENGTH,
  CUSTOMER_TAX_PROFILES,
  ehDiaCivil,
} from "@veridi/shared";
import {
  optionalCnpjSchema,
  optionalNullableText,
  requiredCnpjSchema,
} from "../../lib/cnpj-schema.js";
import { optionalBrPhoneSchema, optionalEmailSchema } from "../../lib/contact-schema.js";
import { optionalZipCode } from "../../lib/industrial-schema.js";
import {
  camposDoParcelamento,
  paymentInstrumentSchema,
  paymentMethodSchema,
} from "../../lib/payment-condition-schema.js";

const optionalStateSchema = z
  .string()
  .trim()
  .max(2)
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return value.length === 0 ? null : value.toUpperCase();
  })
  .refine(
    (value) =>
      value === undefined ||
      value === null ||
      (BR_STATE_CODES as readonly string[]).includes(value),
    { message: "UF inválida" },
  );

/**
 * Perfil tributário (§83): só os valores do enum. Ausente não mexe no PATCH e
 * vira `NOT_INFORMED` no POST, pelo default do banco. `null` é recusado com
 * a mesma mensagem — não existe "limpar": retirar a classificação é escolher
 * `NOT_INFORMED`. Valor desconhecido para aqui, em 400, antes do Prisma.
 */
const optionalTaxProfileSchema = z
  .enum(CUSTOMER_TAX_PROFILES, {
    errorMap: () => ({ message: "Perfil tributário inválido" }),
  })
  .optional();

/**
 * Situação cadastral (§95), uma ou mais, separadas por vírgula. Valor
 * desconhecido é 400 — filtro que o servidor não entende nunca vira "todos"
 * em silêncio.
 */
const optionalStatusListSchema = z
  .string()
  .trim()
  .min(1)
  .optional()
  .transform((value) =>
    value
      ? value
          .split(",")
          .map((parte) => parte.trim())
          .filter(Boolean)
      : undefined,
  )
  .pipe(
    z
      .array(
        z.enum(CUSTOMER_STATUSES, {
          errorMap: () => ({ message: "Situação cadastral inválida" }),
        }),
      )
      .min(1, "Situação cadastral inválida")
      .optional(),
  );

/**
 * Pagamento padrão — CUSTOMER-PAYMENT-DEFAULTS-01. Tudo opcional: ausente não
 * mexe, `null` limpa. Os campos do parcelamento são os MESMOS das condições do
 * Orçamento, com os mesmos limites e mensagens. A regra que depende do que está
 * gravado — condição à vista ou não informada limpa o parcelamento, parcelado
 * exige parcelas — é do service.
 */
const pagamentoPadraoFields = {
  defaultPaymentInstrument: paymentInstrumentSchema.nullable().optional(),
  defaultPaymentMethod: paymentMethodSchema.nullable().optional(),
  defaultDownPaymentPercent: camposDoParcelamento.downPaymentPercent,
  defaultInstallmentCount: camposDoParcelamento.installmentCount,
  defaultInstallmentIntervalDays: camposDoParcelamento.installmentIntervalDays,
  defaultMonthlyInterestPercent: camposDoParcelamento.monthlyInterestPercent,
};

/** Texto cadastral do CNPJ: vazio é "não informado"; acima do teto do cadastro é recusa. */
function textoCadastralDoCnpj(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((valor) => (valor === null || valor === "" ? null : valor));
}

/** Dia civil `YYYY-MM-DD` existente — nunca um instante com hora que ninguém escolheu. */
const diaCivilCadastralDoCnpj = z
  .string()
  .trim()
  .nullable()
  .refine((valor) => valor === null || valor === "" || ehDiaCivil(valor), {
    message: "Data inválida (use AAAA-MM-DD)",
  })
  .transform((valor) => (valor === null || valor === "" ? null : valor));

/** Simples e MEI: Sim (`true`), Não (`false`) ou não informado (`null`) — nunca texto. */
const simOuNaoCadastral = z
  .boolean({ invalid_type_error: "Use Sim, Não ou não informado" })
  .nullable();

/**
 * Folga para o relógio: o `consultedAt` é carimbado pela própria API na
 * consulta e chega aqui minutos depois, nunca antes.
 */
const FOLGA_DO_RELOGIO_MS = 60_000;

/**
 * Dados cadastrais do CNPJ — CUSTOMER-CNPJ-PERSISTED-DATA-01, §119.
 *
 * Um BLOCO, e inteiro: toda chave é obrigatória (com `null` para "não
 * informado"), porque o bloco troca o anterior de uma vez — chave ausente
 * seria ambígua entre "não mexe" e "a fonte não informou". Chave desconhecida
 * (payload cru do provedor, por exemplo) é descartada e não chega ao banco.
 *
 * O `cnpj` é o número CONSULTADO. Se ele é o do Cliente é pergunta do service,
 * que conhece o CNPJ gravado.
 */
const cnpjRegistrationSchema = z.object({
  cnpj: requiredCnpjSchema,
  mainCnaeCode: z
    .string()
    .trim()
    .nullable()
    .refine((valor) => valor === null || valor === "" || CNAE_CODE_PATTERN.test(valor), {
      message: "CNAE principal deve ter 7 dígitos",
    })
    .transform((valor) => (valor === null || valor === "" ? null : valor)),
  mainCnaeDescription: textoCadastralDoCnpj(CNPJ_REGISTRATION_TEXT_MAX_LENGTHS.mainCnaeDescription),
  legalNature: textoCadastralDoCnpj(CNPJ_REGISTRATION_TEXT_MAX_LENGTHS.legalNature),
  companySize: textoCadastralDoCnpj(CNPJ_REGISTRATION_TEXT_MAX_LENGTHS.companySize),
  openedAt: diaCivilCadastralDoCnpj,
  establishmentType: z
    .enum(CNPJ_ESTABLISHMENT_TYPES, { errorMap: () => ({ message: "Matriz/Filial inválido" }) })
    .nullable(),
  simplesOptIn: simOuNaoCadastral,
  meiOptIn: simOuNaoCadastral,
  registrationStatus: textoCadastralDoCnpj(CNPJ_REGISTRATION_TEXT_MAX_LENGTHS.registrationStatus),
  registrationStatusDate: diaCivilCadastralDoCnpj,
  consultedAt: z
    .string({
      required_error: "Data da consulta é obrigatória",
      invalid_type_error: "Data da consulta é obrigatória",
    })
    .datetime({ offset: true, message: "Data da consulta inválida" })
    .refine((valor) => Date.parse(valor) <= Date.now() + FOLGA_DO_RELOGIO_MS, {
      message: "Data da consulta no futuro",
    }),
});

/** Objeto troca o bloco inteiro, `null` limpa, ausente não mexe (salvo troca de CNPJ, no service). */
const cnpjRegistrationField = cnpjRegistrationSchema.nullable().optional();

export const createCustomerSchema = z.object({
  legalName: z
    .string()
    .trim()
    .min(1, "Razão social é obrigatória")
    .max(CUSTOMER_FIELD_MAX_LENGTHS.legalName),
  tradeName: optionalNullableText(CUSTOMER_FIELD_MAX_LENGTHS.tradeName),
  cnpj: optionalCnpjSchema,
  email: optionalEmailSchema,
  phone: optionalBrPhoneSchema,
  taxProfile: optionalTaxProfileSchema,
  cnpjRegistration: cnpjRegistrationField,
  street: optionalNullableText(CUSTOMER_FIELD_MAX_LENGTHS.street),
  number: optionalNullableText(CUSTOMER_FIELD_MAX_LENGTHS.number),
  complement: optionalNullableText(CUSTOMER_FIELD_MAX_LENGTHS.complement),
  district: optionalNullableText(CUSTOMER_FIELD_MAX_LENGTHS.district),
  zipCode: optionalZipCode,
  city: optionalNullableText(CUSTOMER_FIELD_MAX_LENGTHS.city),
  state: optionalStateSchema,
  notes: optionalNullableText(CUSTOMER_FIELD_MAX_LENGTHS.notes),
  businessLotSuffix: optionalNullableText(CUSTOMER_FIELD_MAX_LENGTHS.businessLotSuffix),
  ...pagamentoPadraoFields,
});

export const updateCustomerSchema = z.object({
  legalName: z
    .string()
    .trim()
    .min(1, "Razão social é obrigatória")
    .max(CUSTOMER_FIELD_MAX_LENGTHS.legalName)
    .optional(),
  tradeName: optionalNullableText(CUSTOMER_FIELD_MAX_LENGTHS.tradeName),
  cnpj: optionalCnpjSchema,
  email: optionalEmailSchema,
  phone: optionalBrPhoneSchema,
  taxProfile: optionalTaxProfileSchema,
  cnpjRegistration: cnpjRegistrationField,
  street: optionalNullableText(CUSTOMER_FIELD_MAX_LENGTHS.street),
  number: optionalNullableText(CUSTOMER_FIELD_MAX_LENGTHS.number),
  complement: optionalNullableText(CUSTOMER_FIELD_MAX_LENGTHS.complement),
  district: optionalNullableText(CUSTOMER_FIELD_MAX_LENGTHS.district),
  zipCode: optionalZipCode,
  city: optionalNullableText(CUSTOMER_FIELD_MAX_LENGTHS.city),
  state: optionalStateSchema,
  notes: optionalNullableText(CUSTOMER_FIELD_MAX_LENGTHS.notes),
  businessLotSuffix: optionalNullableText(CUSTOMER_FIELD_MAX_LENGTHS.businessLotSuffix),
  ...pagamentoPadraoFields,
});

/**
 * Corpo das quatro ações de situação (§95). O motivo é OBRIGATÓRIO em todas:
 * o histórico existe para responder "por quê", e evento sem motivo não
 * responde nada. Só espaços é o mesmo que vazio.
 */
export const customerStatusChangeSchema = z.object({
  reason: z
    .string({
      required_error: "Motivo é obrigatório",
      invalid_type_error: "Motivo é obrigatório",
    })
    .trim()
    .min(1, "Motivo é obrigatório")
    .max(CUSTOMER_STATUS_REASON_MAX_LENGTH),
});

export const listCustomersQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  state: z.string().trim().length(2).optional().transform((v) => v?.toUpperCase()),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  /**
   * Situação cadastral (§95). Ausente: todas — a tela de Clientes é que abre
   * em "Ativos", e os seletores de outras telas pedem o recorte que cada uma
   * precisa (venda só com ATIVO; cadastro e material também com BLOCKED).
   */
  status: optionalStatusListSchema,
  /**
   * Situação comercial derivada (§86). Ausente: todas — os seletores de
   * Cliente das outras telas usam esta mesma rota e não podem esconder Prospect.
   */
  commercialStatus: z.enum(CUSTOMER_COMMERCIAL_STATUSES).optional(),
  page: inteiroDeConsultaSchema({ minimo: 1, padrao: 1 }),
  /* Seletor de tela carrega o catálogo inteiro num <select>; com teto de
   100 o cadastro 101 em diante ficava impossível de escolher. */
  /**
   * Conjunto explícito de ids. Serve à exportação do que está selecionado e
   * ao link contextual, que leva à lista já reduzida ao registro citado —
   * identidade, nunca busca por texto. Vazio significa "sem restrição".
   */
  ids: z
    .string()
    .trim()
    .min(1)
    .optional()
    .transform((value) => (value ? value.split(",").filter(Boolean) : undefined)),
  pageSize: inteiroDeConsultaSchema({ minimo: 1, maximo: 1000, padrao: 20 }),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
export type CustomerStatusChangeInput = z.infer<typeof customerStatusChangeSchema>;
