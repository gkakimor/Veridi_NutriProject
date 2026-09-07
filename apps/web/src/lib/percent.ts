import { formatarDecimalTexto } from "./decimal-format";

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
 *
 * Formata por TEXTO desde o PREC-FMT-01 — mesmo contrato visual, sem `Number`.
 */
export function formatPercent(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const corpo = formatarDecimalTexto(value, { minimo: 0, maximo: 2 });
  if (corpo === null) return "—";
  return `${corpo}%`;
}
