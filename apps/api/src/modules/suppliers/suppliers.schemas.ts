import { z } from "zod";
import { optionalCnpjSchema, optionalNullableText } from "../../lib/cnpj-schema.js";

export const createSupplierSchema = z.object({
  legalName: z.string().trim().min(1, "Razão social é obrigatória").max(200),
  tradeName: optionalNullableText(200),
  cnpj: optionalCnpjSchema,
  email: optionalNullableText(200),
  phone: optionalNullableText(30),
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
  email: optionalNullableText(200),
  phone: optionalNullableText(30),
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
  pageSize: z.coerce.number().int().min(1).max(1000).default(20),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;
