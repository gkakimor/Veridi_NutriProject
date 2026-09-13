import { diaCivilDeslocado, hojeComercial } from "@veridi/shared";

/**
 * Período dos Relatórios — dois DIAS de calendário, nunca instantes
 * (REPORTS-BUSINESS-DATE-01).
 *
 * O `<input type="date">` entrega `YYYY-MM-DD`, e é isso que vai para a API,
 * para o CSV e para o PDF: quem abre o dia nos instantes que o limitam é o
 * servidor, uma vez, pela espécie da coluna. A tela fazia
 * `new Date(`${dia}T00:00:00`).toISOString()` — a meia-noite do NAVEGADOR —,
 * e a mesma escolha de 12/09 virava um recorte em UTC, outro em Vancouver e
 * outro em São Paulo.
 *
 * O dia inicial dos campos também é o da Veridi, por `hojeComercial`, como no
 * período das listas (`lib/list-period.ts`). Com o relógio do navegador, às
 * 01:30 UTC — 22:30 em São Paulo — um navegador em UTC já abria o relatório
 * no dia seguinte ao da fábrica.
 */

/** O dia comercial a `dias` dias de hoje — `0` é hoje, `-29` abre uma janela de 30 dias. */
export function diaDoRelatorio(dias: number, agora: Date = new Date()): string {
  return diaCivilDeslocado(hojeComercial(agora), dias);
}

/** Onde o esqueleto do relatório escreve a recusa do período (`ReportPage`). */
export const ID_DA_RECUSA_DO_PERIODO = "report-period-error";

/**
 * Os `aria-*` dos campos De/até enquanto o período está recusado
 * (PERIOD-RANGE-VALIDATION-WAVE-01): inválidos e descritos pela frase.
 */
export function ariaDoPeriodoRecusado(recusa: string | null) {
  return recusa ? { "aria-invalid": true, "aria-describedby": ID_DA_RECUSA_DO_PERIODO } : {};
}
