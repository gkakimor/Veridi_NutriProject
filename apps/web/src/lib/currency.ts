/**
 * TOTAL em dinheiro: sempre 2 casas.
 *
 * Para valor já somado — total de linha, total de documento, custo
 * consolidado. Para PREÇO UNITÁRIO use `formatUnitPriceBRL`: o preço tem
 * precisão própria, e cortá-lo aqui foi o que fez um documento de faturamento
 * deixar de fechar na conferência manual.
 */
export function formatBRL(value: string | null): string {
  if (value === null) return "—";
  const number = Number(value);
  if (Number.isNaN(number)) return "—";
  return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * PREÇO UNITÁRIO: de 2 a 4 casas, conforme o preço.
 *
 * As colunas de preço unitário são `Decimal(14,4)` e o total da linha é
 * calculado sobre o valor cheio. Exibir o preço com 2 casas ao lado de um
 * total calculado com 4 produzia um documento impossível de conferir:
 * `R$ 4,05 × 123` dá `R$ 498,15`, e o documento dizia `R$ 498,53`. Os R$ 0,38
 * de diferença não tinham origem visível no papel.
 *
 * A saída acompanha o número em vez de impor um formato fixo:
 *
 *     4.0500  →  R$ 4,05
 *     4.0530  →  R$ 4,053
 *     4.0531  →  R$ 4,0531
 *
 * O mínimo de 2 mantém a leitura de moeda no caso comum; o máximo de 4 é a
 * precisão que a coluna guarda. Zeros à direita não aparecem — um preço
 * redondo não deve carregar ruído para acomodar um preço quebrado.
 */
export function formatUnitPriceBRL(value: string | null): string {
  if (value === null) return "—";
  const number = Number(value);
  if (Number.isNaN(number)) return "—";
  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}
