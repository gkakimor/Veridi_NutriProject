/**
 * Datas do Veridi na tela.
 *
 * O backend guarda DATA DE DOCUMENTO — data do pedido, do recebimento, da
 * expedição, validade do lote — como meia-noite UTC. Formatar isso com
 * `toLocaleDateString` no fuso do navegador subtrai o offset: em qualquer
 * fuso negativo a data volta um dia. No Brasil (GMT-3) uma OC emitida em
 * 18/08 aparecia como 17/08 no próprio documento — divergência de um dia em
 * papel de compra é problema de rastreabilidade, não de estética.
 *
 * Data de documento é dia de calendário, não instante: formata pelos
 * componentes UTC, que são exatamente o dia que foi gravado.
 *
 * Carimbo de tempo (criado em, liberado em) É instante e continua no fuso de
 * quem lê — por isso `formatDateTime` não passa por aqui.
 */

/** `true` quando o valor é meia-noite UTC, isto é, data sem hora. */
/**
 * Data sem hora — em ISO completo (`...T00:00:00Z`) ou na forma curta que os
 * campos `<input type="date">` e as URLs carregam (`2026-08-19`).
 *
 * A forma curta ficava de fora e era lida como meia-noite UTC: no fuso de
 * Brasília o documento aparecia com o dia ANTERIOR ao que estava escrito no
 * próprio endereço.
 */
function isDateOnly(value: string): boolean {
  return /T00:00:00(\.000)?Z$/.test(value) || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Data de documento: sempre o dia gravado, independente do fuso do leitor. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", isDateOnly(value) ? { timeZone: "UTC" } : {});
}

/** Instante: fica no fuso de quem lê, porque é isso que ele significa. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR");
}

/** Valor para `<input type="date">` — mesmo dia gravado, sem passar pelo fuso. */
export function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}
