import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";

export const createBillingSchema = z.object({
  shipmentId: z.string().trim().min(1, "Expedição é obrigatória"),
});

/**
 * `unitPrice` opcional e limpavel: chave ausente = nao mexe; "" = null
 * (limpa); valor = seta. Mesmo idiom de `optionalNullableText`. Preco
 * negativo e rejeitado; zero e aceito (brinde/bonificacao).
 */
const updateBillingLineSchema = z.object({
  billingLineId: z.string().trim().min(1, "Linha de faturamento é obrigatória"),
  unitPrice: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => (value === undefined ? undefined : String(value).trim()))
    .refine((value) => value === undefined || value === "" || /^\d+(\.\d+)?$/.test(value), {
      message: "Preço unitário inválido (não pode ser negativo)",
    }),
});

export const updateBillingSchema = z.object({
  externalReference: optionalNullableText(200),
  notes: optionalNullableText(1000),
  lines: z.array(updateBillingLineSchema).optional(),
});

/**
 * Sobreposicao do preco faturado. Nao e "editar o campo": e um ato
 * proprio, com motivo obrigatorio, que preserva o preco acordado ao lado.
 * Zero e aceito (bonificacao); negativo, nao.
 */
export const overrideBillingPriceSchema = z.object({
  unitPrice: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => /^\d+(\.\d+)?$/.test(value), {
      message: "Preço unitário inválido (não pode ser negativo)",
    }),
  reason: z.string().trim().min(3, "Motivo da alteração é obrigatório").max(500),
});

export const cancelBillingSchema = z.object({
  reason: z.string().trim().min(3, "Motivo do cancelamento é obrigatório").max(500),
});

export const listBillingsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  /** "Quero ver só os faturamentos do cliente X" é a pergunta desta tela. */
  customerId: z.string().trim().min(1).optional(),
  customerOrderId: z.string().trim().min(1).optional(),
  shipmentId: z.string().trim().min(1).optional(),
  status: z.enum(["DRAFT", "ISSUED", "CANCELLED"]).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateBillingInput = z.infer<typeof createBillingSchema>;
export type UpdateBillingLineInput = z.infer<typeof updateBillingLineSchema>;
export type UpdateBillingInput = z.infer<typeof updateBillingSchema>;
export type OverrideBillingPriceInput = z.infer<typeof overrideBillingPriceSchema>;
export type CancelBillingInput = z.infer<typeof cancelBillingSchema>;
export type ListBillingsQuery = z.infer<typeof listBillingsQuerySchema>;
