import { z } from "zod";
import type {
  DiaDaSemana,
  ProductionCalendarExceptionOperation,
  ProductionCalendarExceptionType,
} from "@veridi/shared";
import {
  DIAS_DA_SEMANA,
  MINUTOS_DO_DIA,
  PRODUCTION_CALENDAR_EXCEPTION_OPERATIONS,
  PRODUCTION_CALENDAR_EXCEPTION_TYPES,
  ehDiaCivil,
} from "@veridi/shared";
import { optionalNullableText } from "../../lib/cnpj-schema.js";

/**
 * Contrato de entrada do Calendário de Produção (PLANNING-CALENDAR-01, jornada
 * semanal desde PLANNING-CALENDAR-WEEKLY-SCHEDULE-01).
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
 *
 * Aqui só se garante o FORMATO. A coerência entre início, fim e intervalo é
 * cobrada por `validarDiaDaSemana`/`validarExcecao`, a MESMA regra que a tela
 * usa e que o banco confirma em CHECK.
 */

const minutoDoDiaSchema = z.coerce
  .number()
  .int("Informe minutos inteiros")
  .min(0, "O horário começa em 00:00")
  .max(MINUTOS_DO_DIA, "O horário termina em 24:00");

/*
 * Campo em branco é "não informado", nunca 00:00: `z.coerce.number()` sozinho
 * transforma `""` em 0, e um horário apagado viraria meia-noite em silêncio.
 * `undefined` continua `undefined` — na edição de exceção é ele que diz "campo
 * ausente".
 */
const vazioComoNulo = (valor: unknown) =>
  typeof valor === "string" && valor.trim() === "" ? null : valor;

const minutoAnulavelSchema = z.preprocess(vazioComoNulo, minutoDoDiaSchema.nullish());

/** Horário opcional: ausente, `null` e em branco são a mesma resposta — não informado. */
const minutoOpcionalSchema = minutoAnulavelSchema.transform((v) => v ?? null);

/*
 * Literais inline: é o que preserva o tipo estreito na saída do Zod. A
 * igualdade com as listas do `@veridi/shared` não fica no comentário — as
 * atribuições abaixo não compilam se as duas divergirem.
 */
const weekdayEnumSchema = z.enum([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);
/** Na URL, `friday` e `FRIDAY` são o mesmo dia. */
const diaDaSemanaSchema = z
  .string()
  .trim()
  .transform((valor) => valor.toUpperCase())
  .pipe(weekdayEnumSchema);
const exceptionTypeSchema = z.enum(["FERIADO", "RECESSO", "PARADA_OPERACIONAL", "OUTRO"]);
const exceptionOperationSchema = z.enum(["SEM_OPERACAO", "HORARIO_ESPECIAL"]);

const diasDoContrato: DiaDaSemana[] = [...weekdayEnumSchema.options];
const diasDoEsquema: (typeof weekdayEnumSchema.options)[number][] = [...DIAS_DA_SEMANA];
const tiposDoContrato: ProductionCalendarExceptionType[] = [...exceptionTypeSchema.options];
const tiposDoEsquema: (typeof exceptionTypeSchema.options)[number][] = [
  ...PRODUCTION_CALENDAR_EXCEPTION_TYPES,
];
const funcionamentosDoContrato: ProductionCalendarExceptionOperation[] = [
  ...exceptionOperationSchema.options,
];
const funcionamentosDoEsquema: (typeof exceptionOperationSchema.options)[number][] = [
  ...PRODUCTION_CALENDAR_EXCEPTION_OPERATIONS,
];
void diasDoContrato;
void diasDoEsquema;
void tiposDoContrato;
void tiposDoEsquema;
void funcionamentosDoContrato;
void funcionamentosDoEsquema;

export const weekdayParamsSchema = z.object({ weekday: diaDaSemanaSchema });

/** UMA linha da jornada semanal. As outras seis não viajam e não mudam. */
export const updateProductionCalendarWeekdaySchema = z.object({
  enabled: z.boolean(),
  startMinuteOfDay: minutoOpcionalSchema,
  endMinuteOfDay: minutoOpcionalSchema,
  breakStartMinuteOfDay: minutoOpcionalSchema,
  breakEndMinuteOfDay: minutoOpcionalSchema,
});

/** `YYYY-MM-DD` bem formado E existente — `2026-02-30` não é data. */
const diaCivilSchema = z
  .string()
  .trim()
  .refine(ehDiaCivil, "Informe uma data existente, no formato AAAA-MM-DD");

export const listProductionCalendarExceptionsQuerySchema = z.object({
  from: diaCivilSchema.optional(),
  to: diaCivilSchema.optional(),
});

/** Sem `operation`, a exceção é SEM_OPERACAO — o que toda exceção era até aqui. */
export const createProductionCalendarExceptionSchema = z.object({
  date: diaCivilSchema,
  type: exceptionTypeSchema,
  reason: optionalNullableText(500),
  operation: exceptionOperationSchema.default("SEM_OPERACAO"),
  startMinuteOfDay: minutoOpcionalSchema,
  endMinuteOfDay: minutoOpcionalSchema,
  breakStartMinuteOfDay: minutoOpcionalSchema,
  breakEndMinuteOfDay: minutoOpcionalSchema,
});

const CAMPOS_DE_HORARIO = [
  "startMinuteOfDay",
  "endMinuteOfDay",
  "breakStartMinuteOfDay",
  "breakEndMinuteOfDay",
] as const;

/**
 * Edição. Com `operation`, o funcionamento inteiro é substituído e horário
 * omitido vira nulo. Horário SEM `operation` é recusado: meia troca de
 * funcionamento — só o fim, sem dizer se o dia opera — é pior que nenhuma.
 */
export const updateProductionCalendarExceptionSchema = z
  .object({
    type: exceptionTypeSchema.optional(),
    reason: optionalNullableText(500),
    operation: exceptionOperationSchema.optional(),
    startMinuteOfDay: minutoAnulavelSchema,
    endMinuteOfDay: minutoAnulavelSchema,
    breakStartMinuteOfDay: minutoAnulavelSchema,
    breakEndMinuteOfDay: minutoAnulavelSchema,
  })
  .refine(
    (entrada) =>
      entrada.operation !== undefined ||
      CAMPOS_DE_HORARIO.every((campo) => entrada[campo] === undefined),
    { message: "Informe o funcionamento junto com o horário.", path: ["operation"] },
  );

export type WeekdayParams = z.infer<typeof weekdayParamsSchema>;
export type UpdateProductionCalendarWeekdayParsed = z.infer<
  typeof updateProductionCalendarWeekdaySchema
>;
export type ListProductionCalendarExceptionsQuery = z.infer<
  typeof listProductionCalendarExceptionsQuerySchema
>;
export type CreateProductionCalendarExceptionParsed = z.infer<
  typeof createProductionCalendarExceptionSchema
>;
export type UpdateProductionCalendarExceptionParsed = z.infer<
  typeof updateProductionCalendarExceptionSchema
>;
