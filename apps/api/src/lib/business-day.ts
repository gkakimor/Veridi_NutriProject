/**
 * Dia de calendário no domínio — uma fonte só para "até quando vale".
 *
 * As colunas de data-só do sistema (`validUntil`, `effectiveFrom`,
 * `costReferenceDate`) guardam a MEIA-NOITE UTC do dia escolhido: o campo
 * `<input type="date">` manda `2026-09-15`, `z.coerce.date()` produz
 * `2026-09-15T00:00:00.000Z`, e a tela formata de volta com
 * `{ timeZone: "UTC" }` (`web lib/dates.ts`). Ler esse instante como um ponto
 * no tempo é o que produz o erro de um dia: em `America/Sao_Paulo` ele é 15/09
 * às 21h do dia 14.
 *
 * A convenção — já usada pela referência de custo e pelo CMV — é que **o dia
 * inteiro conta**. "Válido até 15/09" vale durante todo o dia 15; a proposta
 * só vence quando o dia 15 acaba. É a mesma pergunta que `fimDoDia` responde
 * naqueles módulos, com o mesmo cálculo, agora com nome e casa próprios para
 * não virar uma quarta cópia.
 *
 * Não há literal de fuso aqui de propósito: o sistema não tem, hoje, conceito
 * explícito de fuso de negócio, e inventar um em cima de colunas gravadas em
 * UTC criaria um segundo motor de data divergindo do primeiro. Quando esse
 * conceito existir, ele nasce NESTE arquivo — e só nele.
 */

/** O último instante do dia de calendário de `dia`. */
export function fimDoDiaComercial(dia: Date): Date {
  const fim = new Date(dia);
  fim.setUTCHours(23, 59, 59, 999);
  return fim;
}

/**
 * `agora` já passou do fim do dia de `validUntil`?
 *
 * Sem validade não há vencimento: `null` nunca vence. Quem exige a validade é
 * a regra de envio, não esta função.
 */
export function venceuEm(validUntil: Date | null | undefined, agora: Date): boolean {
  if (!validUntil) return false;
  return agora.getTime() > fimDoDiaComercial(validUntil).getTime();
}

/** `15/09/2026` — o dia como o cliente o leu na proposta. */
export function diaComercialPorExtenso(dia: Date): string {
  return dia.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}
