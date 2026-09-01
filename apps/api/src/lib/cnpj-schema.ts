import { z } from "zod";
import { CNPJ_LENGTH, isValidCnpj, normalizeCnpj } from "@veridi/shared";

/**
 * CNPJ opcional: normaliza (remove pontuação, mantém letras, aplica
 * maiúsculas) e valida os dígitos verificadores.
 *
 * Aceita as duas formas em circulação — o numérico de sempre e o
 * alfanumérico da IN RFB nº 2.229/2024, cujas 12 primeiras posições podem
 * conter letras. Não consulta a Receita: o que se afirma aqui é que o número
 * é internamente consistente, não que a empresa existe.
 *
 * String vazia vira `null` (permite limpar um CNPJ existente em updates).
 */
export const optionalCnpjSchema = z
  .string()
  .trim()
  .max(30)
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value.length === 0) return null;
    return normalizeCnpj(value);
  })
  .superRefine((value, ctx) => {
    if (value === undefined || value === null) return;
    if (value.length !== CNPJ_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `CNPJ deve conter ${CNPJ_LENGTH} caracteres`,
      });
      return;
    }
    if (!isValidCnpj(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "CNPJ inválido" });
    }
  });

/**
 * Texto opcional: campo ausente não muda nada; string vazia **e `null`**
 * limpam o campo. Os formulários enviam `null` para "não preenchido" — sem
 * aceitar `null` aqui, deixar um campo opcional em branco derruba o salvamento
 * inteiro com "Expected string, received null".
 */
export function optionalNullableText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      return value.length === 0 ? null : value;
    });
}
