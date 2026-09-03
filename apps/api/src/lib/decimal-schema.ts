import { z } from "zod";

/**
 * Decimal como string — nunca usar float JS como fonte de precisao para
 * quantidade/preco. Aceita number tambem (conveniencia de payload), mas
 * sempre normaliza para string antes de repassar ao Prisma.
 *
 * ACEITA VIRGULA. O sistema inteiro e em portugues e a pessoa digita `0,85`;
 * antes disto o campo recusava com "Valor decimal invalido", que nao dizia
 * qual era o problema. A tela normaliza antes de enviar, e isto aqui e a
 * segunda linha: uma tela nova que esqueca de normalizar passa a funcionar em
 * vez de falhar de um jeito que ninguem entende.
 *
 * SEPARADOR DE MILHAR CONTINUA RECUSADO, de proposito. `1.234` e ambiguo — mil
 * duzentos e trinta e quatro para quem escreve em portugues, um virgula
 * duzentos e trinta e quatro para quem escreve o contrato. Adivinhar erra por
 * um fator de mil em silencio, num campo que costuma ser preco ou peso. Um
 * separador so, seja qual for, e sempre a casa decimal: a leitura que nunca
 * infla o numero.
 */

const AJUDA = "Use vírgula ou ponto para a casa decimal, sem separador de milhar.";

/** Normaliza para o formato canonico; devolve o texto original se nao der. */
function normalizarDecimal(texto: string): string {
  const virgulas = (texto.match(/,/g) ?? []).length;
  const pontos = (texto.match(/\./g) ?? []).length;
  if (virgulas + pontos > 1) return texto;
  return texto.replace(",", ".");
}

export function decimalStringSchema(options: { allowZero?: boolean } = {}) {
  return z
    .union([z.string(), z.number()])
    .transform((value) => normalizarDecimal(String(value).trim()))
    .refine((value) => /^\d+(\.\d+)?$/.test(value), {
      message: `Valor decimal inválido. ${AJUDA}`,
    })
    .refine((value) => (options.allowZero ? Number(value) >= 0 : Number(value) > 0), {
      message: options.allowZero
        ? "Valor não pode ser negativo"
        : "Valor deve ser maior que zero",
    });
}
