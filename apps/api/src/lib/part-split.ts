import { Prisma } from "@prisma/client";
import {
  partShare as rateioDaParte,
  splitDecimal as ratearEmPartes,
} from "@veridi/shared";
// Precisão canônica do motor decimal — `PRODUCT_RULES.md` §59.
import "./decimal.js";

/**
 * Divisão determinística de uma quantidade em N partes.
 *
 * DELEGA para `@veridi/shared`, e não repete a conta. O documento impresso da
 * Ordem de Produção precisa do MESMO rateio que a execução usa, e dividir de
 * novo no navegador criaria um segundo motor — que foi exatamente o defeito do
 * #21. A regra (escala 6, `ROUND_DOWN`, última parte absorvendo o resto) está
 * no pacote compartilhado, uma vez só.
 *
 * O que sobra aqui é a fronteira de tipo: a API fala `Prisma.Decimal`, o
 * pacote compartilhado fala `decimal.js`. São construtores diferentes da mesma
 * biblioteca, com a mesma precisão canônica, e a travessia é por texto.
 */
export function splitDecimal(total: Prisma.Decimal, parts: number): Prisma.Decimal[] {
  return ratearEmPartes(total.toString(), parts).map(
    (parte) => new Prisma.Decimal(parte.toString()),
  );
}

/** Quantidade planejada de UMA parte específica (1-based). */
export function partShare(
  total: Prisma.Decimal,
  parts: number,
  partNumber: number,
): Prisma.Decimal {
  return new Prisma.Decimal(rateioDaParte(total.toString(), parts, partNumber).toString());
}
