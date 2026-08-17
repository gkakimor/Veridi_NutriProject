import { z } from "zod";
import { normalizeCnpj } from "@veridi/shared";

/**
 * CNPJ opcional: normaliza para somente dígitos e valida formato básico
 * (14 dígitos). Não valida dígito verificador nem consulta a Receita.
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
  .refine((value) => value === undefined || value === null || value.length === 14, {
    message: "CNPJ deve conter 14 dígitos",
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
