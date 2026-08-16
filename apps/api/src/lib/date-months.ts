/**
 * Soma de meses de calendário — nunca `meses × 30 dias`.
 *
 * Regra de fim de mês: quando o dia não existe no mês de destino, usa-se o
 * ÚLTIMO dia válido daquele mês. Ex.: 31/01 + 1 mês = 28/02 (29/02 em ano
 * bissexto). Sem isso o JavaScript "transbordaria" para 03/03.
 */
export function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const targetMonthStart = new Date(Date.UTC(year, month + months, 1));
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0),
  ).getUTCDate();

  return new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth(),
      Math.min(day, lastDayOfTargetMonth),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/**
 * Validade sugerida a partir da vida útil do produto. `null` quando o
 * produto não tem vida útil cadastrada — o sistema nunca inventa validade.
 */
export function suggestedExpiryDate(producedAt: Date, shelfLifeMonths: number | null): Date | null {
  if (!shelfLifeMonths || shelfLifeMonths <= 0) return null;
  return addMonths(producedAt, shelfLifeMonths);
}
