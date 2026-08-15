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

/** Texto opcional: string vazia vira `null` (limpa o campo em updates). */
export function optionalNullableText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      return value.length === 0 ? null : value;
    });
}
