import { z } from "zod";
import type { ProductionCalendarExceptionType } from "@veridi/shared";
import { MINUTOS_DO_DIA, PRODUCTION_CALENDAR_EXCEPTION_TYPES, ehDiaCivil } from "@veridi/shared";
import { optionalNullableText } from "../../lib/cnpj-schema.js";

/**
 * Contrato de entrada do Calendário de Produção (PLANNING-CALENDAR-01).
 *
 * A hora do dia entra como MINUTO DO DIA — inteiro de 0 a 1440 —, nunca como
 * `DateTime`: `08:00` não tem data nem fuso, e materializar um instante para
 * representá-la obrigaria a inventar os dois. A tela é que mostra `HH:mm`.
 *
 * A data de uma exceção entra como DATA CIVIL `YYYY-MM-DD`, o mesmo formato
 * que o `<input type="date">` envia e que a promessa de entrega (§75) já usa.
 * `z.coerce.date()` está fora de propósito: ele materializa a meia-noite UTC
 * como se fosse um instante, e foi assim que o período do Faturamento
 * terminava o dia antes de ele começar.
 */

const minutoDoDiaSchema = z.coerce
  .number()
  .int("Informe minutos inteiros")
  .min(0, "O horário começa em 00:00")
  .max(MINUTOS_DO_DIA, "O horário termina em 24:00");

const diasOperantesSchema = z.object({
  monday: z.boolean(),
  tuesday: z.boolean(),
  wednesday: z.boolean(),
  thursday: z.boolean(),
  friday: z.boolean(),
  saturday: z.boolean(),
  sunday: z.boolean(),
});

export const updateProductionCalendarSchema = z.object({
  startMinuteOfDay: minutoDoDiaSchema,
  endMinuteOfDay: minutoDoDiaSchema,
  breakMinutes: z.coerce
    .number()
    .int("Informe minutos inteiros")
    .min(0, "O intervalo nunca é negativo")
    .max(MINUTOS_DO_DIA, "O intervalo não passa de 24:00"),
  /*
   * ONDE o intervalo cai. Os dois campos são opcionais e viajam juntos: a
   * coerência entre eles — e com `breakMinutes` — é cobrada por
   * `validarConfiguracaoDeCalendario`, a MESMA regra que a tela usa e que o
   * banco confirma em CHECK. Aqui só se garante o formato.
   */
  breakStartMinuteOfDay: minutoDoDiaSchema.nullish().transform((v) => v ?? null),
  breakEndMinuteOfDay: minutoDoDiaSchema.nullish().transform((v) => v ?? null),
  weekdays: diasOperantesSchema,
});

/** `YYYY-MM-DD` bem formado E existente — `2026-02-30` não é data. */
const diaCivilSchema = z
  .string()
  .trim()
  .refine(ehDiaCivil, "Informe uma data existente, no formato AAAA-MM-DD");

/*
 * Literais inline, como o status da OP: é o que preserva o tipo estreito na
 * saída do Zod. A igualdade com a lista do `@veridi/shared` não fica no
 * comentário — `tiposCobertos` abaixo não compila se as duas divergirem.
 */
const exceptionTypeSchema = z.enum(["FERIADO", "RECESSO", "PARADA_OPERACIONAL", "OUTRO"]);

/* As duas atribuições só compilam se as listas forem a MESMA — uma cobre a
   outra nos dois sentidos. Divergir passa a ser erro de compilação, e não um
   400 descoberto em produção. */
const tiposDoContrato: ProductionCalendarExceptionType[] = [...exceptionTypeSchema.options];
const tiposDoEsquema: (typeof exceptionTypeSchema.options)[number][] = [
  ...PRODUCTION_CALENDAR_EXCEPTION_TYPES,
];
void tiposDoContrato;
void tiposDoEsquema;

export const listProductionCalendarExceptionsQuerySchema = z.object({
  from: diaCivilSchema.optional(),
  to: diaCivilSchema.optional(),
});

export const createProductionCalendarExceptionSchema = z.object({
  date: diaCivilSchema,
  type: exceptionTypeSchema,
  reason: optionalNullableText(500),
});

export const updateProductionCalendarExceptionSchema = z.object({
  type: exceptionTypeSchema.optional(),
  reason: optionalNullableText(500),
});

export type UpdateProductionCalendarParsed = z.infer<typeof updateProductionCalendarSchema>;
export type ListProductionCalendarExceptionsQuery = z.infer<
  typeof listProductionCalendarExceptionsQuerySchema
>;
export type CreateProductionCalendarExceptionParsed = z.infer<
  typeof createProductionCalendarExceptionSchema
>;
export type UpdateProductionCalendarExceptionParsed = z.infer<
  typeof updateProductionCalendarExceptionSchema
>;
