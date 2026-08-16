import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { decimalStringSchema } from "../../lib/decimal-schema.js";
import { requiredDateSchema } from "../../lib/date-schema.js";

export const createSampleSchema = z.object({
  description: optionalNullableText(500),
  productionNotes: optionalNullableText(2000),
  outputUomCode: optionalNullableText(20),
});

export const registerSampleConsumptionSchema = z.object({
  itemId: z.string().trim().min(1, "Item é obrigatório"),
  /** Aceita `LT-…` ou o payload do QR do lote — mesma normalização do Picking. */
  lotCode: z.string().trim().min(1).optional(),
  quantity: decimalStringSchema(),
  notes: z.string().trim().max(500).optional(),
});

export const produceSampleSchema = z.object({
  outputQuantity: decimalStringSchema(),
  outputUomCode: z.string().trim().min(1, "Unidade é obrigatória"),
  productionNotes: optionalNullableText(2000),
  // Confirmação consciente para amostra sem consumo registrado.
  confirmWithoutConsumption: z.boolean().optional(),
});

export const sampleDecisionSchema = z.object({
  decisionNotes: z.string().trim().max(2000).optional(),
});

export const listSamplesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  status: z
    .enum(["DRAFT", "IN_PROGRESS", "PRODUCED", "APPROVED", "REJECTED", "CANCELLED"])
    .optional(),
  producedFrom: requiredDateSchema.optional(),
  producedTo: requiredDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateSampleInput = z.infer<typeof createSampleSchema>;
export type RegisterSampleConsumptionInput = z.infer<typeof registerSampleConsumptionSchema>;
export type ProduceSampleInput = z.infer<typeof produceSampleSchema>;
export type SampleDecisionInput = z.infer<typeof sampleDecisionSchema>;
export type ListSamplesQuery = z.infer<typeof listSamplesQuerySchema>;
