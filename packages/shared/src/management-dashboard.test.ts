import { afterEach, describe, expect, it } from "vitest";
import {
  MANAGEMENT_DASHBOARD_ROLES,
  MANAGEMENT_PERIOD_PRESETS,
  MANAGEMENT_PERIOD_PRESET_LABELS,
  MENSAGEM_PERIODO_SEM_FIM,
  MENSAGEM_PERIODO_SEM_INICIO,
  baldesDaTendencia,
  diasDoIntervalo,
  ehPeriodoGerencial,
  granularidadeDaTendencia,
  recusaDoPeriodoGerencial,
  resolverPeriodoGerencial,
  valorComparavel,
  variacaoPercentual,
} from "./management-dashboard.js";
import { diaCivilDeslocado } from "./business-timezone.js";
import { MENSAGEM_DE_PERIODO_INVERTIDO } from "./period-range.js";

/**
 * Painel Gerencial — o calendário das perguntas de gestão
 * (MANAGEMENT-DASHBOARD-V1-01).
 *
 * O que se prova aqui é a regra aprovada no discovery (§6.11 e §6.17): qual é
 * o período de cada atalho no dia comercial de São Paulo, com que período
 * equivalente ele se compara, quando existe variação percentual e como a
 * tendência se divide em barras que o link de cada barra consegue filtrar.
 */

/** Meio-dia em São Paulo do dia pedido — longe das bordas do dia. */
const meioDiaEmSaoPaulo = (dia: string) => new Date(`${dia}T15:00:00.000Z`);

const FUSO_ORIGINAL = process.env.TZ;

afterEach(() => {
  if (FUSO_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = FUSO_ORIGINAL;
});

describe("perfis e atalhos", () => {
  it("ADMIN e COMMERCIAL, e só eles (D4)", () => {
    expect([...MANAGEMENT_DASHBOARD_ROLES].sort()).toEqual(["ADMIN", "COMMERCIAL"]);
  });

  it("quatro atalhos, com o nome por extenso — nunca a sigla em inglês", () => {
    expect(MANAGEMENT_PERIOD_PRESETS.map((preset) => MANAGEMENT_PERIOD_PRESET_LABELS[preset])).toEqual([
      "Mês atual",
      "Mês anterior",
      "Acumulado no ano",
      "Personalizado",
    ]);
    expect(Object.values(MANAGEMENT_PERIOD_PRESET_LABELS).join(" ")).not.toMatch(/YTD/i);
    expect(ehPeriodoGerencial("acumulado-ano")).toBe(true);
    expect(ehPeriodoGerencial("ytd")).toBe(false);
    expect(ehPeriodoGerencial("30d")).toBe(false);
  });
});

describe("Mês atual", () => {
  it("do dia 1 até hoje, comparado com o mesmo trecho do mês anterior", () => {
    expect(resolverPeriodoGerencial("mes-atual", undefined, undefined, meioDiaEmSaoPaulo("2026-09-15"))).toEqual({
      current: { from: "2026-09-01", to: "2026-09-15" },
      previous: { from: "2026-08-01", to: "2026-08-15" },
    });
  });

  it("31/03 compara até o último dia de fevereiro — nunca invade março", () => {
    expect(resolverPeriodoGerencial("mes-atual", undefined, undefined, meioDiaEmSaoPaulo("2026-03-31")).previous).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(resolverPeriodoGerencial("mes-atual", undefined, undefined, meioDiaEmSaoPaulo("2028-03-31")).previous).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("no dia 1, um dia contra um dia", () => {
    expect(resolverPeriodoGerencial("mes-atual", undefined, undefined, meioDiaEmSaoPaulo("2026-10-01"))).toEqual({
      current: { from: "2026-10-01", to: "2026-10-01" },
      previous: { from: "2026-09-01", to: "2026-09-01" },
    });
  });

  it("janeiro compara com dezembro do ano anterior", () => {
    expect(resolverPeriodoGerencial("mes-atual", undefined, undefined, meioDiaEmSaoPaulo("2027-01-20"))).toEqual({
      current: { from: "2027-01-01", to: "2027-01-20" },
      previous: { from: "2026-12-01", to: "2026-12-20" },
    });
  });

  it("23:30 de 30/09 em São Paulo ainda é setembro, com a máquina em qualquer fuso", () => {
    const fusos: [string, number][] = [
      ["UTC", 0],
      ["Etc/GMT+7", 420],
      ["America/Sao_Paulo", 180],
    ];
    for (const [fuso, deslocamento] of fusos) {
      process.env.TZ = fuso;
      // Sem isto o teste passaria sem ter mudado de fuso.
      expect(new Date("2026-09-12T12:00:00Z").getTimezoneOffset()).toBe(deslocamento);
      expect(resolverPeriodoGerencial("mes-atual", undefined, undefined, new Date("2026-10-01T02:30:00.000Z"))).toEqual({
        current: { from: "2026-09-01", to: "2026-09-30" },
        previous: { from: "2026-08-01", to: "2026-08-30" },
      });
    }
  });
});

describe("Mês anterior", () => {
  it("o mês fechado, comparado com o mês fechado antes dele", () => {
    expect(resolverPeriodoGerencial("mes-anterior", undefined, undefined, meioDiaEmSaoPaulo("2026-09-15"))).toEqual({
      current: { from: "2026-08-01", to: "2026-08-31" },
      previous: { from: "2026-07-01", to: "2026-07-31" },
    });
  });

  it("meses de tamanhos diferentes e virada de ano", () => {
    expect(resolverPeriodoGerencial("mes-anterior", undefined, undefined, meioDiaEmSaoPaulo("2026-03-10"))).toEqual({
      current: { from: "2026-02-01", to: "2026-02-28" },
      previous: { from: "2026-01-01", to: "2026-01-31" },
    });
    expect(resolverPeriodoGerencial("mes-anterior", undefined, undefined, meioDiaEmSaoPaulo("2026-01-10"))).toEqual({
      current: { from: "2025-12-01", to: "2025-12-31" },
      previous: { from: "2025-11-01", to: "2025-11-30" },
    });
  });
});

describe("Acumulado no ano", () => {
  it("de 1º de janeiro até hoje, comparado com o mesmo intervalo do ano anterior", () => {
    expect(resolverPeriodoGerencial("acumulado-ano", undefined, undefined, meioDiaEmSaoPaulo("2026-09-15"))).toEqual({
      current: { from: "2026-01-01", to: "2026-09-15" },
      previous: { from: "2025-01-01", to: "2025-09-15" },
    });
  });

  it("29/02 compara com 28/02", () => {
    expect(resolverPeriodoGerencial("acumulado-ano", undefined, undefined, meioDiaEmSaoPaulo("2028-02-29")).previous).toEqual({
      from: "2027-01-01",
      to: "2027-02-28",
    });
  });

  it("o ano é o civil de São Paulo: 31/12 às 23:30 ainda é o ano velho", () => {
    expect(resolverPeriodoGerencial("acumulado-ano", undefined, undefined, new Date("2027-01-01T02:30:00.000Z")).current).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });
});

describe("Personalizado", () => {
  it("compara com o intervalo de mesmo tamanho imediatamente antes", () => {
    expect(resolverPeriodoGerencial("custom", "2026-09-10", "2026-09-20")).toEqual({
      current: { from: "2026-09-10", to: "2026-09-20" },
      previous: { from: "2026-08-30", to: "2026-09-09" },
    });
  });

  it("um dia contra a véspera, e a virada de ano", () => {
    expect(resolverPeriodoGerencial("custom", "2026-09-15", "2026-09-15").previous).toEqual({
      from: "2026-09-14",
      to: "2026-09-14",
    });
    expect(resolverPeriodoGerencial("custom", "2026-01-01", "2026-01-31").previous).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("não depende do relógio: as datas são as escolhidas", () => {
    const longe = resolverPeriodoGerencial("custom", "2026-09-10", "2026-09-20", new Date("2031-05-05T12:00:00Z"));
    expect(longe.current).toEqual({ from: "2026-09-10", to: "2026-09-20" });
  });

  it("recusado não se resolve", () => {
    expect(() => resolverPeriodoGerencial("custom", undefined, "2026-09-20")).toThrow();
    expect(() => resolverPeriodoGerencial("custom", "2026-09-21", "2026-09-20")).toThrow();
  });
});

describe("recusa do período", () => {
  it("os atalhos ignoram datas soltas na URL", () => {
    for (const preset of ["mes-atual", "mes-anterior", "acumulado-ano"] as const) {
      expect(recusaDoPeriodoGerencial(preset, "2026-09-21", "2026-09-20")).toBeNull();
      expect(recusaDoPeriodoGerencial(preset, undefined, undefined)).toBeNull();
    }
  });

  it("Personalizado exige as duas pontas — a ponta vazia não vira hoje", () => {
    expect(recusaDoPeriodoGerencial("custom", undefined, "2026-09-20")).toEqual({
      campo: "dateFrom",
      mensagem: MENSAGEM_PERIODO_SEM_INICIO,
    });
    expect(recusaDoPeriodoGerencial("custom", "", "2026-09-20")?.campo).toBe("dateFrom");
    expect(recusaDoPeriodoGerencial("custom", "2026-09-10", undefined)).toEqual({
      campo: "dateTo",
      mensagem: MENSAGEM_PERIODO_SEM_FIM,
    });
    expect(recusaDoPeriodoGerencial("custom", "2026-02-30", "2026-03-10")?.campo).toBe("dateFrom");
  });

  it("invertido é a frase de sempre; o mesmo dia consulta", () => {
    expect(recusaDoPeriodoGerencial("custom", "2026-09-21", "2026-09-20")).toEqual({
      campo: "dateFrom",
      mensagem: MENSAGEM_DE_PERIODO_INVERTIDO,
    });
    expect(recusaDoPeriodoGerencial("custom", "2026-09-20", "2026-09-20")).toBeNull();
  });
});

describe("tendência", () => {
  it("conta os dias com as duas pontas", () => {
    expect(diasDoIntervalo({ from: "2026-09-15", to: "2026-09-15" })).toBe(1);
    expect(diasDoIntervalo({ from: "2026-01-01", to: "2026-12-31" })).toBe(365);
    expect(diasDoIntervalo({ from: "2028-01-01", to: "2028-12-31" })).toBe(366);
  });

  it("até 31 dias, uma barra por dia", () => {
    const baldes = baldesDaTendencia({ from: "2026-09-01", to: "2026-09-15" });
    expect(granularidadeDaTendencia({ from: "2026-09-01", to: "2026-09-15" })).toBe("day");
    expect(baldes).toHaveLength(15);
    expect(baldes.every((balde) => balde.from === balde.to)).toBe(true);
    expect(granularidadeDaTendencia({ from: "2026-01-01", to: "2026-01-31" })).toBe("day");
  });

  it("de 32 a 62 dias, semanas contadas do início — a última pode ser mais curta", () => {
    expect(baldesDaTendencia({ from: "2026-01-01", to: "2026-02-01" })).toEqual([
      { from: "2026-01-01", to: "2026-01-07" },
      { from: "2026-01-08", to: "2026-01-14" },
      { from: "2026-01-15", to: "2026-01-21" },
      { from: "2026-01-22", to: "2026-01-28" },
      { from: "2026-01-29", to: "2026-02-01" },
    ]);
    expect(granularidadeDaTendencia({ from: "2026-01-01", to: "2026-03-03" })).toBe("week");
    expect(baldesDaTendencia({ from: "2026-01-01", to: "2026-03-03" })).toHaveLength(9);
  });

  it("acima de 62 dias, meses civis cortados pelo período", () => {
    expect(granularidadeDaTendencia({ from: "2026-01-01", to: "2026-03-04" })).toBe("month");
    expect(baldesDaTendencia({ from: "2026-01-20", to: "2026-04-10" })).toEqual([
      { from: "2026-01-20", to: "2026-01-31" },
      { from: "2026-02-01", to: "2026-02-28" },
      { from: "2026-03-01", to: "2026-03-31" },
      { from: "2026-04-01", to: "2026-04-10" },
    ]);
    const acumulado = baldesDaTendencia({ from: "2026-01-01", to: "2026-09-15" });
    expect(acumulado).toHaveLength(9);
    expect(acumulado.at(-1)).toEqual({ from: "2026-09-01", to: "2026-09-15" });
  });

  it("as barras cobrem o período inteiro, sem buraco nem sobreposição", () => {
    const intervalos = [
      { from: "2026-09-01", to: "2026-09-30" },
      { from: "2026-02-10", to: "2026-03-20" },
      { from: "2025-11-15", to: "2026-09-15" },
      { from: "2028-02-29", to: "2028-02-29" },
    ];
    for (const intervalo of intervalos) {
      const baldes = baldesDaTendencia(intervalo);
      expect(baldes[0]?.from).toBe(intervalo.from);
      expect(baldes.at(-1)?.to).toBe(intervalo.to);
      for (let i = 1; i < baldes.length; i += 1) {
        expect(baldes[i]?.from).toBe(diaCivilDeslocado(baldes[i - 1]!.to, 1));
      }
      expect(baldes.reduce((soma, balde) => soma + diasDoIntervalo(balde), 0)).toBe(diasDoIntervalo(intervalo));
    }
  });
});

describe("comparação", () => {
  it("variação com uma casa, arredondada meio para cima", () => {
    expect(variacaoPercentual("120450.00", "111300.00")).toBe("8.2");
    expect(variacaoPercentual("4.00", "3.00")).toBe("33.3");
    expect(variacaoPercentual("5.00", "3.00")).toBe("66.7");
    expect(variacaoPercentual("1000.50", "1000.00")).toBe("0.1");
    expect(variacaoPercentual("0.00", "100.00")).toBe("-100.0");
    expect(variacaoPercentual("100.00", "100.00")).toBe("0.0");
    // Queda que arredonda para zero não vira "-0.0".
    expect(variacaoPercentual("99999.99", "100000.00")).toBe("0.0");
  });

  it("sem base de comparação: anterior zero, ou qualquer lado incompleto", () => {
    expect(variacaoPercentual("500.00", "0.00")).toBeNull();
    expect(variacaoPercentual("500.00", null)).toBeNull();
    expect(variacaoPercentual(null, "500.00")).toBeNull();
    expect(variacaoPercentual("3", "0")).toBeNull();
  });

  it("recorte sem documento compara como zero; incompleto não compara", () => {
    expect(valorComparavel({ count: 0, withValue: 0, amount: null })).toBe("0.00");
    expect(valorComparavel({ count: 3, withValue: 2, amount: null })).toBeNull();
    expect(valorComparavel({ count: 3, withValue: 3, amount: "10.00" })).toBe("10.00");
  });
});
