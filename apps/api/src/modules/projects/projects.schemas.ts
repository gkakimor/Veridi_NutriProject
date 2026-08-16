import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { requiredDateSchema } from "../../lib/date-schema.js";

const statusEnum = z.enum(["WAITING", "SAMPLE", "APPROVED", "CANCELLED", "STAND_BY"]);
const cancelReasonEnum = z.enum(["PRICE", "COMPETITOR", "PROJECT_CHANGED", "NOT_MET", "OTHER"]);

/** Decimal opcional que aceita `null` explícito (limpar o campo). */
const optionalDecimal = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const text = String(value).trim();
    return text === "" ? null : text;
  })
  .refine((value) => value === undefined || value === null || /^\d+(\.\d+)?$/.test(value), {
    message: "Valor inválido (não pode ser negativo)",
  });

const optionalPositiveInt = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    return Number(value);
  })
  .refine((value) => value === undefined || value === null || (Number.isInteger(value) && value > 0), {
    message: "Informe um número inteiro maior que zero",
  });

/**
 * Conceito e canal são vocabulário ABERTO: texto livre com sugestão pelos
 * valores já usados. Nunca enum — o vocabulário do negócio evolui.
 */
const projectBaseFields = {
  name: z.string().trim().min(3, "Nome do projeto é obrigatório").max(200),
  concept: optionalNullableText(120),
  channel: optionalNullableText(120),
  externalCode: optionalNullableText(40),
  responsibleUserId: z.string().trim().min(1).nullish(),
  entryDate: requiredDateSchema.optional(),
  notes: optionalNullableText(2000),
  dosageForm: z.enum(["CAPSULE", "POWDER", "TABLET", "LIQUID", "OTHER"]).nullish(),
  presentationType: z.enum(["POT", "POUCH", "CARTON", "BULK", "BOTTLE", "OTHER"]).nullish(),
  doseAmount: optionalDecimal,
  doseUomCode: optionalNullableText(20),
  dosesPerPackage: optionalPositiveInt,
  targetAgeGroup: z.enum(["ADULT", "CHILD", "PREGNANT", "LACTATING", "OTHER"]).nullish(),
  minimumBatchQuantity: optionalDecimal,
  shelfLifeMonths: optionalPositiveInt,
};

export const createProjectSchema = z.object({
  customerId: z.string().trim().min(1, "Cliente é obrigatório"),
  ...projectBaseFields,
});

export const updateProjectSchema = z.object({
  customerId: z.string().trim().min(1).optional(),
  ...projectBaseFields,
  name: projectBaseFields.name.optional(),
});

export const changeProjectStatusSchema = z.object({
  status: statusEnum,
  reason: z.string().trim().max(500).optional(),
});

export const cancelProjectSchema = z.object({
  cancelReason: cancelReasonEnum,
  cancelReasonDetails: z.string().trim().max(1000).optional(),
});

export const approveProjectSchema = z.object({
  finishedUnitCode: z.string().trim().min(1).optional(),
});

export const listProjectsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  status: statusEnum.optional(),
  channel: z.string().trim().min(1).optional(),
  concept: z.string().trim().min(1).optional(),
  responsibleUserId: z.string().trim().min(1).optional(),
  entryFrom: requiredDateSchema.optional(),
  entryTo: requiredDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const updateQuoteVersionSchema = z.object({
  quoteDate: requiredDateSchema.optional(),
  validUntil: requiredDateSchema.nullish(),
  quotedQuantity: optionalDecimal,
  uomCode: optionalNullableText(20),
  // Preço `null` = ainda não precificado; `0` é preço zero explícito.
  unitPrice: optionalDecimal,
  currencyCode: z.string().trim().length(3).optional(),
  commercialNotes: optionalNullableText(2000),
  paymentTerms: optionalNullableText(500),
  leadTimeDays: optionalPositiveInt,
});

export const rejectQuoteSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ChangeProjectStatusInput = z.infer<typeof changeProjectStatusSchema>;
export type CancelProjectInput = z.infer<typeof cancelProjectSchema>;
export type ApproveProjectInput = z.infer<typeof approveProjectSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
export type UpdateQuoteVersionInput = z.infer<typeof updateQuoteVersionSchema>;
export type RejectQuoteInput = z.infer<typeof rejectQuoteSchema>;
