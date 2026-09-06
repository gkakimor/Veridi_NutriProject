import type { Prisma } from "@prisma/client";
import "./decimal.js";

/**
 * Serialização de grandeza técnica na fronteira da API.
 *
 * A regra, de `PRODUCT_RULES.md` §57 e da auditoria PREC-01: **o DTO devolve o
 * scale da coluna, nem mais nem menos**. Menos é perda silenciosa — a migration
 * PREC-MIG-A seria inútil se a API continuasse cortando em seis casas o que o
 * banco passou a guardar em doze. Mais é pior: afirmar precisão que a coluna
 * não tem.
 *
 * Por isso este módulo tem uma função por escala em uso, e não uma função
 * "genérica" com a escala vindo de quem chama — o ponto é justamente que a
 * escolha da escala pertence à categoria do campo, não ao call site.
 *
 * Quantidade continua saindo por `.toString()` nos serviços: `Decimal.toString`
 * já devolve o valor íntegro, sem zeros de enchimento, e é o que a tela
 * reformata. Este módulo existe para o **resultado técnico persistido**, onde a
 * escala fixa faz parte do contrato.
 */

/** Escala das colunas `DECIMAL(24,12)` — QUANTITY e TECHNICAL_RESULT, §58. */
export const ESCALA_TECNICA = 12;

/**
 * Resultado técnico persistido em `DECIMAL(24,12)`: custo por unidade, CMV por
 * unidade produzida, custo unitário congelado da faixa.
 *
 * Não usar para custo, tarifa ou preço em `DECIMAL(14,4)`/`(14,6)` — esses
 * pertencem ao PREC-MIG-B e continuam com a serialização da sua própria escala
 * até que a coluna mude.
 */
export function resultadoTecnico(value: Prisma.Decimal): string {
  return value.toFixed(ESCALA_TECNICA);
}
