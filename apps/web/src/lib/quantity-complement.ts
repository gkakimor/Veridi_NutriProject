import { Decimal } from "@veridi/shared";

/**
 * O resto de uma quantidade depois de tirar a parte já decidida.
 *
 * Nasceu do Plano de Atendimento, onde "o que não é reservado é produzido": os
 * dois campos são complementares e um preenche o outro. O número resultante
 * **é enviado ao servidor**, então a conta não pode passar por `Number` — §66.
 * `10.000000000001 - 3` em ponto flutuante devolve `7.000000000001` por
 * sorte e `7.000000000000999` por azar, e o plano deixaria de fechar com o
 * pedido na décima segunda casa sem que ninguém visse o porquê.
 *
 * Piso em zero, como o servidor faz com `Decimal.max(planejado - produzido, 0)`:
 * complemento negativo não é quantidade, é entrada inválida — e quem recusa
 * entrada inválida é a validação da tela, não esta conta. Zero é `"0"`, nunca
 * `"-0"`.
 *
 * Escala preservada: entra `DECIMAL(24,12)`, sai `DECIMAL(24,12)`. Nada é
 * fechado em seis casas aqui — seis casas é decisão de leitura, e leitura é
 * `formatQuantity`.
 *
 * `toFixed()` e não `toString()`: em valor pequeno o bastante o `toString()`
 * escreve `1e-12`, e a fronteira do servidor recusa notação exponencial —
 * `decimal-schema.ts` exige `/^\d+(\.\d+)?$/`. Um complemento de um
 * picograma voltaria como "Valor decimal inválido", que não descreve nada do
 * que aconteceu.
 */
export function complementoDeQuantidade(total: string, parte: string): string {
  const resto = new Decimal(total).minus(new Decimal(parte));
  return resto.greaterThan(0) ? resto.toFixed() : "0";
}
