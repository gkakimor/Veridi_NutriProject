import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { decimalStringSchema } from "../../lib/decimal-schema.js";

export const priceModeSchema = z.enum(["TARGET_MARGIN", "MANUAL_PRICE"]);

export const createPricingVersionSchema = z.object({
  // Precificação formal parte sempre de um cálculo salvo.
  industrialCostCalculationId: z.string().trim().min(1).optional(),
  notes: optionalNullableText(2000),
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
  manualUnitPrice: decimalStringSchema({ allowZero: true }).nullish(),
  notes: optionalNullableText(1000),
});

export const updatePricingTierSchema = z.object({
  quantity: decimalStringSchema().optional(),
  priceMode: priceModeSchema.optional(),
  targetContributionMarginPercent: decimalStringSchema({ allowZero: true }).nullish(),
  commissionPercent: decimalStringSchema({ allowZero: true }).optional(),
  manualUnitPrice: decimalStringSchema({ allowZero: true }).nullish(),
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
