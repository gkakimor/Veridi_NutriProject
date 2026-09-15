import { z } from "zod";
import { inteiroDeConsultaSchema } from "../../lib/integer-schema.js";
import {
  BR_STATE_CODES,
  CUSTOMER_COMMERCIAL_STATUSES,
  CUSTOMER_STATUSES,
  CUSTOMER_STATUS_REASON_MAX_LENGTH,
  CUSTOMER_TAX_PROFILES,
} from "@veridi/shared";
import { optionalCnpjSchema, optionalNullableText } from "../../lib/cnpj-schema.js";
import { optionalBrPhoneSchema, optionalEmailSchema } from "../../lib/contact-schema.js";
import { optionalZipCode } from "../../lib/industrial-schema.js";

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

export const createCustomerSchema = z.object({
  legalName: z.string().trim().min(1, "Razão social é obrigatória").max(200),
  tradeName: optionalNullableText(200),
  cnpj: optionalCnpjSchema,
  email: optionalEmailSchema,
  phone: optionalBrPhoneSchema,
  taxProfile: optionalTaxProfileSchema,
  street: optionalNullableText(200),
  number: optionalNullableText(20),
  complement: optionalNullableText(100),
  district: optionalNullableText(100),
  zipCode: optionalZipCode,
  city: optionalNullableText(100),
  state: optionalStateSchema,
  notes: optionalNullableText(1000),
  businessLotSuffix: optionalNullableText(20),
});

export const updateCustomerSchema = z.object({
  legalName: z
    .string()
    .trim()
    .min(1, "Razão social é obrigatória")
    .max(200)
    .optional(),
  tradeName: optionalNullableText(200),
  cnpj: optionalCnpjSchema,
  email: optionalEmailSchema,
  phone: optionalBrPhoneSchema,
  taxProfile: optionalTaxProfileSchema,
  street: optionalNullableText(200),
  number: optionalNullableText(20),
  complement: optionalNullableText(100),
  district: optionalNullableText(100),
  zipCode: optionalZipCode,
  city: optionalNullableText(100),
  state: optionalStateSchema,
  notes: optionalNullableText(1000),
  businessLotSuffix: optionalNullableText(20),
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
