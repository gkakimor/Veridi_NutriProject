/**
 * Datas das suítes no calendário da operação (§72) — nunca no da máquina do
 * laboratório, que roda em outro fuso.
 */

export const FUSO_OPERACIONAL = "America/Sao_Paulo";

/** `YYYY-MM-DD` do dia comercial em São Paulo, deslocado em dias. */
export function diaComercial(deslocamento = 0, agora = new Date()) {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO_OPERACIONAL }).format(agora);
  const dia = new Date(`${hoje}T12:00:00Z`);
  dia.setUTCDate(dia.getUTCDate() + deslocamento);
  return dia.toISOString().slice(0, 10);
}

/** `2026-09-09` → `09/09/2026`, como tabela e impresso escrevem. */
export function porExtenso(diaISO) {
  const [ano, mes, dia] = diaISO.split("-");
  return `${dia}/${mes}/${ano}`;
}
