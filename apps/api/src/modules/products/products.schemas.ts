import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";

/** Relacao opcional por id: "" vira null (desvincula), valor seta, chave ausente nao mexe. */
const optionalRelationId = z
  .string()
  .trim()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return value.length === 0 ? null : value;
  });

export const createProductSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório").max(200),
  customerId: optionalRelationId,
  finishedProductItemId: optionalRelationId,
  externalCode: optionalNullableText(100),
  notes: optionalNullableText(1000),
});

export const updateProductSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório").max(200).optional(),
  customerId: optionalRelationId,
  finishedProductItemId: optionalRelationId,
  externalCode: optionalNullableText(100),
  notes: optionalNullableText(1000),
});

export const listProductsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  customerId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
