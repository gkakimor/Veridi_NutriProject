import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { quantityDecimalSchema } from "../../lib/decimal-schema.js";
import { listaDeStatusSchema } from "../../lib/status-list-schema.js";

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
  /*
   * Um status, ou vários separados por vírgula — `RELEASED,IN_PRODUCTION`.
   * O Picking/Consumo pede o par atendível; a lista de Ordens de Produção
   * pede "Em aberto". O contrato é o mesmo das outras listas
   * (`listaDeStatusSchema`).
   */
  status: listaDeStatusSchema(statusEnum).optional(),
  productId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Em quantas frações a produção será executada (o misturador raramente
 * comporta o lote inteiro). Teto operacional generoso — 99 — em vez do
 * máximo que a planilha atual mostra: o número é escolha do usuário.
 */
const numberOfPartsSchema = z.coerce
  .number()
  .int("Informe um número inteiro de partes")
  .min(1, "A produção tem ao menos 1 parte")
  .max(99, "Máximo de 99 partes");

export const createProductionOrderSchema = z.object({
  productId: z.string().trim().min(1, "Produto é obrigatório"),
  formulationVersionId: z.string().trim().min(1).optional(),
  plannedQuantity: quantityDecimalSchema().optional(),
  notes: z.string().trim().max(2000).optional(),
  origin: originEnum.optional(),
  numberOfParts: numberOfPartsSchema.optional(),
  labelInstructions: optionalNullableText(2000),
});

export const updateProductionOrderSchema = z.object({
  productId: z.string().trim().min(1).optional(),
  formulationVersionId: z.string().trim().min(1).optional(),
  plannedQuantity: quantityDecimalSchema().optional(),
  notes: optionalNullableText(2000),
  numberOfParts: numberOfPartsSchema.optional(),
  labelInstructions: optionalNullableText(2000),
});

export const cancelProductionOrderSchema = z.object({
  reason: z.string().trim().min(3, "Motivo do cancelamento é obrigatório").max(500),
});

export type ListProductionOrdersQuery = z.infer<typeof listProductionOrdersQuerySchema>;
export type CreateProductionOrderInput = z.infer<typeof createProductionOrderSchema>;
export type UpdateProductionOrderInput = z.infer<typeof updateProductionOrderSchema>;
export type CancelProductionOrderInput = z.infer<typeof cancelProductionOrderSchema>;
