import { z } from "zod";

/**
 * Inteiro que chega à API como texto ou número — API-INT-COERCION-01.
 *
 * `Number(texto)` não é leitura de inteiro: aceita `"1e2"` (100), `"0x1E"` (30),
 * `"+1"`, `"1.0"`, `" "` (0) e `true` (1). A tela não manda nada disso desde
 * QUOTE-INT-FIELDS-01 e PROJECT-INT-FIELDS-01, mas o contrato é da API, e outro
 * cliente dela gravava 100 doses por embalagem mandando `"1e2"`.
 *
 * O contrato é a representação decimal inteira canônica: dígitos, com sinal de
 * menos opcional, e espaço nas pontas tolerado. Número JSON vale quando já é
 * inteiro seguro. Separador de milhar e vírgula são da tela (pt-BR), nunca
 * daqui. Faixa — maior que zero, teto — continua sendo de cada campo.
 */
const INTEIRO_DECIMAL = /^-?\d+$/;

/** O inteiro de `valor`, ou `null` quando ele não é um inteiro decimal canônico. */
export function lerInteiroDecimal(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isSafeInteger(valor) ? valor : null;
  if (typeof valor !== "string") return null;
  const texto = valor.trim();
  if (!INTEIRO_DECIMAL.test(texto)) return null;
  const inteiro = Number(texto);
  return Number.isSafeInteger(inteiro) ? inteiro : null;
}

/**
 * Substituto estrito de `z.coerce.number().int()` para campo de escrita: o que
 * não é inteiro decimal canônico é recusado antes de qualquer faixa.
 */
export function inteiroDecimalSchema(message = "Informe um número inteiro") {
  return z.union([z.string(), z.number()]).transform((valor, ctx) => {
    const inteiro = lerInteiroDecimal(valor);
    if (inteiro === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return inteiro;
  });
}

/**
 * Inteiro de query string com faixa e padrão — API-PAGINATION-COERCION-01.
 *
 * `page` e `pageSize` das listagens liam `Number()`: `?page=1e1` abria a página
 * 10 e `?pageSize=0x10` devolvia 16 linhas. A leitura agora é a mesma da
 * escrita; ausente continua sendo o padrão, e faixa inválida continua 400.
 */
export function inteiroDeConsultaSchema(faixa: { minimo: number; maximo?: number; padrao: number }) {
  let limites = z.number().int().min(faixa.minimo);
  if (faixa.maximo !== undefined) limites = limites.max(faixa.maximo);
  return inteiroDecimalSchema().pipe(limites).default(faixa.padrao);
}
