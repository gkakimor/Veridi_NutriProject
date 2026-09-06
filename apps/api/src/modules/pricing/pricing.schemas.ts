import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { CASAS_PRECO_UNITARIO, decimalStringSchema } from "../../lib/decimal-schema.js";

/**
 * Preço de faixa informado à mão — até oito casas, recusando acima.
 *
 * `PRODUCT_RULES.md` §58, PREC-P-02. A coluna é `DECIMAL(20,8)`: um produto
 * cotado por dose tem preço de faixa legitimamente longo, e `4,05318764` é um
 * número que a precificação precisa guardar inteiro. Acima de oito casas o
 * PostgreSQL voltaria a arredondar a nona em silêncio — o operador digitava um
 * preço e o banco gravava outro —, então a fronteira recusa e explica.
 *
 * Zero continua sendo preço zero explícito, e ausente continua sendo "não
 * informado": os dois nunca se confundem.
 */
const precoTecnicoSchema = () =>
  decimalStringSchema({ allowZero: true, maxDecimals: CASAS_PRECO_UNITARIO });

export const priceModeSchema = z.enum(["TARGET_MARGIN", "MANUAL_PRICE"]);

export const createPricingVersionSchema = z.object({
  // Precificação formal parte sempre de um cálculo salvo.
  industrialCostCalculationId: z.string().trim().min(1).optional(),
  notes: optionalNullableText(2000),
});

// Trocar a base é uma escolha explícita: o cálculo alvo vem no corpo.
export const rebasePricingVersionSchema = z.object({
  industrialCostCalculationId: z.string().trim().min(1),
});

export const updatePricingVersionSchema = z.object({
  notes: optionalNullableText(2000),
});

export const createPricingTierSchema = z.object({
  // Quantidade é sempre positiva: faixa de zero unidade não é cenário.
  quantity: decimalStringSchema(),
  uomCode: z.string().trim().min(1).optional(),
  priceMode: priceModeSchema,
  targetContributionMarginPercent: decimalStringSchema({ allowZero: true }).nullish(),
  commissionPercent: decimalStringSchema({ allowZero: true }).optional(),
  // Zero é preço explícito; ausente é preço não informado.
  manualUnitPrice: precoTecnicoSchema().nullish(),
  notes: optionalNullableText(1000),
});

export const updatePricingTierSchema = z.object({
  quantity: decimalStringSchema().optional(),
  priceMode: priceModeSchema.optional(),
  targetContributionMarginPercent: decimalStringSchema({ allowZero: true }).nullish(),
  commissionPercent: decimalStringSchema({ allowZero: true }).optional(),
  manualUnitPrice: precoTecnicoSchema().nullish(),
  notes: optionalNullableText(1000),
});

export const activatePricingVersionSchema = z.object({
  confirmIncompleteCost: z.boolean().optional(),
  confirmOutdatedStructure: z.boolean().optional(),
});

export const listPricingVersionsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE"]).optional(),
  quality: z
    .enum(["COMPLETE_REAL_REFERENCE", "COMPLETE_WITH_ESTIMATES", "PARTIAL", "NO_COST"])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreatePricingVersionInput = z.infer<typeof createPricingVersionSchema>;
export type UpdatePricingVersionInput = z.infer<typeof updatePricingVersionSchema>;
export type CreatePricingTierInput = z.infer<typeof createPricingTierSchema>;
export type UpdatePricingTierInput = z.infer<typeof updatePricingTierSchema>;
export type ActivatePricingVersionInput = z.infer<typeof activatePricingVersionSchema>;
export type ListPricingVersionsQuery = z.infer<typeof listPricingVersionsQuerySchema>;
