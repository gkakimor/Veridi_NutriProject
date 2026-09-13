import { z } from "zod";
import { PRODUCTION_STEP_LIMITS } from "@veridi/shared";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { quantityDecimalSchema } from "../../lib/decimal-schema.js";

/**
 * Fronteira do Perfil de Produção — `PRODUCT_RULES.md` §89.
 *
 * Quantidade de recursos e minutos são INTEIROS: fração, texto, zero onde não
 * cabe e nulo são 400 antes do domínio. A coerência com o cadastro (recurso
 * existe, não é energia, está ativo) é conferida no serviço.
 */

const RESOURCE_QUANTITY_MESSAGE =
  "Quantidade de recursos: informe um número inteiro maior ou igual a 1.";

/** Recursos SIMULTÂNEOS na etapa — capacidade, não o `resourceCount` de custo (§87). */
export const resourceQuantitySchema = z
  .number({ invalid_type_error: RESOURCE_QUANTITY_MESSAGE, required_error: RESOURCE_QUANTITY_MESSAGE })
  .int(RESOURCE_QUANTITY_MESSAGE)
  .min(1, RESOURCE_QUANTITY_MESSAGE)
  .max(PRODUCTION_STEP_LIMITS.maxResourceQuantity, RESOURCE_QUANTITY_MESSAGE);

function minutesSchema(rotulo: string) {
  const mensagem = `${rotulo}: informe minutos inteiros, de 0 a ${PRODUCTION_STEP_LIMITS.maxMinutes}.`;
  return z
    .number({ invalid_type_error: mensagem, required_error: mensagem })
    .int(mensagem)
    .min(0, mensagem)
    .max(PRODUCTION_STEP_LIMITS.maxMinutes, mensagem);
}

const stepResourceSchema = z.object({
  industrialResourceId: z.string().trim().min(1, "Selecione o recurso"),
  resourceQuantity: resourceQuantitySchema,
  notes: optionalNullableText(500),
});

const stepSchema = z
  .object({
    name: z.string().trim().min(1, "Informe o nome da etapa").max(120),
    description: optionalNullableText(1000),
    setupDurationMinutes: minutesSchema("Preparação"),
    runDurationMinutes: minutesSchema("Execução"),
    scalingMode: z.enum(["PROPORTIONAL", "BY_BATCH"]),
    resources: z.array(stepResourceSchema).max(PRODUCTION_STEP_LIMITS.maxResourcesPerStep).default([]),
  })
  // Etapa que não leva tempo nenhum não é etapa.
  .refine((etapa) => etapa.setupDurationMinutes + etapa.runDurationMinutes > 0, {
    message: "Informe o tempo de preparação ou o de execução da etapa.",
    path: ["runDurationMinutes"],
  });

export const listProductionProfilesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  /** `true`/`1`: só roteiros com versão ativa — os escolhíveis. */
  activeOnly: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((valor) => valor === "true" || valor === "1"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const createProductionProfileSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do perfil").max(200),
  description: optionalNullableText(1000),
  referenceQuantity: quantityDecimalSchema().optional(),
  referenceUomCode: z.string().trim().min(1).max(20).optional(),
});

export const updateProductionProfileIdentitySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: optionalNullableText(1000),
});

export const updateProductionProfileVersionSchema = z.object({
  referenceQuantity: quantityDecimalSchema().optional(),
  referenceUomCode: z.string().trim().min(1).max(20).optional(),
  notes: optionalNullableText(1000),
  /** Na ordem de execução: a posição vira a sequência (1, 2, 3…). */
  steps: z.array(stepSchema).max(PRODUCTION_STEP_LIMITS.maxSteps).optional(),
});

export const previewQuerySchema = z.object({ quantity: quantityDecimalSchema() });

export const setProductProductionProfileSchema = z.object({
  productionProfileVersionId: z.string().trim().min(1).nullable(),
});

export type ListProductionProfilesQuery = z.infer<typeof listProductionProfilesQuerySchema>;
export type CreateProductionProfileParsed = z.infer<typeof createProductionProfileSchema>;
export type UpdateProductionProfileIdentityParsed = z.infer<
  typeof updateProductionProfileIdentitySchema
>;
export type UpdateProductionProfileVersionParsed = z.infer<
  typeof updateProductionProfileVersionSchema
>;
