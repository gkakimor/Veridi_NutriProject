import { z } from "zod";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { decimalStringSchema } from "../../lib/decimal-schema.js";
import { optionalNullableDateSchema } from "../../lib/date-schema.js";

export const industrialResourceTypeSchema = z.enum(["LABOR", "EQUIPMENT", "ENERGY"]);
export const industrialRateUomSchema = z.enum(["HOUR", "KWH"]);

export const createIndustrialResourceSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do recurso").max(120),
  type: industrialResourceTypeSchema,
  description: optionalNullableText(500),
  // Ausente mantém a potência desconhecida — nunca zero.
  powerKw: decimalStringSchema().nullish(),
  notes: optionalNullableText(1000),
});

export const updateIndustrialResourceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: optionalNullableText(500),
  powerKw: decimalStringSchema().nullish(),
  notes: optionalNullableText(1000),
  active: z.boolean().optional(),
});

export const createResourceRateSchema = z.object({
  // Zero é uma tarifa explícita; desconhecida simplesmente não é registrada.
  rateValue: decimalStringSchema({ allowZero: true }),
  currencyCode: z.string().trim().min(3).max(3).optional(),
  rateUom: industrialRateUomSchema.optional(),
  effectiveAt: optionalNullableDateSchema,
  validUntil: optionalNullableDateSchema,
  notes: optionalNullableText(1000),
});

export const listResourcesQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  type: industrialResourceTypeSchema.optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateIndustrialResourceInput = z.infer<typeof createIndustrialResourceSchema>;
export type UpdateIndustrialResourceInput = z.infer<typeof updateIndustrialResourceSchema>;
export type CreateResourceRateInput = z.infer<typeof createResourceRateSchema>;
export type ListResourcesQuery = z.infer<typeof listResourcesQuerySchema>;
