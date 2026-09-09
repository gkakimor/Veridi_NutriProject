import { afterEach, describe, expect, it, vi } from "vitest";
import { dashboardQuerySchema } from "../modules/dashboard/dashboard.schemas.js";
import { nextOfficialNumberYear } from "./production-order-number.js";
import { lotCodeDay } from "./lot-code.js";

/**
 * O dia comercial em três lugares que decidem coisa séria — SYS-TZ-01.
 *
 * O helper isolado já está provado. Aqui a pergunta é outra: as features que
 * dependem dele passaram a usar o dia da Veridi, e não o do relógio da
 * máquina? Todas as três erravam do mesmo jeito, e todas as três só erram
 * entre 21h e meia-noite — o horário em que ninguém está olhando.
 *
 * O relógio é controlado com `toFake: ["Date"]`: sem isso, a fronteira só
 * seria testável no fim da noite, e a virada de ano uma vez por ano.
 */

afterEach(() => {
  vi.useRealTimers();
});

/** 01:00Z de 16/09 é 22:00 de 15/09 em São Paulo. */
const NOITE_DE_QUINZE = new Date("2026-09-16T01:00:00.000Z");
/** 01:00Z de 01/01 é 22:00 de 31/12 em São Paulo. */
const REVEILLON = new Date("2027-01-01T01:00:00.000Z");

describe('KPI "hoje" do painel', () => {
  it("sem filtro, a janela é o dia comercial inteiro — não o dia UTC", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOITE_DE_QUINZE);

    const { from, to } = dashboardQuerySchema.parse({});

    // 15/09 em São Paulo, do primeiro ao último milissegundo.
    expect(from.toISOString()).toBe("2026-09-15T03:00:00.000Z");
    expect(to.toISOString()).toBe("2026-09-16T02:59:59.999Z");
    // O instante atual está DENTRO da janela: às 22h ainda é hoje.
    expect(NOITE_DE_QUINZE >= from && NOITE_DE_QUINZE <= to).toBe(true);
  });

  it("o que a tela mandar continua mandando — o default só existe sem filtro", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOITE_DE_QUINZE);

    const { from, to } = dashboardQuerySchema.parse({
      from: "2026-09-01T03:00:00.000Z",
      to: "2026-09-10T02:59:59.999Z",
    });

    expect(from.toISOString()).toBe("2026-09-01T03:00:00.000Z");
    expect(to.toISOString()).toBe("2026-09-10T02:59:59.999Z");
  });
});

describe("numeração oficial da Ordem de Produção", () => {
  it("liberada às 22h de 31/12, leva o ano que ainda está correndo na Veridi", () => {
    expect(nextOfficialNumberYear(REVEILLON)).toBe(2026);
  });

  it("liberada depois da meia-noite em São Paulo, leva o ano novo", () => {
    expect(nextOfficialNumberYear(new Date("2027-01-01T03:30:00.000Z"))).toBe(2027);
  });
});

describe("código do lote", () => {
  it("recebimento das 22h de 31/12 é do dia 31, não do dia 1º", () => {
    expect(lotCodeDay(REVEILLON)).toBe("20261231");
  });

  it("recebimento no meio do dia fica no próprio dia", () => {
    expect(lotCodeDay(new Date("2026-09-15T15:00:00.000Z"))).toBe("20260915");
  });
});
