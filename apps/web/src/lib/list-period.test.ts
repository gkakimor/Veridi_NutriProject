import { describe, expect, it } from "vitest";
import { formatListPeriod, resolveListPeriod } from "./list-period";

/**
 * Os presets de período das listas — FILTER-FOUNDATION-01.
 *
 * Cada um vira um par de dias comerciais `YYYY-MM-DD`, resolvido no fuso da
 * OPERAÇÃO. O `agora` é injetado para que o teste não dependa do dia em que
 * roda, e o `TZ` do processo é variado para provar que o navegador de quem
 * abre a tela não muda o resultado.
 */

/** 11/09/2026 às 22:30 em São Paulo — já é 12/09 em UTC. */
const NOITE_DE_ONZE_DE_SETEMBRO = new Date("2026-09-12T01:30:00.000Z");

describe("presets de período da lista", () => {
  it("`Mês atual` vai do dia 1 até hoje", () => {
    expect(resolveListPeriod("mes-atual", "", "", NOITE_DE_ONZE_DE_SETEMBRO)).toEqual({
      dateFrom: "2026-09-01",
      dateTo: "2026-09-11",
    });
  });

  it("`Hoje` é o mesmo dia nas duas pontas — e é o dia da Veridi, não o do UTC", () => {
    expect(resolveListPeriod("hoje", "", "", NOITE_DE_ONZE_DE_SETEMBRO)).toEqual({
      dateFrom: "2026-09-11",
      dateTo: "2026-09-11",
    });
  });

  it("`Últimos 7 dias` inclui hoje — são 7 dias, não 7 dias mais hoje", () => {
    expect(resolveListPeriod("7d", "", "", NOITE_DE_ONZE_DE_SETEMBRO)).toEqual({
      dateFrom: "2026-09-05",
      dateTo: "2026-09-11",
    });
  });

  it("`Últimos 30 dias` atravessa o mês pelo calendário", () => {
    expect(resolveListPeriod("30d", "", "", NOITE_DE_ONZE_DE_SETEMBRO)).toEqual({
      dateFrom: "2026-08-13",
      dateTo: "2026-09-11",
    });
  });

  it("`Personalizado` devolve o que foi digitado, e ignora lixo", () => {
    expect(resolveListPeriod("custom", "2026-08-25", "2026-09-05")).toEqual({
      dateFrom: "2026-08-25",
      dateTo: "2026-09-05",
    });
    expect(resolveListPeriod("custom", "2026-02-30", "não é data")).toEqual({
      dateFrom: "",
      dateTo: "",
    });
  });

  it("`Personalizado` com uma ponta só continua sendo filtro", () => {
    expect(resolveListPeriod("custom", "2026-01-01", "")).toEqual({
      dateFrom: "2026-01-01",
      dateTo: "",
    });
  });

  it("o preset resolve igual em qualquer fuso do navegador", () => {
    const original = process.env.TZ;
    const medidos: string[] = [];
    try {
      for (const fuso of ["UTC", "America/Vancouver", "America/Sao_Paulo", "Asia/Tokyo"]) {
        process.env.TZ = fuso;
        const { dateFrom, dateTo } = resolveListPeriod(
          "mes-atual",
          "",
          "",
          NOITE_DE_ONZE_DE_SETEMBRO,
        );
        medidos.push(`${dateFrom}..${dateTo}`);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
    expect(new Set(medidos).size).toBe(1);
    expect(medidos[0]).toBe("2026-09-01..2026-09-11");
  });
});

describe("período por extenso", () => {
  it("um dia só não se repete", () => {
    expect(formatListPeriod({ dateFrom: "2026-09-10", dateTo: "2026-09-10" })).toBe("10/09/2026");
  });

  it("intervalo, ponta aberta e sem filtro têm texto próprio", () => {
    expect(formatListPeriod({ dateFrom: "2026-09-01", dateTo: "2026-09-30" })).toBe(
      "01/09/2026 – 30/09/2026",
    );
    expect(formatListPeriod({ dateFrom: "2026-09-01", dateTo: "" })).toBe("a partir de 01/09/2026");
    expect(formatListPeriod({ dateFrom: "", dateTo: "2026-09-30" })).toBe("até 30/09/2026");
    expect(formatListPeriod({ dateFrom: "", dateTo: "" })).toBe("todo o período");
  });
});
