import {
  diaCivilDeslocado,
  ehDiaCivil,
  hojeComercial,
  primeiroDiaDoMesComercial,
} from "@veridi/shared";

/**
 * Período das LISTAS operacionais — em dias comerciais.
 *
 * Uma lista filtra por dia de calendário: a pessoa escolhe "de 10/09 até
 * 10/09" e quer o dia inteiro de 10/09 na operação da Veridi. Por isso o que
 * sai daqui é um par de `YYYY-MM-DD`, e não um instante: quem transforma dia
 * em instante é `intervaloDeDiasComerciais`, uma vez, no servidor. Enquanto a
 * conversão morava nas duas pontas, a tela e a consulta discordavam.
 *
 * É outro contrato do período do Dashboard (`period.ts`), que manda dois
 * instantes ISO porque agrega KPI sobre carimbo de tempo. Os dois resolvem o
 * "hoje" no MESMO lugar — `hojeComercial` —, então nenhum deles depende do
 * relógio do navegador: o operador em Lisboa e o operador em São Paulo veem a
 * mesma lista.
 */

export type ListPeriodPreset = "mes-atual" | "hoje" | "7d" | "30d" | "custom";

export const LIST_PERIOD_PRESET_LABELS: Record<ListPeriodPreset, string> = {
  "mes-atual": "Mês atual",
  hoje: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  custom: "Personalizado",
};

export const LIST_PERIOD_PRESETS = Object.keys(LIST_PERIOD_PRESET_LABELS) as ListPeriodPreset[];

export function ehListPeriodPreset(valor: string): valor is ListPeriodPreset {
  return valor in LIST_PERIOD_PRESET_LABELS;
}

/** O par de dias comerciais que um filtro de período representa. */
export interface ListPeriodDays {
  /** `YYYY-MM-DD`, ou vazio quando a ponta é aberta. */
  dateFrom: string;
  dateTo: string;
}

/**
 * Os dias que um preset significa HOJE, no fuso da operação.
 *
 * `custom` é a única forma que carrega os dois dias na URL — os presets são
 * relativos por natureza, e gravar as datas resolvidas ao lado do preset
 * criaria dois estados para a mesma pergunta. Ponta vazia em `custom` é
 * legítima: "a partir de 01/09, sem fim" é filtro de relatório histórico.
 */
export function resolveListPeriod(
  preset: ListPeriodPreset,
  customFrom = "",
  customTo = "",
  agora: Date = new Date(),
): ListPeriodDays {
  const hoje = hojeComercial(agora);
  switch (preset) {
    case "hoje":
      return { dateFrom: hoje, dateTo: hoje };
    case "7d":
      return { dateFrom: diaCivilDeslocado(hoje, -6), dateTo: hoje };
    case "30d":
      return { dateFrom: diaCivilDeslocado(hoje, -29), dateTo: hoje };
    case "mes-atual":
      return { dateFrom: primeiroDiaDoMesComercial(agora), dateTo: hoje };
    case "custom":
      return {
        dateFrom: ehDiaCivil(customFrom) ? customFrom : "",
        dateTo: ehDiaCivil(customTo) ? customTo : "",
      };
  }
}

/** `10/09/2026 – 30/09/2026` — o período como a pessoa o lê no chip. */
export function formatListPeriod({ dateFrom, dateTo }: ListPeriodDays): string {
  const porExtenso = (dia: string) => dia.split("-").reverse().join("/");
  if (dateFrom && dateTo) {
    return dateFrom === dateTo ? porExtenso(dateFrom) : `${porExtenso(dateFrom)} – ${porExtenso(dateTo)}`;
  }
  if (dateFrom) return `a partir de ${porExtenso(dateFrom)}`;
  if (dateTo) return `até ${porExtenso(dateTo)}`;
  return "todo o período";
}
