import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { decimalStringSchema } from "../../lib/decimal-schema.js";

const formulationComponentInputSchema = z.object({
  itemId: z.string().trim().min(1, "Item é obrigatório"),
  quantity: decimalStringSchema(),
  unitCode: z.string().trim().min(1, "Unidade é obrigatória"),
  notes: z.string().trim().max(500).optional(),
});

export const listFormulationsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const createFormulationVersionSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
});

export const updateFormulationVersionSchema = z.object({
  basisQuantity: decimalStringSchema().optional(),
  notes: optionalNullableText(2000),
  components: z.array(formulationComponentInputSchema).optional(),
});

export type FormulationComponentInput = z.infer<typeof formulationComponentInputSchema>;
export type ListFormulationsQuery = z.infer<typeof listFormulationsQuerySchema>;
export type CreateFormulationVersionInput = z.infer<typeof createFormulationVersionSchema>;
export type UpdateFormulationVersionInput = z.infer<typeof updateFormulationVersionSchema>;
