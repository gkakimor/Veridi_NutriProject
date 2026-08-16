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
  sourceType: z.enum(["PURCHASE_ORDER", "CUSTOMER_SUPPLIED"]).optional(),
  customerId: z.string().trim().min(1).optional(),
  dateFrom: requiredDateSchema.optional(),
  dateTo: requiredDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ReceiptLineInput = z.infer<typeof receiptLineInputSchema>;
export type CreateReceiptInput = z.infer<typeof createReceiptSchema>;
export type ListReceiptsQuery = z.infer<typeof listReceiptsQuerySchema>;

/**
 * Linha direta de material enviado pelo cliente — sem OC: o Item, a
 * quantidade e o lote do fabricante são informados no próprio recebimento.
 */
const customerSuppliedLineSchema = z.object({
  itemId: z.string().trim().min(1, "Item é obrigatório"),
  receivedQuantity: decimalStringSchema(),
  supplierLot: z.string().trim().max(100).optional(),
  expiryDate: requiredDateSchema.optional(),
  location: z.string().trim().max(200).optional(),
});

export const createCustomerSuppliedReceiptSchema = z.object({
  customerId: z.string().trim().min(1, "Cliente é obrigatório"),
  receivedAt: requiredDateSchema,
  // Nota fiscal não é exigida: material do cliente pode chegar com outro
  // documento (remessa, declaração de conteúdo).
  invoiceNumber: optionalNullableText(100),
  documentReference: optionalNullableText(100),
  notes: optionalNullableText(1000),
  lines: z.array(customerSuppliedLineSchema).min(1, "Informe ao menos uma linha recebida"),
});

export type CustomerSuppliedLineInput = z.infer<typeof customerSuppliedLineSchema>;
export type CreateCustomerSuppliedReceiptInput = z.infer<typeof createCustomerSuppliedReceiptSchema>;
