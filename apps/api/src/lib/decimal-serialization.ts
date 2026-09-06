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
 * Não usar para tarifa ou preço em `DECIMAL(14,4)`/`(14,6)` — esses pertencem
 * ao PREC-MIG-D e ao PREC-SER-02 e continuam com a serialização da sua própria
 * escala até que a coluna mude.
 */
export function resultadoTecnico(value: Prisma.Decimal): string {
  return value.toFixed(ESCALA_TECNICA);
}

/** Escala das colunas `DECIMAL(20,8)` — UNIT_COST, §58. */
export const ESCALA_CUSTO_UNITARIO = 8;

/**
 * Custo unitário, persistido ou derivado, em `DECIMAL(20,8)` — PREC-MIG-B.
 *
 * Cobre o custo efetivo de aquisição (`ReceiptLine.actualUnitCost`), a
 * referência manual (`ItemCostReference.unitCost`), a oferta de fornecedor
 * usada como custo (`SupplierItemOffer.unitPrice`) e os custos unitários que o
 * seletor canônico deriva delas — média ponderada 30d/90d, último custo real e
 * custo do lote consumido. Um derivado servido com menos casas que a fonte
 * seria a mesma perda por outro caminho.
 *
 * **Não usar para preço.** Preço acordado, preço da OC e preço de precificação
 * são UNIT_PRICE, categoria distinta com decisão própria: `PRODUCT_RULES.md`
 * §58 mantém o contratual na precisão do documento.
 */
export function custoUnitario(value: Prisma.Decimal): string {
  return value.toFixed(ESCALA_CUSTO_UNITARIO);
}
