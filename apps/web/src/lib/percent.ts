/**
 * Percentual na tela.
 *
 * O backend guarda a precisão que a conta precisa — `"5.0000"` —, e quem lê
 * uma proposta quer "5%". Existiam três cópias desta função em telas
 * diferentes e uma quarta tela sem nenhuma, que interpolava o valor cru e
 * mostrava "5.0000%" ao lado de "5%" da tela vizinha. Uma função só.
 *
 * Duas casas é o teto: margem de contribuição com quatro decimais não muda
 * decisão nenhuma e só atrapalha a leitura.
 */
export function formatPercent(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  if (Number.isNaN(number)) return "—";
  return `${number.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}
