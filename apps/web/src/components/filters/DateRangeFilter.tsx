import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { ehDiaCivil, recusaDoPeriodo } from "@veridi/shared";
import type { ListPeriodPreset } from "../../lib/list-period";
import { LIST_PERIOD_PRESETS, LIST_PERIOD_PRESET_LABELS, resolveListPeriod } from "../../lib/list-period";

/** O que o filtro de período devolve — os três campos mudam juntos. */
export interface DateRangeValue {
  period: ListPeriodPreset;
  dateFrom: string;
  dateTo: string;
}

/** Pausa da digitação que vira consulta — a das buscas e dos Relatórios (`useFiltrosDigitados`). */
export const PAUSA_DO_PERIODO_MS = 300;

type Ponta = "dateFrom" | "dateTo";

/**
 * Ponta que pode sair para a consulta: vazia (aberta) ou um dia de verdade.
 *
 * No Chromium, digitar 13/09/2027 sobre 15/08/2026 passa por datas com ano
 * 0002, 0020 e 0202 — válidas para o campo, nenhuma pedida pela pessoa — e o
 * campo com um segmento pela metade devolve vazio com `validity.badInput`,
 * que não é a ponta aberta. Nenhum desses vira consulta.
 */
function pontaAplicavel(valor: string, incompleta: boolean): boolean {
  if (incompleta) return false;
  return valor === "" || (ehDiaCivil(valor) && !valor.startsWith("0"));
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
 *
 * Data DIGITADA (LISTS-FILTER-INPUT-UX-01): cada `change` ia direto para
 * `onChange`, e cada valor do meio da digitação era uma consulta. Os campos
 * mostram cada tecla na hora; `onChange` só recebe as datas quando a
 * digitação para por `PAUSA_DO_PERIODO_MS` — ou no Enter —, as duas pontas
 * juntas, e só com as duas aplicáveis (`pontaAplicavel`). É o conceito de
 * `useFiltrosDigitados` dos Relatórios. Atalho é clique: aplica na hora.
 *
 * Personalizado com a data inicial depois da final mostra a recusa aqui, junto
 * dos campos (PERIOD-RANGE-VALIDATION-WAVE-01) — a mesma regra que a tela usa
 * para não consultar e que o servidor aplica. A recusa lê o período APLICADO,
 * como a consulta. Uma ponta vazia é aberta, e não recusa nada.
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
  const [digitadas, setDigitadas] = useState({ dateFrom: value.dateFrom, dateTo: value.dateTo });
  const [incompletas, setIncompletas] = useState({ dateFrom: false, dateTo: false });

  /*
   * O período aplicado mudou por fora — atalho, "Limpar filtros", a própria
   * aplicação: os campos passam a mostrá-lo. Ajuste no render, e não em efeito,
   * para não pintar um quadro com as datas de antes.
   */
  const [aplicadas, setAplicadas] = useState({ dateFrom: value.dateFrom, dateTo: value.dateTo });
  if (aplicadas.dateFrom !== value.dateFrom || aplicadas.dateTo !== value.dateTo) {
    setAplicadas({ dateFrom: value.dateFrom, dateTo: value.dateTo });
    setDigitadas({ dateFrom: value.dateFrom, dateTo: value.dateTo });
    setIncompletas({ dateFrom: false, dateTo: false });
  }

  const personalizado = value.period === "custom";
  const pendente = digitadas.dateFrom !== value.dateFrom || digitadas.dateTo !== value.dateTo;
  const aplicavel =
    pontaAplicavel(digitadas.dateFrom, incompletas.dateFrom) &&
    pontaAplicavel(digitadas.dateTo, incompletas.dateTo);
  const podeAplicar = personalizado && pendente && aplicavel;

  /* A tela recria `onChange` a cada render: por ref, render alheio não recomeça a pausa. */
  const aoMudar = useRef(onChange);
  aoMudar.current = onChange;

  useEffect(() => {
    if (!podeAplicar) return;
    const timer = setTimeout(
      () => aoMudar.current({ period: "custom", dateFrom: digitadas.dateFrom, dateTo: digitadas.dateTo }),
      PAUSA_DO_PERIODO_MS,
    );
    // Tecla nova recomeça a pausa; sair da tela não deixa consulta agendada.
    return () => clearTimeout(timer);
  }, [podeAplicar, digitadas.dateFrom, digitadas.dateTo]);

  function selecionarPreset(preset: ListPeriodPreset) {
    if (preset !== "custom") {
      onChange({ period: preset, dateFrom: "", dateTo: "" });
      return;
    }
    const atual = resolveListPeriod(value.period, value.dateFrom, value.dateTo);
    onChange({ period: "custom", dateFrom: atual.dateFrom, dateTo: atual.dateTo });
  }

  function digitar(ponta: Ponta) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const valor = event.target.value;
      const incompleta = event.target.validity?.badInput === true;
      setDigitadas((atuais) => ({ ...atuais, [ponta]: valor }));
      setIncompletas((atuais) => ({ ...atuais, [ponta]: incompleta }));
    };
  }

  function aplicarNoEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || !podeAplicar) return;
    onChange({ period: "custom", dateFrom: digitadas.dateFrom, dateTo: digitadas.dateTo });
  }

  const recusa = personalizado ? recusaDoPeriodo(value.dateFrom, value.dateTo) : null;
  const idDaRecusa = `${idPrefix}-period-error`;

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

      {personalizado && (
        <div className="filter-period__custom">
          <label className="sr-only" htmlFor={`${idPrefix}-date-from`}>
            {fromLabel}
          </label>
          <input
            id={`${idPrefix}-date-from`}
            type="date"
            value={digitadas.dateFrom}
            aria-invalid={recusa ? true : undefined}
            aria-describedby={recusa ? idDaRecusa : undefined}
            onChange={digitar("dateFrom")}
            onKeyDown={aplicarNoEnter}
          />
          <label className="sr-only" htmlFor={`${idPrefix}-date-to`}>
            {toLabel}
          </label>
          <input
            id={`${idPrefix}-date-to`}
            type="date"
            value={digitadas.dateTo}
            aria-invalid={recusa ? true : undefined}
            aria-describedby={recusa ? idDaRecusa : undefined}
            onChange={digitar("dateTo")}
            onKeyDown={aplicarNoEnter}
          />
        </div>
      )}

      {recusa && (
        <p id={idDaRecusa} className="form-alert filter-period__error" role="alert">
          {recusa}
        </p>
      )}
    </div>
  );
}
