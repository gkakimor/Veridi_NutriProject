import { z } from "zod";
import { CNPJ_LENGTH, CNPJ_LOOKUP_PROVIDERS, isValidCnpj, normalizeCnpj } from "@veridi/shared";

/**
 * O CNPJ consultado, no caminho da rota.
 *
 * Usa o normalizador e o validador CANÔNICOS do sistema
 * (`@veridi/shared/cnpj`), os mesmos do cadastro: a consulta não pode aceitar
 * um número que o cadastro recusaria, nem o contrário. Não existe segundo
 * algoritmo de CNPJ no repositório.
 *
 * Validar ANTES é também a proteção da rota: nenhum texto arbitrário chega ao
 * provedor externo, e uma requisição sem CNPJ válido morre aqui, sem sair da
 * máquina.
 */
const cnpjParamSchema = z
  .string()
  .trim()
  .max(30)
  .transform((value) => normalizeCnpj(value))
  .superRefine((value, ctx) => {
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

export const cnpjLookupParamsSchema = z.object({ cnpj: cnpjParamSchema });

/**
 * A fonte. Só o que está no registro conhecido passa — a Web não escolhe URL,
 * host nem provedor arbitrário, e isto aqui não é um proxy genérico.
 *
 * Ausente vale OpenCNPJ, que é o único provedor de hoje; quando houver dois,
 * a tela manda sempre o escolhido e o default deixa de ter efeito prático.
 */
export const cnpjLookupQuerySchema = z.object({
  provider: z
    .enum(CNPJ_LOOKUP_PROVIDERS, {
      errorMap: () => ({ message: "Fonte de consulta inválida" }),
    })
    .optional(),
});

export type CnpjLookupParams = z.infer<typeof cnpjLookupParamsSchema>;
export type CnpjLookupQuery = z.infer<typeof cnpjLookupQuerySchema>;
