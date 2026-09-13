import { hojeComercial, recusaDoPeriodoDoPainel } from "@veridi/shared";
import { resolveListPeriod } from "./list-period";
import type { ListPeriodPreset } from "./list-period";

/**
 * Período do Dashboard — dois DIAS comerciais (`YYYY-MM-DD`), o mesmo contrato
 * das listas e dos Relatórios (DASHBOARD-BUSINESS-DATE-01).
 *
 * A tela resolvia os limites em instantes ISO e o servidor os usava como
 * vinham. Agora o dia viaja como a pessoa o escolheu e vira instante uma vez,
 * no servidor (`dashboard.schemas.ts`), no fuso da operação. "Hoje", "7 dias"
 * e "30 dias" são os presets das listas, resolvidos por `resolveListPeriod` a
 * partir de `hojeComercial`: nenhum relógio de navegador entra na conta.
 */

export type PeriodPreset = "today" | "7d" | "30d" | "custom";

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  today: "Hoje",
  "7d": "7 dias",
  "30d": "30 dias",
  custom: "Personalizado",
};

/** O mesmo recorte, pelo nome que ele tem nas listas. */
const PRESET_DAS_LISTAS: Record<PeriodPreset, ListPeriodPreset> = {
  today: "hoje",
  "7d": "7d",
  "30d": "30d",
  custom: "custom",
};

export interface PeriodBounds {
  /** `YYYY-MM-DD`, ou vazio quando o campo ficou limpo. */
  from: string;
  to: string;
  /**
   * Por que este período não se consulta, ou `null`. É a regra e a frase do
   * servidor (`recusaDoPeriodoDoPainel`): período invertido não vira pedido
   * nem KPI zerado (DASHBOARD-INVERTED-PERIOD-01).
   */
  recusa: string | null;
}

/**
 * Os dias que o período significa no dia comercial de `agora`.
 *
 * O `<input type="date">` entrega `YYYY-MM-DD` — data civil — e é isso que
 * segue. Campo limpo volta vazio, sem virar data: o servidor lê a ponta vazia
 * como hoje, como sempre leu a ponta ausente — e é com esse hoje que a recusa
 * compara as pontas.
 */
export function resolvePeriodBounds(
  preset: PeriodPreset,
  customFrom: string,
  customTo: string,
  agora: Date = new Date(),
): PeriodBounds {
  const dias = resolveListPeriod(PRESET_DAS_LISTAS[preset], customFrom, customTo, agora);
  const recusa = recusaDoPeriodoDoPainel(dias.dateFrom, dias.dateTo, hojeComercial(agora));
  return { from: dias.dateFrom, to: dias.dateTo, recusa: recusa?.mensagem ?? null };
}
