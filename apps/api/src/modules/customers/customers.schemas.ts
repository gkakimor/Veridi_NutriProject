import { z } from "zod";
import {
  BR_STATE_CODES,
  CUSTOMER_COMMERCIAL_STATUSES,
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

export const listCustomersQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  state: z.string().trim().length(2).optional().transform((v) => v?.toUpperCase()),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  /**
   * Situação comercial derivada (§86). Ausente: todas — os seletores de
   * Cliente das outras telas usam esta mesma rota e não podem esconder Prospect.
   */
  commercialStatus: z.enum(CUSTOMER_COMMERCIAL_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
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
  pageSize: z.coerce.number().int().min(1).max(1000).default(20),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
