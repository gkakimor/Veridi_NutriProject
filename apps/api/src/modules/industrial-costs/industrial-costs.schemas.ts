import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { decimalStringSchema } from "../../lib/decimal-schema.js";

/**
 * Só as categorias manuais da capacidade 43. `LABOR`, `EQUIPMENT` e
 * `ENERGY` são recusadas de propósito: criar linha manual para elas agora
 * significaria duplicar tudo quando os recursos industriais chegarem.
 */
export const industrialCostCategorySchema = z.enum([
  "SECONDARY_PACKAGING",
  "THIRD_PARTY_SERVICE",
  "OVERHEAD",
  "OTHER",
]);

export const industrialCostBasisSchema = z.enum([
  "FIXED_PER_BATCH",
  "PER_OUTPUT_UNIT",
  "PER_1000_OUTPUT_UNITS",
  "PER_SHIPPING_BOX",
  "PERCENT_OF_DIRECT_INDUSTRIAL_COST",
]);

export const createIndustrialCostVersionSchema = z.object({
  formulationVersionId: z.string().trim().min(1).optional(),
  referenceOutputQuantity: decimalStringSchema().optional(),
  referenceOutputUomCode: z.string().trim().min(1).optional(),
  notes: optionalNullableText(2000),
});

export const updateIndustrialCostVersionSchema = z.object({
  formulationVersionId: z.string().trim().min(1).optional(),
  referenceOutputQuantity: decimalStringSchema().optional(),
  referenceOutputUomCode: z.string().trim().min(1).optional(),
  notes: optionalNullableText(2000),
});

export const createIndustrialCostLineSchema = z.object({
  category: industrialCostCategorySchema,
  description: z.string().trim().min(1, "Descreva a premissa de custo").max(200),
  calculationBasis: industrialCostBasisSchema,
  // Ausente/`null` mantém a premissa como "não informada" — nunca zero.
  rateValue: decimalStringSchema({ allowZero: true }).nullish(),
  notes: optionalNullableText(1000),
});

export const updateIndustrialCostLineSchema = z.object({
  description: z.string().trim().min(1).max(200).optional(),
  calculationBasis: industrialCostBasisSchema.optional(),
  rateValue: decimalStringSchema({ allowZero: true }).nullish(),
  notes: optionalNullableText(1000),
});

export const activateIndustrialCostVersionSchema = z.object({
  confirmIncomplete: z.boolean().optional(),
});

export type CreateIndustrialCostVersionInput = z.infer<
  typeof createIndustrialCostVersionSchema
>;
export type UpdateIndustrialCostVersionInput = z.infer<
  typeof updateIndustrialCostVersionSchema
>;
export type CreateIndustrialCostLineInput = z.infer<typeof createIndustrialCostLineSchema>;
export type UpdateIndustrialCostLineInput = z.infer<typeof updateIndustrialCostLineSchema>;
export type ActivateIndustrialCostVersionInput = z.infer<
  typeof activateIndustrialCostVersionSchema
>;

const RESOURCE_COUNT_MESSAGE = "Quantidade de recursos: informe um número inteiro maior que zero.";

/**
 * Quantidade de recursos equivalentes (§87): inteiro, no mínimo 1. Sem
 * coerção — "2" como texto, 1,5, zero, negativo e `null` são recusados antes
 * do domínio. O teto é o do inteiro do banco, não regra de negócio.
 */
export const resourceCountSchema = z
  .number({ invalid_type_error: RESOURCE_COUNT_MESSAGE, required_error: RESOURCE_COUNT_MESSAGE })
  .int(RESOURCE_COUNT_MESSAGE)
  .min(1, RESOURCE_COUNT_MESSAGE)
  .max(2_147_483_647, RESOURCE_COUNT_MESSAGE);

export const createResourceUsageSchema = z.object({
  resourceId: z.string().trim().min(1, "Selecione o recurso"),
  // Recurso que não é usado simplesmente não vira linha — nada de 0 hora.
  usageQuantity: decimalStringSchema(),
  usageBasis: z
    .enum(["FIXED_PER_REFERENCE_BATCH", "PER_OUTPUT_UNIT", "PER_1000_OUTPUT_UNITS"])
    .optional(),
  // Ausente = 1. Mão de obra e equipamento; energia recusa outro valor.
  resourceCount: resourceCountSchema.optional(),
  notes: optionalNullableText(1000),
});

export const updateEnergyModeSchema = z.object({
  energyCalculationMode: z.enum(["NONE", "DIRECT", "FROM_EQUIPMENT"]),
  /** Só faz sentido no modo derivado; ausente mantém o que já está lá. */
  energyResourceId: z.string().trim().min(1).nullish(),
});

export type CreateResourceUsageInput = z.infer<typeof createResourceUsageSchema>;
export type UpdateEnergyModeInput = z.infer<typeof updateEnergyModeSchema>;
