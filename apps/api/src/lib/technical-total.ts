import { Decimal } from "./decimal.js";

/**
 * A fronteira de PERSISTÊNCIA do TOTAL TÉCNICO.
 *
 * `PRODUCT_RULES.md` §63. Um total técnico é o valor econômico AGREGADO de um
 * cenário — o custo total da faixa, a receita bruta, a comissão total, a
 * contribuição total. Ele é lido e conferido, nunca é operando de outro
 * cálculo, e guarda **quatro casas**, `DECIMAL(14,4)`.
 *
 * Quatro, e não doze: nenhum consumidor desses valores recebe mais de duas
 * casas — o DTO da faixa serve todos em moeda. Ampliar a coluna guardaria
 * precisão que a própria saída corta. O que faltava não era escala, era
 * FRONTEIRA: até o PREC-MIG-E a ativação gravava o resultado de 40 dígitos do
 * motor direto numa coluna de quatro casas, e quem decidia o corte era o
 * `UPDATE`. Agora a redução é do domínio, com o modo de arredondamento
 * **declarado**.
 *
 * **Não é um segundo motor.** Não há aritmética aqui: só a decisão de escala e
 * de modo de arredondamento, sobre o `Decimal` canônico da API.
 *
 * Terceira irmã de `fecharResultadoTecnicoPersistido` (`technical-result.ts`,
 * doze casas) e de `fecharPrecoTecnicoPersistido` (`technical-price.ts`, oito).
 * Três funções e não uma porque a escala pertence à CATEGORIA do campo, não a
 * quem chama — e porque as três respondem perguntas diferentes: o total do
 * cenário, o resultado por unidade e o preço.
 *
 * **Também não é `fecharPrecoUnitarioComercial`.** Aquela fronteira fecha em
 * quatro casas o preço de um DOCUMENTO assinado; esta fecha o total de um
 * cenário técnico interno. O número de casas coincide hoje; a regra, não.
 */

/** Escala do total técnico persistido — `DECIMAL(14,4)`, §58. */
export const ESCALA_TOTAL_TECNICO = 4;

/**
 * Fecha um total do motor no total técnico que a coluna guarda.
 *
 * `2026.5938200000000000000000000000000000000` → `2026.5938`.
 *
 * `ROUND_HALF_UP` **explícito**: metade para cima, afastando-se do zero, o
 * mesmo critério que o PostgreSQL aplicaria e o mesmo que o produto usa nas
 * outras fronteiras. Passá-lo na chamada é o que garante que a regra sobreviva
 * a uma mudança do `Decimal.rounding` global.
 *
 * Valor negativo é resultado legítimo — contribuição total abaixo do custo — e
 * atravessa a fronteira como qualquer outro, afastando-se do zero.
 */
export function fecharTotalTecnicoPersistido(valorDoMotor: Decimal): Decimal {
  return valorDoMotor.toDecimalPlaces(ESCALA_TOTAL_TECNICO, Decimal.ROUND_HALF_UP);
}
