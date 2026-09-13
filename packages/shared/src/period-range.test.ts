import { describe, expect, it } from "vitest";
import { recusaDoPeriodoDoPainel } from "./dashboard.js";
import { MENSAGEM_DE_PERIODO_INVERTIDO, recusaDoPeriodo } from "./period-range.js";

/**
 * Período de filtro invertido é recusa; ponta vazia é aberta
 * (PERIOD-RANGE-VALIDATION-WAVE-01). A rota está em
 * `api lib/periodo-invertido.test.ts`; as telas, em
 * `web components/filters/periodo-invertido.test.tsx`.
 */

describe("recusaDoPeriodo — só as duas pontas, e só invertidas", () => {
  it("nenhuma ponta: consulta", () => {
    expect(recusaDoPeriodo(undefined, undefined)).toBeNull();
    expect(recusaDoPeriodo("", "")).toBeNull();
    expect(recusaDoPeriodo(null, null)).toBeNull();
  });

  it("só a inicial, mesmo no futuro distante: consulta aberta para frente — nunca completa com hoje", () => {
    expect(recusaDoPeriodo("2999-01-01", undefined)).toBeNull();
    expect(recusaDoPeriodo("2999-01-01", "")).toBeNull();
  });

  it("só a final, mesmo no passado distante: consulta aberta para trás — nunca completa com hoje", () => {
    expect(recusaDoPeriodo(undefined, "2001-01-01")).toBeNull();
    expect(recusaDoPeriodo("", "2001-01-01")).toBeNull();
  });

  it("inicial antes da final, e o mesmo dia nas duas: consulta", () => {
    expect(recusaDoPeriodo("2026-09-12", "2026-09-13")).toBeNull();
    expect(recusaDoPeriodo("2026-09-13", "2026-09-13")).toBeNull();
    // Virada de mês e de ano comparam como calendário.
    expect(recusaDoPeriodo("2026-08-31", "2026-09-01")).toBeNull();
    expect(recusaDoPeriodo("2025-12-31", "2026-01-01")).toBeNull();
  });

  it("inicial depois da final: a frase", () => {
    expect(MENSAGEM_DE_PERIODO_INVERTIDO).toBe("A data inicial não pode ser posterior à data final.");
    expect(recusaDoPeriodo("2026-09-13", "2026-09-12")).toBe(MENSAGEM_DE_PERIODO_INVERTIDO);
    expect(recusaDoPeriodo("2026-09-01", "2026-08-31")).toBe(MENSAGEM_DE_PERIODO_INVERTIDO);
    expect(recusaDoPeriodo("2026-01-01", "2025-12-31")).toBe(MENSAGEM_DE_PERIODO_INVERTIDO);
  });

  it("dia mal formado não é inversão — a recusa é do campo, não uma segunda frase", () => {
    expect(recusaDoPeriodo("2026-02-30", "2026-01-01")).toBeNull();
    expect(recusaDoPeriodo("2026-09-13", "13/09/2026")).toBeNull();
    expect(recusaDoPeriodo("2026-09-13T00:00:00Z", "2026-09-12")).toBeNull();
  });
});

describe("o Painel continua completando a ponta vazia com hoje, e só então compara", () => {
  const HOJE = "2026-09-13";

  it("as duas preenchidas e invertidas: a mesma frase das listas", () => {
    expect(recusaDoPeriodoDoPainel("2026-09-13", "2026-09-12", HOJE)).toEqual({
      campo: "from",
      mensagem: MENSAGEM_DE_PERIODO_INVERTIDO,
    });
  });

  it("ponta vazia é hoje — onde a lista consulta, o Painel recusa", () => {
    expect(recusaDoPeriodo(undefined, "2026-09-12")).toBeNull();
    expect(recusaDoPeriodoDoPainel(undefined, "2026-09-12", HOJE)?.campo).toBe("to");
    expect(recusaDoPeriodo("2026-09-14", undefined)).toBeNull();
    expect(recusaDoPeriodoDoPainel("2026-09-14", undefined, HOJE)?.campo).toBe("from");
    expect(recusaDoPeriodoDoPainel(undefined, undefined, HOJE)).toBeNull();
    expect(recusaDoPeriodoDoPainel("2026-09-13", "2026-09-13", HOJE)).toBeNull();
  });
});
