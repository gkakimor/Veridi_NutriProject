import type { ListPeriodPreset } from "../../lib/list-period";
import { LIST_PERIOD_PRESETS, LIST_PERIOD_PRESET_LABELS, resolveListPeriod } from "../../lib/list-period";

/** O que o filtro de período devolve — os três campos mudam juntos. */
export interface DateRangeValue {
  period: ListPeriodPreset;
  dateFrom: string;
  dateTo: string;
}

/**
 * Filtro de período de uma listagem: atalhos + intervalo personalizado.
 *
 * Os atalhos são o caminho do dia a dia e o personalizado é a saída para o
 * relatório histórico — nenhum dos dois trava o outro. As datas só aparecem
 * em `custom`: com um atalho selecionado elas seriam dois campos mostrando
 * um valor que ninguém digitou e que muda de significado amanhã.
 *
 * Trocar de atalho LIMPA as datas, e escolher `Personalizado` as SEMEIA com o
 * período que estava na tela. Sem semear, o primeiro clique em Personalizado
 * abriria a lista inteira, e a pessoa perderia o recorte que estava lendo.
 *
 * Dia comercial, nunca instante: o que sai daqui é `YYYY-MM-DD`, e quem
 * resolve o "hoje" é `resolveListPeriod`, no fuso da operação.
 */
export function DateRangeFilter({
  idPrefix,
  value,
  onChange,
  presets = LIST_PERIOD_PRESETS,
  fromLabel = "Data inicial",
  toLabel = "Data final",
}: {
  /** Prefixo dos `id` dos campos — único na tela. */
  idPrefix: string;
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  /**
   * Quais atalhos a tela oferece, na ordem em que aparecem.
   *
   * É escolha de cada listagem, não de quem escreveu o componente: uma tela
   * com default operacional não precisa de "Todo o período" no meio dos
   * atalhos, e uma que mostra a base inteira precisa dele como saída.
   */
  presets?: ListPeriodPreset[];
  fromLabel?: string;
  toLabel?: string;
}) {
  function selecionarPreset(preset: ListPeriodPreset) {
    if (preset !== "custom") {
      onChange({ period: preset, dateFrom: "", dateTo: "" });
      return;
    }
    const atual = resolveListPeriod(value.period, value.dateFrom, value.dateTo);
    onChange({ period: "custom", dateFrom: atual.dateFrom, dateTo: atual.dateTo });
  }

  return (
    <div className="filter-period" role="group" aria-label="Período">
      {presets.map((preset) => (
        <button
          key={preset}
          type="button"
          className={
            value.period === preset ? "btn btn--primary btn--sm" : "btn btn--secondary btn--sm"
          }
          aria-pressed={value.period === preset}
          onClick={() => selecionarPreset(preset)}
        >
          {LIST_PERIOD_PRESET_LABELS[preset]}
        </button>
      ))}

      {value.period === "custom" && (
        <div className="filter-period__custom">
          <label className="sr-only" htmlFor={`${idPrefix}-date-from`}>
            {fromLabel}
          </label>
          <input
            id={`${idPrefix}-date-from`}
            type="date"
            value={value.dateFrom}
            onChange={(event) =>
              onChange({ period: "custom", dateFrom: event.target.value, dateTo: value.dateTo })
            }
          />
          <label className="sr-only" htmlFor={`${idPrefix}-date-to`}>
            {toLabel}
          </label>
          <input
            id={`${idPrefix}-date-to`}
            type="date"
            value={value.dateTo}
            onChange={(event) =>
              onChange({ period: "custom", dateFrom: value.dateFrom, dateTo: event.target.value })
            }
          />
        </div>
      )}
    </div>
  );
}
