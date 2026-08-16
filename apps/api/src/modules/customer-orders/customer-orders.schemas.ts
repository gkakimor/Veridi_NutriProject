import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { decimalStringSchema } from "../../lib/decimal-schema.js";
import { requiredDateSchema } from "../../lib/date-schema.js";

const customerOrderLineInputSchema = z.object({
  productId: z.string().trim().min(1, "Produto é obrigatório"),
  orderedQuantity: decimalStringSchema(),
});

export const createCustomerOrderSchema = z.object({
  customerId: z.string().trim().min(1, "Cliente é obrigatório"),
  requestedDeliveryDate: requiredDateSchema.optional(),
  notes: optionalNullableText(1000),
  lines: z.array(customerOrderLineInputSchema).optional(),
});

/**
 * Aceita todos os campos — a trava por status (DRAFT permite tudo;
 * CONFIRMED so previsao de entrega + observacoes; CANCELLED/IN_FULFILLMENT
 * nada) e responsabilidade do service, nao do schema.
 */
export const updateCustomerOrderSchema = z.object({
  customerId: z.string().trim().min(1, "Cliente é obrigatório").optional(),
  requestedDeliveryDate: requiredDateSchema.optional(),
  notes: optionalNullableText(1000),
  lines: z.array(customerOrderLineInputSchema).optional(),
});

export const cancelCustomerOrderSchema = z.object({
  reason: z.string().trim().min(3, "Motivo do cancelamento é obrigatório").max(500),
});

export const listCustomerOrdersQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  status: z.enum(["DRAFT", "CONFIRMED", "IN_FULFILLMENT", "CANCELLED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CustomerOrderLineInput = z.infer<typeof customerOrderLineInputSchema>;
export type CreateCustomerOrderInput = z.infer<typeof createCustomerOrderSchema>;
export type UpdateCustomerOrderInput = z.infer<typeof updateCustomerOrderSchema>;
export type CancelCustomerOrderInput = z.infer<typeof cancelCustomerOrderSchema>;
export type ListCustomerOrdersQuery = z.infer<typeof listCustomerOrdersQuerySchema>;
