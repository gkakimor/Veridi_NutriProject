import { z } from "zod";
import { inteiroDeConsultaSchema, inteiroDecimalSchema } from "../../lib/integer-schema.js";
import { optionalNullableText } from "../../lib/cnpj-schema.js";
import { decimalStringSchema } from "../../lib/decimal-schema.js";
import { optionalNullableDateSchema } from "../../lib/date-schema.js";

export const industrialResourceTypeSchema = z.enum(["LABOR", "EQUIPMENT", "ENERGY"]);
export const industrialRateUomSchema = z.enum(["HOUR", "KWH"]);

/*
 * Quantos deste recurso trabalham AO MESMO TEMPO. Ausente ou `null` mantém a
 * capacidade NÃO CADASTRADA — que não é zero: zero descreveria uma fábrica
 * sem o recurso, e para isso já existe `active`. Leitura de inteiro decimal
 * (API-INT-COERCION-REMAINING-01): `"1e1"` não é 10.
 */
const capacityQuantitySchema = inteiroDecimalSchema("Informe um número inteiro")
  .pipe(
    z
      .number()
      .min(1, "A capacidade começa em 1")
      .max(100000, "Capacidade acima do razoável para um recurso"),
  )
  .nullish();

export const createIndustrialResourceSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do recurso").max(120),
  type: industrialResourceTypeSchema,
  description: optionalNullableText(500),
  // Ausente mantém a potência desconhecida — nunca zero.
  powerKw: decimalStringSchema().nullish(),
  capacityQuantity: capacityQuantitySchema,
  notes: optionalNullableText(1000),
});

export const updateIndustrialResourceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: optionalNullableText(500),
  powerKw: decimalStringSchema().nullish(),
  capacityQuantity: capacityQuantitySchema,
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
  page: inteiroDeConsultaSchema({ minimo: 1, padrao: 1 }),
  /* Seletor de tela carrega o catálogo inteiro num <select>; com teto de
   100 o cadastro 101 em diante ficava impossível de escolher. */
  pageSize: inteiroDeConsultaSchema({ minimo: 1, maximo: 1000, padrao: 20 }),
});

export type CreateIndustrialResourceInput = z.infer<typeof createIndustrialResourceSchema>;
export type UpdateIndustrialResourceInput = z.infer<typeof updateIndustrialResourceSchema>;
export type CreateResourceRateInput = z.infer<typeof createResourceRateSchema>;
export type ListResourcesQuery = z.infer<typeof listResourcesQuerySchema>;
