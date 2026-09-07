import { Decimal, type DecimalInstance, type DecimalValue } from "./decimal-config.js";

/**
 * Divisão determinística de uma quantidade em N partes, em Decimal.
 *
 * Nunca float: 10 kg em 3 partes não pode virar 3.3333333333333335. Cada
 * parte é arredondada para a escala operacional e a ÚLTIMA absorve o resto,
 * de modo que a soma das partes seja EXATAMENTE o total planejado.
 *
 * A conta vivia só em `apps/api`, e o documento impresso da Ordem de Produção
 * dividia por conta própria — `Number(total) / partes` com `toFixed(6)`. Duas
 * contas para o mesmo número acabaram discordando: 2 kg em 3 partes o motor
 * planeja como 0,666666 / 0,666666 / 0,666668, e o papel anunciava 0,666667
 * nas três — um valor que parte nenhuma seria pesada, somando 2,000001. A
 * Folha de Receita, que é o documento de execução da pesagem, dizia outra
 * coisa sobre a mesma ordem.
 *
 * Por isso a função está AQUI, no pacote compartilhado, e a API delega para
 * ela. Não é uma cópia sincronizada: é a mesma função. `decimal.js` é a mesma
 * biblioteca que o `Prisma.Decimal` usa por dentro, então os dois lados fazem
 * aritmética idêntica — nenhum float participa.
 */

/**
 * Escala operacional do rateio: seis casas.
 *
 * É o que a balança do chão de fábrica lê e o que a quantidade exibe
 * (`PRODUCT_RULES.md` §65). Não é escala de armazenamento — a soma das partes
 * continua fechando com o total em `DECIMAL(24,12)`, porque o resto não é
 * descartado, é atribuído.
 */
export const ESCALA_RATEIO_POR_PARTE = 6;

export function splitDecimal(total: DecimalValue, parts: number): DecimalInstance[] {
  const totalDecimal = new Decimal(total);
  if (parts <= 1) return [totalDecimal];

  /*
   * `ROUND_DOWN`, e não o `ROUND_HALF_UP` das fronteiras de persistência.
   * Arredondar para cima aqui faria as N-1 primeiras partes somarem MAIS que o
   * total, e a última — que absorve o resto — nasceria menor que as outras ou
   * negativa. Truncar garante que a sobra seja sempre não-negativa.
   */
  const per = totalDecimal
    .dividedBy(parts)
    .toDecimalPlaces(ESCALA_RATEIO_POR_PARTE, Decimal.ROUND_DOWN);
  const result: DecimalInstance[] = [];
  let allocated = new Decimal(0);

  for (let index = 0; index < parts - 1; index += 1) {
    result.push(per);
    allocated = allocated.plus(per);
  }
  // A última parte fecha a conta: o resto da divisão vive aqui, sempre.
  result.push(totalDecimal.minus(allocated));

  return result;
}

/** Quantidade planejada de UMA parte específica (1-based). */
export function partShare(
  total: DecimalValue,
  parts: number,
  partNumber: number,
): DecimalInstance {
  const shares = splitDecimal(total, parts);
  return shares[partNumber - 1] ?? new Decimal(0);
}
