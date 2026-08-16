import { Prisma } from "@prisma/client";

/**
 * Divisão determinística de uma quantidade em N partes, em Decimal.
 *
 * Nunca float: 10 kg em 3 partes não pode virar 3.3333333333333335. Cada
 * parte é arredondada para a escala operacional e a ÚLTIMA absorve o resto,
 * de modo que a soma das partes seja EXATAMENTE o total planejado.
 */
const SCALE = 6;

export function splitDecimal(total: Prisma.Decimal, parts: number): Prisma.Decimal[] {
  if (parts <= 1) return [total];

  const per = total.dividedBy(parts).toDecimalPlaces(SCALE, Prisma.Decimal.ROUND_DOWN);
  const result: Prisma.Decimal[] = [];
  let allocated = new Prisma.Decimal(0);

  for (let index = 0; index < parts - 1; index += 1) {
    result.push(per);
    allocated = allocated.plus(per);
  }
  // A última parte fecha a conta: o resto da divisão vive aqui, sempre.
  result.push(total.minus(allocated));

  return result;
}

/** Quantidade planejada de UMA parte específica (1-based). */
export function partShare(
  total: Prisma.Decimal,
  parts: number,
  partNumber: number,
): Prisma.Decimal {
  const shares = splitDecimal(total, parts);
  return shares[partNumber - 1] ?? new Prisma.Decimal(0);
}
