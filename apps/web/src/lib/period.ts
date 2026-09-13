import {
  limitesDeDiasComerciais,
  limitesDeHojeComercial,
  limitesDoDiaComercial,
} from "@veridi/shared";

/**
 * Resolução de período do Dashboard. O cliente resolve os limites no dia
 * comercial e envia em ISO, então "hoje" é o dia da Veridi e não o fuso do
 * servidor, e não existe off-by-one na virada do dia.
 *
 * Listas e Relatórios NÃO passam por aqui: mandam o DIA (`YYYY-MM-DD`) e o
 * servidor o abre em instantes — `lib/list-period.ts` e
 * `pages/reports/report-period.ts`.
 */

export type PeriodPreset = "today" | "7d" | "30d" | "custom";

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  today: "Hoje",
  "7d": "7 dias",
  "30d": "30 dias",
  custom: "Personalizado",
};

export interface PeriodBounds {
  from: string;
  to: string;
}

/**
 * Dia do NAVEGADOR — preservado para o que é do calendário de quem digita: o
 * valor inicial de um campo de data. A resolução do período não passa mais por
 * aqui; ela é do dia comercial.
 */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

/** `yyyy-mm-dd` local, formato dos inputs `type="date"`. */
export function toDateInputValue(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function dateInputValueOffset(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return toDateInputValue(date);
}

/**
 * Os limites do período, em instantes — resolvidos no FUSO DA OPERAÇÃO.
 *
 * "Hoje" é o dia da Veridi, não o dia do relógio de quem abriu a tela: os
 * limites saem de `limitesDoDiaComercial`, a mesma função que o servidor usa
 * quando o filtro não vem preenchido. Com os componentes locais do navegador
 * um operador fora do Brasil filtrava o próprio dia e lia isso como o dia da
 * fábrica.
 *
 * O `<input type="date">` entrega `YYYY-MM-DD` — data civil. `de` é o começo
 * daquele dia; `até` é o fim do dia escolhido, inclusive.
 */
export function resolvePeriodBounds(
  preset: PeriodPreset,
  customFrom: string,
  customTo: string,
): PeriodBounds {
  const hoje = limitesDeHojeComercial();
  if (preset === "custom") {
    const from = customFrom ? limitesDoDiaComercial(customFrom).inicio : hoje.inicio;
    const to = customTo ? limitesDoDiaComercial(customTo).fim : hoje.fim;
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const dias = preset === "today" ? 1 : preset === "7d" ? 7 : 30;
  const janela = limitesDeDiasComerciais(dias);
  return { from: janela.inicio.toISOString(), to: janela.fim.toISOString() };
}
