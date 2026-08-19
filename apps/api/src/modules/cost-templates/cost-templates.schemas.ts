import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";

const decimalString = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^\d+(\.\d+)?$/.test(value), { message: "Valor inválido" });

export const listTemplatesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  archived: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === true || value === "true")),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const updateTemplateIdentitySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: optionalNullableText(1000),
});

export const archiveTemplateSchema = z.object({ archived: z.boolean() });

// ───────────────────────────────────────────── Template de Estrutura (TEC)

export const createCostTemplateSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do template").max(200),
  description: optionalNullableText(1000),
  referenceOutputQuantity: decimalString.optional(),
  referenceOutputUomCode: z.string().trim().min(1).max(20).optional(),
});

const resourceUsageSchema = z.object({
  industrialResourceId: z.string().trim().min(1),
  usageBasis: z
    .enum(["FIXED_PER_REFERENCE_BATCH", "PER_OUTPUT_UNIT", "PER_1000_OUTPUT_UNITS"])
    .optional(),
  usageQuantity: decimalString,
  usageUom: z.enum(["HOUR", "KWH"]),
  notes: optionalNullableText(500),
});

const additionalCostSchema = z.object({
  category: z.enum(["SECONDARY_PACKAGING", "THIRD_PARTY_SERVICE", "OVERHEAD", "OTHER"]),
  description: z.string().trim().min(1).max(200),
  calculationBasis: z.enum([
    "FIXED_PER_BATCH",
    "PER_OUTPUT_UNIT",
    "PER_1000_OUTPUT_UNITS",
    "PER_SHIPPING_BOX",
    "PERCENT_OF_DIRECT_INDUSTRIAL_COST",
  ]),
  rateValue: decimalString.nullish(),
  notes: optionalNullableText(500),
});

export const updateCostTemplateVersionSchema = z.object({
  referenceOutputQuantity: decimalString.optional(),
  referenceOutputUomCode: z.string().trim().min(1).max(20).optional(),
  energyCalculationMode: z.enum(["NONE", "DIRECT", "FROM_EQUIPMENT"]).optional(),
  energyResourceId: z.string().trim().min(1).nullish(),
  notes: optionalNullableText(1000),
  resourceUsages: z.array(resourceUsageSchema).optional(),
  additionalCosts: z.array(additionalCostSchema).optional(),
});

export const applyCostTemplateSchema = z.object({
  costTemplateVersionId: z.string().trim().min(1),
});

export const createCostTemplateFromVersionSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do template").max(200),
  description: optionalNullableText(1000),
});

// ──────────────────────────────────────── Política de Precificação (TPP)

export const createPricingPolicySchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da política").max(200),
  description: optionalNullableText(1000),
});

/**
 * Faixa da política.
 *
 * Margem alvo é obrigatória e não existe preço manual: uma política é REGRA
 * reutilizável, e preço informado à mão é decisão de uma negociação sobre um
 * custo específico.
 */
const policyTierSchema = z.object({
  quantity: decimalString,
  uomCode: z.string().trim().min(1).max(20).optional(),
  targetContributionMarginPercent: decimalString,
  commissionPercent: decimalString.optional(),
  notes: optionalNullableText(500),
});

export const updatePricingPolicyVersionSchema = z.object({
  notes: optionalNullableText(1000),
  tiers: z.array(policyTierSchema).optional(),
});

export const applyPricingPolicySchema = z.object({
  pricingPolicyVersionId: z.string().trim().min(1),
  industrialCostCalculationId: z.string().trim().min(1),
});

export const previewPricingPolicySchema = z.object({
  pricingPolicyVersionId: z.string().trim().min(1),
  industrialCostCalculationId: z.string().trim().min(1),
});

export const createPolicyFromPricingSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da política").max(200),
  description: optionalNullableText(1000),
});

export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;
export type UpdateTemplateIdentityInput = z.infer<typeof updateTemplateIdentitySchema>;
export type CreateCostTemplateInput = z.infer<typeof createCostTemplateSchema>;
export type UpdateCostTemplateVersionInput = z.infer<typeof updateCostTemplateVersionSchema>;
export type CreateCostTemplateFromVersionInput = z.infer<
  typeof createCostTemplateFromVersionSchema
>;
export type CreatePricingPolicyInput = z.infer<typeof createPricingPolicySchema>;
export type UpdatePricingPolicyVersionInput = z.infer<typeof updatePricingPolicyVersionSchema>;
export type ApplyPricingPolicyInput = z.infer<typeof applyPricingPolicySchema>;
export type CreatePolicyFromPricingInput = z.infer<typeof createPolicyFromPricingSchema>;
