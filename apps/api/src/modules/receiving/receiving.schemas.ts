import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { decimalStringSchema } from "../../lib/decimal-schema.js";
import { requiredDateSchema } from "../../lib/date-schema.js";

const receiptLineInputSchema = z.object({
  purchaseOrderLineId: z.string().trim().min(1, "Linha da OC é obrigatória"),
  receivedQuantity: decimalStringSchema(),
  supplierLot: z.string().trim().max(100).optional(),
  expiryDate: requiredDateSchema.optional(),
  location: z.string().trim().max(200).optional(),
  /**
   * Custo efetivo de aquisicao por unidade de estoque — SEMPRE opcional
   * (recebimento nunca falha por falta de custo). Zero e valido; negativo
   * rejeitado; nunca preenchido a partir do preco da OC.
   */
  actualUnitCost: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => (value === undefined ? undefined : String(value).trim()))
    .refine((value) => value === undefined || value === "" || /^\d+(\.\d+)?$/.test(value), {
      message: "Custo unitário inválido (não pode ser negativo)",
    }),
});

export const createReceiptSchema = z.object({
  receivedAt: requiredDateSchema,
  invoiceNumber: optionalNullableText(100),
  documentReference: optionalNullableText(100),
  notes: optionalNullableText(1000),
  lines: z.array(receiptLineInputSchema).min(1, "Informe ao menos uma linha recebida"),
});

export const listReceiptsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  purchaseOrderId: z.string().trim().min(1).optional(),
  supplierId: z.string().trim().min(1).optional(),
  dateFrom: requiredDateSchema.optional(),
  dateTo: requiredDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ReceiptLineInput = z.infer<typeof receiptLineInputSchema>;
export type CreateReceiptInput = z.infer<typeof createReceiptSchema>;
export type ListReceiptsQuery = z.infer<typeof listReceiptsQuerySchema>;
