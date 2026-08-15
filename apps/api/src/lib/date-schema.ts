import { z } from "zod";

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
