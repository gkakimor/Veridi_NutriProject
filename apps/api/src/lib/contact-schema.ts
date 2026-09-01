import { z } from "zod";
import { isValidBrPhone, isValidEmail, normalizePhone } from "@veridi/shared";

/**
 * E-mail opcional. Ausente não mexe no campo; vazio (ou `null`) limpa;
 * preenchido precisa ter formato válido.
 *
 * O `type="email"` do navegador é conveniência, não regra — a tela pode ser
 * contornada e a API não é chamada só pelo formulário.
 */
export const optionalEmailSchema = z
  .string()
  .trim()
  .max(200)
  .nullable()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return value.length === 0 ? null : value;
  })
  .superRefine((value, ctx) => {
    if (value === undefined || value === null) return;
    if (!isValidEmail(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "E-mail inválido." });
    }
  });

/**
 * Telefone brasileiro opcional. Guarda somente dígitos — a máscara
 * `(11) 99999-8888` é da UI, como já acontece com CEP e CNPJ.
 *
 * Quando preenchido exige DDD: 10 dígitos para fixo, 11 para celular.
 */
export const optionalBrPhoneSchema = z
  .string()
  .trim()
  .max(30)
  .nullable()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (value.length === 0) return null;
    return normalizePhone(value);
  })
  .superRefine((value, ctx) => {
    if (value === undefined || value === null) return;
    if (!isValidBrPhone(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Informe um telefone com DDD.",
      });
    }
  });
