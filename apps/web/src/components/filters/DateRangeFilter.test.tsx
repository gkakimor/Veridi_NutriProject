import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { recusaDoPeriodo } from "@veridi/shared";
import { resolveListPeriod } from "../../lib/list-period";
import { useListQuery } from "../../lib/list-query";
import { DateRangeFilter, PAUSA_DO_PERIODO_MS } from "./DateRangeFilter";
import type { DateRangeValue } from "./DateRangeFilter";

/**
 * Data digitada no filtro de período das listagens (LISTS-FILTER-INPUT-UX-01).
 *
 * O filtro propagava cada `change`: no Chromium, digitar uma data passa por
 * vazio, anos 0002/0020/0202 e dias do meio — cada um uma consulta. A tela de
 * teste é a das listagens (Faturamento, OC, Recebimentos, Produto Acabado):
 * período resolvido, recusa do período desligando a consulta e `useListQuery`.
 */

interface Pedido {
  dateFrom?: string;
  dateTo?: string;
}

let consultas: Pedido[];

function consultar(params: Pedido) {
  consultas.push(params);
  return new Promise<never>(() => {});
}

function Listagem() {
  const [valor, setValor] = useState<DateRangeValue>({
    period: "custom",
    dateFrom: "2026-08-01",
    dateTo: "2026-09-30",
  });
  const periodo = resolveListPeriod(valor.period, valor.dateFrom, valor.dateTo);
  const recusa = recusaDoPeriodo(periodo.dateFrom, periodo.dateTo);
  useListQuery(consultar, { dateFrom: periodo.dateFrom, dateTo: periodo.dateTo }, { enabled: recusa === null });
  return (
    <>
      <DateRangeFilter idPrefix="lista" value={valor} onChange={setValor} />
      <output data-testid="aplicado">{`${valor.dateFrom}|${valor.dateTo}`}</output>
      <button type="button" onClick={() => setValor({ period: "custom", dateFrom: "", dateTo: "" })}>
        Limpar
      </button>
    </>
  );
}

const inicial = () => screen.getByLabelText("Data inicial") as HTMLInputElement;
const final = () => screen.getByLabelText("Data final") as HTMLInputElement;
const aplicado = () => screen.getByTestId("aplicado").textContent;

function digitar(campo: HTMLInputElement, valor: string, { incompleta = false } = {}) {
  Object.defineProperty(campo, "validity", { configurable: true, get: () => ({ badInput: incompleta }) });
  fireEvent.change(campo, { target: { value: valor } });
}

function esperar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  consultas = [];
  render(<Listagem />);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DateRangeFilter — data digitada", () => {
  it("cada tecla aparece no campo, e a consulta sai uma vez, com a data final, depois da pausa", () => {
    expect(consultas).toHaveLength(1);

    digitar(inicial(), "2026-09-01");
    esperar(PAUSA_DO_PERIODO_MS - 1);
    digitar(inicial(), "2026-09-13");
    esperar(PAUSA_DO_PERIODO_MS - 1);

    // A pausa recomeçou na segunda tecla: nada aplicado, nada consultado.
    expect(inicial().value).toBe("2026-09-13");
    expect(aplicado()).toBe("2026-08-01|2026-09-30");
    expect(consultas).toHaveLength(1);

    esperar(1);
    expect(aplicado()).toBe("2026-09-13|2026-09-30");
    expect(consultas).toHaveLength(2);
    expect(consultas[1]).toEqual({ dateFrom: "2026-09-13", dateTo: "2026-09-30" });
  });

  it("Enter aplica na hora, sem esperar a pausa e sem consultar de novo depois dela", () => {
    digitar(final(), "2026-10-31");
    fireEvent.keyDown(final(), { key: "Enter" });

    expect(aplicado()).toBe("2026-08-01|2026-10-31");
    expect(consultas).toHaveLength(2);

    esperar(PAUSA_DO_PERIODO_MS * 3);
    expect(consultas).toHaveLength(2);
  });

  it("ano curto e segmento pela metade não aplicam — nem na pausa, nem no Enter", () => {
    for (const valor of ["0002-09-13", "0020-09-13", "0202-09-13"]) {
      digitar(inicial(), valor);
      esperar(PAUSA_DO_PERIODO_MS);
      fireEvent.keyDown(inicial(), { key: "Enter" });
    }
    digitar(inicial(), "", { incompleta: true });
    esperar(PAUSA_DO_PERIODO_MS);
    fireEvent.keyDown(inicial(), { key: "Enter" });

    expect(aplicado()).toBe("2026-08-01|2026-09-30");
    expect(consultas).toHaveLength(1);

    digitar(inicial(), "2026-09-13");
    esperar(PAUSA_DO_PERIODO_MS);
    expect(aplicado()).toBe("2026-09-13|2026-09-30");
    expect(consultas).toHaveLength(2);
  });

  it("apagar a data inteira abre a ponta — é uma escolha, não digitação pela metade", () => {
    digitar(inicial(), "");
    esperar(PAUSA_DO_PERIODO_MS);
    expect(aplicado()).toBe("|2026-09-30");
    expect(consultas).toEqual([
      { dateFrom: "2026-08-01", dateTo: "2026-09-30" },
      { dateFrom: "", dateTo: "2026-09-30" },
    ]);
  });

  it("período invertido: a recusa aparece depois da pausa, e nenhuma consulta sai", () => {
    digitar(inicial(), "2026-10-15");
    expect(screen.queryByRole("alert")).toBeNull();
    esperar(PAUSA_DO_PERIODO_MS);

    expect(aplicado()).toBe("2026-10-15|2026-09-30");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(consultas).toHaveLength(1);
  });

  it("período aplicado por fora (Limpar) substitui o digitado, que não aplica mais depois", () => {
    digitar(inicial(), "2026-09-13");
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    expect(inicial().value).toBe("");
    expect(final().value).toBe("");

    esperar(PAUSA_DO_PERIODO_MS * 2);
    expect(aplicado()).toBe("|");
    expect(consultas).toEqual([
      { dateFrom: "2026-08-01", dateTo: "2026-09-30" },
      { dateFrom: "", dateTo: "" },
    ]);
  });
});
