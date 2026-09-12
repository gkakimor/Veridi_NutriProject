import { z } from "zod";
import { optionalCnpjSchema, optionalNullableText } from "../../lib/cnpj-schema.js";
import { optionalBrPhoneSchema, optionalEmailSchema } from "../../lib/contact-schema.js";
import { optionalBrState, optionalZipCode } from "../../lib/industrial-schema.js";

/**
 * Endereço do Fornecedor — os MESMOS limites e as MESMAS regras do Cliente.
 *
 * Todos opcionais: fornecedor existe sem endereço, e campo enviado vazio
 * persiste como `null`. Nada aqui é mais rígido que no Cliente de propósito —
 * uma UF que passa num cadastro e é recusada no outro é defeito, não regra de
 * domínio.
 */
const addressShape = {
  street: optionalNullableText(200),
  number: optionalNullableText(20),
  complement: optionalNullableText(100),
  district: optionalNullableText(100),
  zipCode: optionalZipCode,
  city: optionalNullableText(100),
  state: optionalBrState,
};

export const createSupplierSchema = z.object({
  legalName: z.string().trim().min(1, "Razão social é obrigatória").max(200),
  tradeName: optionalNullableText(200),
  cnpj: optionalCnpjSchema,
  email: optionalEmailSchema,
  phone: optionalBrPhoneSchema,
  ...addressShape,
  notes: optionalNullableText(1000),
});

export const updateSupplierSchema = z.object({
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
  ...addressShape,
  notes: optionalNullableText(1000),
});

export const listSuppliersQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
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

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;
