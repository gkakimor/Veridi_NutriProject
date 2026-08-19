import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";

const decimalString = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .refine((value) => /^\d+(\.\d+)?$/.test(value), { message: "Valor inválido" });

const componentSchema = z.object({
  itemId: z.string().trim().min(1),
  quantity: decimalString,
  unitCode: z.string().trim().min(1).max(20),
  basis: z.enum(["FIXED_BASIS", "PER_DOSE", "PER_FINISHED_UNIT"]).optional(),
  supplyResponsibility: z.enum(["VERIDI", "CUSTOMER"]).optional(),
  purityPercentApplied: decimalString.nullish(),
  overagePercent: decimalString.nullish(),
  notes: optionalNullableText(500),
});

export const createFormulationTemplateSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do template").max(200),
  description: optionalNullableText(1000),
  basisQuantity: decimalString.optional(),
  outputUnitCode: z.string().trim().min(1).max(20).optional(),
  calculationMode: z.enum(["FIXED_BASIS", "PER_DOSE"]).optional(),
  dosesPerPackage: z.coerce.number().int().positive().nullish(),
});

export const updateFormulationTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: optionalNullableText(1000),
});

export const updateFormulationTemplateVersionSchema = z.object({
  basisQuantity: decimalString.optional(),
  outputUnitCode: z.string().trim().min(1).max(20).optional(),
  calculationMode: z.enum(["FIXED_BASIS", "PER_DOSE"]).optional(),
  dosesPerPackage: z.coerce.number().int().positive().nullish(),
  notes: optionalNullableText(1000),
  components: z.array(componentSchema).optional(),
});

export const archiveFormulationTemplateSchema = z.object({
  archived: z.boolean(),
});

/** Aplicar template ao produto — sempre cópia, nunca vínculo. */
export const applyFormulationTemplateSchema = z.object({
  formulationTemplateVersionId: z.string().trim().min(1),
});

export const createTemplateFromFormulationSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do template").max(200),
  description: optionalNullableText(1000),
});

export const listFormulationTemplatesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  archived: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : value === true || value === "true",
    ),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateFormulationTemplateInput = z.infer<typeof createFormulationTemplateSchema>;
export type UpdateFormulationTemplateInput = z.infer<typeof updateFormulationTemplateSchema>;
export type UpdateFormulationTemplateVersionInput = z.infer<
  typeof updateFormulationTemplateVersionSchema
>;
export type ApplyFormulationTemplateInput = z.infer<typeof applyFormulationTemplateSchema>;
export type CreateTemplateFromFormulationInput = z.infer<
  typeof createTemplateFromFormulationSchema
>;
export type ListFormulationTemplatesQuery = z.infer<typeof listFormulationTemplatesQuerySchema>;
