import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { decimalStringSchema } from "../../lib/decimal-schema.js";
import {
  optionalPositiveInt,
  optionalPurityPercent,
} from "../../lib/industrial-schema.js";

/** Overage: 0 é legítimo (declarar "sem perda"); negativo nunca é. */
const optionalOveragePercent = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const text = String(value).trim();
    return text.length === 0 ? null : text;
  })
  .refine((value) => value === undefined || value === null || /^\d+(\.\d+)?$/.test(value), {
    message: "Overage inválido",
  });

const optionalLegacyDecimal = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const text = String(value).trim();
    return text.length === 0 ? null : text;
  });

const formulationComponentInputSchema = z.object({
  itemId: z.string().trim().min(1, "Item é obrigatório"),
  quantity: decimalStringSchema(),
  unitCode: z.string().trim().min(1, "Unidade é obrigatória"),
  basis: z.enum(["FIXED_BASIS", "PER_DOSE", "PER_FINISHED_UNIT"]).optional(),
  supplyResponsibility: z.enum(["VERIDI", "CUSTOMER"]).optional(),
  // Pureza: mesma regra do cadastro — 0 < x <= 100, null = desconhecida.
  purityPercentApplied: optionalPurityPercent,
  overagePercent: optionalOveragePercent,
  legacyTotalQuantity: optionalLegacyDecimal,
  legacyTotalUnitCode: z.string().trim().max(20).nullish(),
  legacyBatchUnits: optionalLegacyDecimal,
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
  calculationMode: z.enum(["FIXED_BASIS", "PER_DOSE"]).optional(),
  dosesPerPackage: optionalPositiveInt("Doses por embalagem deve ser maior que zero"),
  notes: optionalNullableText(2000),
  components: z.array(formulationComponentInputSchema).optional(),
});

export type FormulationComponentInput = z.infer<typeof formulationComponentInputSchema>;
export type ListFormulationsQuery = z.infer<typeof listFormulationsQuerySchema>;
export type CreateFormulationVersionInput = z.infer<typeof createFormulationVersionSchema>;
export type UpdateFormulationVersionInput = z.infer<typeof updateFormulationVersionSchema>;
