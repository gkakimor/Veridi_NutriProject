import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";

/**
 * Decimal como string — nunca usar float JS como fonte de precisao para
 * quantidade/preco. Aceita number tambem (conveniencia de payload), mas
 * sempre normaliza para string antes de repassar ao Prisma.
 */
function decimalStringSchema(options: { allowZero?: boolean } = {}) {
  return z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => /^\d+(\.\d+)?$/.test(value), { message: "Valor decimal inválido" })
    .refine((value) => (options.allowZero ? Number(value) >= 0 : Number(value) > 0), {
      message: options.allowZero
        ? "Valor não pode ser negativo"
        : "Valor deve ser maior que zero",
    });
}

/** Data obrigatoria. */
const requiredDateSchema = z.coerce.date({ errorMap: () => ({ message: "Data inválida" }) });

/** Data opcional e limpavel: chave ausente = nao mexe; "" = null; valor = seta. */
const optionalNullableDateSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value.length === 0) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date(NaN) : parsed;
  })
  .refine((value) => value === undefined || value === null || !Number.isNaN(value.getTime()), {
    message: "Data inválida",
  });

const purchaseOrderLineInputSchema = z.object({
  itemId: z.string().trim().min(1, "Item é obrigatório"),
  orderedQuantity: decimalStringSchema(),
  unitPrice: decimalStringSchema({ allowZero: true }).optional(),
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
