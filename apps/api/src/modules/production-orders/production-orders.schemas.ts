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
  /*
   * Roteiro de produção: `1`/`true` = pendentes de roteiro (sem cópia, em
   * rascunho, planejada ou liberada); `0`/`false` = com roteiro; ausente = todas.
   */
  semRoteiro: z
    .enum(["1", "0", "true", "false"])
    .optional()
    .transform((valor) => (valor === undefined ? undefined : valor === "1" || valor === "true")),
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

/**
 * Corpo de aplicar/trocar o roteiro. Tudo opcional: vazio aplica o padrão
 * atual do Produto. Quando o motivo é obrigatório decide o serviço, pela
 * situação da ordem — não o formato do pedido.
 */
export const applyProductionRouteSchema = z.object({
  productionProfileVersionId: z.string().trim().min(1).optional(),
  setAsProductDefault: z.boolean().optional(),
  reason: z.string().trim().max(500, "Motivo com no máximo 500 caracteres").optional(),
  confirmLegacyRepair: z.boolean().optional(),
  confirmScheduleRemoval: z.boolean().optional(),
  expectedSourceVersionId: z.string().trim().min(1).nullable().optional(),
});

export type ListProductionOrdersQuery = z.infer<typeof listProductionOrdersQuerySchema>;
export type CreateProductionOrderInput = z.infer<typeof createProductionOrderSchema>;
export type UpdateProductionOrderInput = z.infer<typeof updateProductionOrderSchema>;
export type CancelProductionOrderInput = z.infer<typeof cancelProductionOrderSchema>;
export type ApplyProductionRouteParsed = z.infer<typeof applyProductionRouteSchema>;
