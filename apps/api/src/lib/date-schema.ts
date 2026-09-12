import { z } from "zod";
import { ehDiaCivil } from "@veridi/shared";

/** Data obrigatoria. */
export const requiredDateSchema = z.coerce.date({
  errorMap: () => ({ message: "Data inválida" }),
});

/** Data opcional e limpavel: chave ausente = nao mexe; "" = null; valor = seta. */
export const optionalNullableDateSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value.length === 0) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date(NaN) : parsed;
  })
  .refine((value) => value === undefined || value === null || !Number.isNaN(value.getTime()), {
    message: "Data inválida",
  });

/**
 * Dia civil de FILTRO operacional — `YYYY-MM-DD`, e nunca um instante.
 *
 * `z.coerce.date()` NÃO serve aqui, e foi essa a causa do bug do período do
 * Faturamento: ele materializa `2026-09-10` como `2026-09-10T00:00:00.000Z`,
 * que em São Paulo é 21h do dia 09. Com esse valor num `lte`, "até 10/09"
 * encerrava o dia três horas antes de ele começar.
 *
 * O que chega aqui continua sendo o dia que a pessoa escolheu, em texto. Quem
 * o transforma em instantes é `intervaloDeDiasComerciais`, no serviço — uma
 * conversão, num lugar, com o fuso da operação.
 */
export const diaCivilDeFiltroSchema = z
  .string()
  .trim()
  .refine((valor) => valor === "" || ehDiaCivil(valor), {
    message: "Data inválida (use AAAA-MM-DD)",
  })
  // String vazia é "filtro não preenchido", não data zero: o `<input
  // type="date">` limpo vira `?dateFrom=` em vez de desaparecer da URL.
  .transform((valor) => (valor === "" ? undefined : valor))
  .optional();
