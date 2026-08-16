/**
 * Resolução de período — estratégia ÚNICA de datas do frontend, usada pelo
 * Dashboard e pelos Relatórios. O cliente resolve os limites e envia em ISO,
 * então "hoje" é o dia do operador e não o fuso do servidor, e não existe
 * off-by-one na virada do dia.
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

export function resolvePeriodBounds(
  preset: PeriodPreset,
  customFrom: string,
  customTo: string,
): PeriodBounds {
  const now = new Date();
  if (preset === "custom") {
    const from = customFrom ? new Date(`${customFrom}T00:00:00`) : startOfDay(now);
    const to = customTo ? new Date(`${customTo}T23:59:59.999`) : now;
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const daysBack = preset === "today" ? 0 : preset === "7d" ? 6 : 29;
  const from = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack));
  return { from: from.toISOString(), to: now.toISOString() };
}
