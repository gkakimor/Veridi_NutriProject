import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { decimalStringSchema } from "../../lib/decimal-schema.js";

const statusEnum = z.enum([
  "DRAFT",
  "PLANNED",
  "RELEASED",
  "IN_PRODUCTION",
  "COMPLETED",
  "BLOCKED",
  "CANCELLED",
]);

const originEnum = z.enum(["MANUAL", "STOCK_PRODUCTION"]);

export const listProductionOrdersQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  status: statusEnum.optional(),
  productId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const createProductionOrderSchema = z.object({
  productId: z.string().trim().min(1, "Produto é obrigatório"),
  formulationVersionId: z.string().trim().min(1).optional(),
  plannedQuantity: decimalStringSchema().optional(),
  notes: z.string().trim().max(2000).optional(),
  origin: originEnum.optional(),
});

export const updateProductionOrderSchema = z.object({
  productId: z.string().trim().min(1).optional(),
  formulationVersionId: z.string().trim().min(1).optional(),
  plannedQuantity: decimalStringSchema().optional(),
  notes: optionalNullableText(2000),
});

export const cancelProductionOrderSchema = z.object({
  reason: z.string().trim().min(3, "Motivo do cancelamento é obrigatório").max(500),
});

export type ListProductionOrdersQuery = z.infer<typeof listProductionOrdersQuerySchema>;
export type CreateProductionOrderInput = z.infer<typeof createProductionOrderSchema>;
export type UpdateProductionOrderInput = z.infer<typeof updateProductionOrderSchema>;
export type CancelProductionOrderInput = z.infer<typeof cancelProductionOrderSchema>;
