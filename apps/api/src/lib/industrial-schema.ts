import { z } from "zod";
import { BR_STATE_CODES } from "@veridi/shared";
import {
  CASAS_PERCENTUAL_TECNICO,
  casasDecimais,
  mensagemCasasPercentualTecnico,
} from "./decimal-schema.js";

/**
 * Validações do cadastro industrial (capacidade 33).
 *
 * Regra transversal: campo ausente = não mexe; `""`/`null` = limpa;
 * valor = grava. Nada aqui é obrigatório, mas o que vier precisa ser
 * coerente — a validação vive no backend, nunca só no formulário.
 */

/** Enum opcional e limpável: `""` vira `null`. */
export function optionalEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .union([z.enum(values), z.literal("")])
    .nullish()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null || value === "") return null;
      return value;
    });
}

/**
 * Inteiro positivo opcional e limpável. `0` e negativos são rejeitados:
 * "zero dose por embalagem" não é um dado, é um erro.
 *
 * Campo VAZIO é limpeza, não zero. A união com `z.coerce.number()` resolvia
 * `""` pela coerção antes de chegar ao literal — `Number("")` é `0` —, então
 * um formulário que devolvia o campo vazio como veio era recusado por
 * "maior que zero". O efeito prático era pior que o sintoma: um produto que
 * nasceu sem Unidades por caixa não podia mais ter NENHUM outro campo
 * editado. Tratar cada caso explicitamente mantém as três leituras separadas:
 * ausente = não mexe, vazio = limpa, `0` = erro de quem digitou.
 */
export function optionalPositiveInt(message: string) {
  return z
    .any()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      if (typeof value === "string" && value.trim() === "") return null;

      const numero = typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isFinite(numero) || !Number.isInteger(numero)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Informe um número inteiro" });
        return z.NEVER;
      }
      if (numero <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
      return numero;
    });
}

/**
 * Decimal positivo opcional, mantido como STRING até o Prisma — nunca
 * passa por float JS.
 */
export function optionalPositiveDecimal(message: string) {
  return z
    .union([z.string(), z.number()])
    .nullish()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const text = String(value).trim();
      return text.length === 0 ? null : text;
    })
    .refine((value) => value === undefined || value === null || /^\d+(\.\d+)?$/.test(value), {
      message: "Valor decimal inválido",
    })
    .refine((value) => value === undefined || value === null || Number(value) > 0, { message });
}

/**
 * Pureza em porcentagem: `0 < x <= 100`. `null` significa DESCONHECIDA e
 * nunca deve virar 100% em lugar nenhum do sistema.
 *
 * A FAIXA é regra de negócio e a PRECISÃO é regra de armazenamento — duas
 * coisas independentes. A coluna passou a `DECIMAL(9,6)` no PREC-MIG-C e
 * suporta até 999,999999, e isso não autoriza pureza acima de 100: quem manda
 * na faixa continua sendo o domínio. O que muda aqui é só o limite de casas,
 * que existe para o valor não ser arredondado em silêncio pelo PostgreSQL.
 */
export const optionalPurityPercent = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const text = String(value).trim();
    return text.length === 0 ? null : text;
  })
  .refine((value) => value === undefined || value === null || /^\d+(\.\d+)?$/.test(value), {
    message: "Pureza inválida",
  })
  .refine(
    (value) => value === undefined || value === null || (Number(value) > 0 && Number(value) <= 100),
    { message: "Pureza deve ser maior que 0 e no máximo 100" },
  )
  .refine(
    (value) =>
      value === undefined || value === null || casasDecimais(value) <= CASAS_PERCENTUAL_TECNICO,
    { message: mensagemCasasPercentualTecnico() },
  );

/** CEP: guarda somente dígitos; a máscara `00000-000` é apresentação. */
export const optionalZipCode = z
  .string()
  .trim()
  .max(20)
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    const digits = value.replace(/\D/g, "");
    return digits.length === 0 ? null : digits;
  })
  .refine((value) => value === undefined || value === null || value.length === 8, {
    message: "CEP deve ter 8 dígitos",
  });

/**
 * UF brasileira: guarda sempre em maiúscula, vazio vira `null`.
 *
 * Mora ao lado do CEP porque é a outra metade do mesmo endereço, e endereço
 * de cadastro é um só modelo no sistema — Cliente e Fornecedor validam a UF
 * pela MESMA regra, nunca uma mais rígida que a outra.
 */
export const optionalBrState = z
  .string()
  .trim()
  .max(2)
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return value.length === 0 ? null : value.toUpperCase();
  })
  .refine(
    (value) =>
      value === undefined ||
      value === null ||
      (BR_STATE_CODES as readonly string[]).includes(value),
    { message: "UF inválida" },
  );
