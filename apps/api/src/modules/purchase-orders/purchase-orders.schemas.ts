import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import {
  CASAS_PRECO_UNITARIO,
  decimalStringSchema,
  quantityDecimalSchema,
} from "../../lib/decimal-schema.js";
import { optionalNullableDateSchema, requiredDateSchema } from "../../lib/date-schema.js";

const purchaseOrderLineInputSchema = z.object({
  itemId: z.string().trim().min(1, "Item é obrigatório"),
  orderedQuantity: quantityDecimalSchema(),
  // Até oito casas — o scale de `DECIMAL(20,8)`, PREC-MIG-P. Acima disso a
  // fronteira RECUSA (§58) em vez de deixar o PostgreSQL arredondar a nona em
  // silêncio: o operador digitava um preço e o banco gravava outro.
  unitPrice: decimalStringSchema({ allowZero: true, maxDecimals: CASAS_PRECO_UNITARIO }).optional(),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().trim().min(1, "Fornecedor é obrigatório"),
  orderDate: requiredDateSchema,
  expectedDeliveryDate: requiredDateSchema.optional(),
  notes: optionalNullableText(1000),
  lines: z.array(purchaseOrderLineInputSchema).optional(),
});

/**
 * Aceita todos os campos — a trava por status (DRAFT permite tudo;
 * ORDERED/PARTIALLY_RECEIVED/RECEIVED so previsao+observacoes; CANCELLED
 * nada) e responsabilidade do service, nao do schema.
 */
export const updatePurchaseOrderSchema = z.object({
  supplierId: z.string().trim().min(1, "Fornecedor é obrigatório").optional(),
  orderDate: requiredDateSchema.optional(),
  expectedDeliveryDate: optionalNullableDateSchema,
  notes: optionalNullableText(1000),
  lines: z.array(purchaseOrderLineInputSchema).optional(),
});

export const cancelPurchaseOrderSchema = z.object({
  reason: z.string().trim().min(3, "Motivo do cancelamento é obrigatório").max(500),
});

export const listPurchaseOrdersQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  supplierId: z.string().trim().min(1).optional(),
  status: z
    .enum(["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineInputSchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;
export type CancelPurchaseOrderInput = z.infer<typeof cancelPurchaseOrderSchema>;
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>;
