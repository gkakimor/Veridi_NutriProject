import { describe, expect, it } from "vitest";
import { hojeComercial } from "@veridi/shared";
import { marcadorDoDiaCivil } from "../../lib/business-day.js";
import { isRateCurrent, pickCurrentRate } from "./industrial-resources.service.js";

/**
 * INDUSTRIAL-RATE-VALIDITY-01 — a vigência da tarifa é DIA CIVIL, inclusiva.
 *
 * `IndustrialResourceRate.effectiveAt` e `.validUntil` são datas civis: quem
 * cadastra escolhe o dia num `<input type="date">` e nunca escolhe hora, e a
 * coluna guarda a meia-noite UTC como MARCADOR do dia (§71, §72). A pergunta
 * do domínio é "este DIA está dentro da vigência?", nunca "este INSTANTE é
 * maior que aquele marcador".
 *
 * O defeito que estes casos travam: `isRateCurrent` comparava instantes crus,
 * então uma tarifa com `validUntil` igual ao dia de hoje aparecia como
 * histórica durante o próprio último dia impresso nela — o marcador é
 * 00:00:00.000 e qualquer relógio da tarde é maior que ele. É a mesma
 * assimetria de dia civil que §76 corrigiu para a oferta do fornecedor, do
 * outro lado do custo.
 *
 * Os casos são PUROS: a data de referência entra explícita, e nenhum deles
 * depende do relógio nem do fuso da máquina que roda a suíte.
 */

type Rate = Parameters<typeof isRateCurrent>[0];

/** Uma tarifa como o banco a devolve, com as datas em marcador de dia civil. */
function tarifa(overrides: {
  id?: string;
  effectiveAt?: string | null;
  validUntil?: string | null;
  createdAt?: string;
  rateValue?: string;
}): Rate {
  return {
    id: overrides.id ?? "rate-1",
    industrialResourceId: "res-1",
    rateValue: overrides.rateValue ?? "30",
    currencyCode: "BRL",
    rateUom: "HOUR",
    effectiveAt:
      overrides.effectiveAt === null || overrides.effectiveAt === undefined
        ? null
        : marcadorDoDiaCivil(overrides.effectiveAt),
    validUntil:
      overrides.validUntil === null || overrides.validUntil === undefined
        ? null
        : marcadorDoDiaCivil(overrides.validUntil),
    source: "MANUAL",
    notes: null,
    createdAt: new Date(overrides.createdAt ?? "2026-01-01T00:00:00.000Z"),
    createdByUserId: null,
    createdByNameSnapshot: null,
  } as unknown as Rate;
}

/** O dia da pergunta, no formato em que o domínio o recebe. */
const dia = (diaISO: string) => marcadorDoDiaCivil(diaISO);

describe("Vigência de tarifa industrial — dia civil inclusivo nas duas bordas", () => {
  it("A · effectiveFrom HOJE já vale hoje", () => {
    const rate = tarifa({ effectiveAt: "2026-09-09" });
    expect(isRateCurrent(rate, dia("2026-09-09"))).toBe(true);
  });

  it("B · validUntil HOJE ainda vale hoje — o dia inteiro conta", () => {
    const rate = tarifa({ effectiveAt: "2026-09-01", validUntil: "2026-09-09" });
    expect(isRateCurrent(rate, dia("2026-09-09"))).toBe(true);
  });

  it("C · validUntil ONTEM está vencida", () => {
    const rate = tarifa({ effectiveAt: "2026-09-01", validUntil: "2026-09-08" });
    expect(isRateCurrent(rate, dia("2026-09-09"))).toBe(false);
  });

  it("D · effectiveFrom AMANHÃ ainda não vale — e vale no dia dela", () => {
    const rate = tarifa({ effectiveAt: "2026-09-10" });
    expect(isRateCurrent(rate, dia("2026-09-09"))).toBe(false);
    expect(isRateCurrent(rate, dia("2026-09-10"))).toBe(true);
  });

  it("E · sem validUntil vale para sempre depois do início", () => {
    const rate = tarifa({ effectiveAt: "2026-01-01" });
    expect(isRateCurrent(rate, dia("2026-01-01"))).toBe(true);
    expect(isRateCurrent(rate, dia("2030-12-31"))).toBe(true);
  });

  it("sem effectiveAt não é tarifa vigente — legado é referência, nunca vigência", () => {
    const rate = tarifa({ effectiveAt: null });
    expect(isRateCurrent(rate, dia("2026-09-09"))).toBe(false);
  });

  /**
   * F — a hora do dia não muda a situação da tarifa.
   *
   * É o caso que reproduz o defeito relatado, e ele precisa entrar pelo mesmo
   * caminho do read model: um INSTANTE. `toRateDTO` decidia a situação com
   * `new Date()`, e a comparação era de instante contra marcador — o marcador
   * de "válida até 09/09" é 00:00:00.000, então qualquer relógio depois disso
   * já a declarava histórica. A tarifa morria durante o próprio dia impresso
   * nela, e nenhum teste de manhã pegaria isso.
   */
  it("F · a tarifa que vale ATÉ hoje continua vigente em qualquer hora do dia", () => {
    const rate = tarifa({ effectiveAt: "2026-09-01", validUntil: "2026-09-09" });
    const instantesDoDia = [
      "2026-09-09T00:00:00.000Z",
      "2026-09-09T00:00:00.001Z",
      "2026-09-09T00:01:00.000Z",
      "2026-09-09T12:00:00.000Z",
      "2026-09-09T23:59:59.999Z",
    ];

    for (const instante of instantesDoDia) {
      expect(isRateCurrent(rate, new Date(instante))).toBe(true);
    }
  });

  it("F · a que começa hoje também não depende da hora", () => {
    const rate = tarifa({ effectiveAt: "2026-09-09" });
    expect(isRateCurrent(rate, new Date("2026-09-09T00:00:00.000Z"))).toBe(true);
    expect(isRateCurrent(rate, new Date("2026-09-09T16:30:00.000Z"))).toBe(true);
    expect(isRateCurrent(rate, new Date("2026-09-08T23:59:59.999Z"))).toBe(false);
  });

  /**
   * O outro lado da mesma assimetria: quem pergunta "está vigente AGORA?"
   * precisa traduzir o relógio em DIA COMERCIAL antes de perguntar.
   *
   * Às 22h30 de São Paulo já é o dia seguinte em UTC. Passar o relógio cru
   * faria a tarifa que começa amanhã valer hoje à noite, e a que vence hoje
   * morrer três horas antes da meia-noite da Veridi.
   */
  it("o read model pergunta pelo DIA COMERCIAL, não pelo relógio", () => {
    const comecaAmanha = tarifa({ effectiveAt: "2026-09-10" });
    const venceHoje = tarifa({ effectiveAt: "2026-09-01", validUntil: "2026-09-09" });

    // 09/09 às 22h30 em São Paulo — já 10/09 em UTC.
    const relogio = new Date("2026-09-10T01:30:00.000Z");
    const diaComercial = marcadorDoDiaCivil(hojeComercial(relogio));
    expect(hojeComercial(relogio)).toBe("2026-09-09");

    expect(isRateCurrent(comecaAmanha, diaComercial)).toBe(false);
    expect(isRateCurrent(venceHoje, diaComercial)).toBe(true);
  });

  /**
   * G — o comportamento que JÁ estava correto e não pode regredir.
   *
   * Nada aqui é novo: agosto usa a tarifa de janeiro e setembro usa a de
   * setembro. A auditoria de 2026-09-09 não encontrou defeito neste ponto, e
   * o caso existe para que a correção de dia civil não o quebre.
   */
  it("G · agosto usa A e setembro usa B, pela data de referência", () => {
    const a = tarifa({ id: "A", effectiveAt: "2026-01-01", rateValue: "30" });
    const b = tarifa({ id: "B", effectiveAt: "2026-09-01", rateValue: "42" });

    expect(pickCurrentRate([a, b], dia("2026-08-31"))?.id).toBe("A");
    expect(pickCurrentRate([a, b], dia("2026-09-01"))?.id).toBe("B");
    expect(pickCurrentRate([a, b], dia("2026-12-31"))?.id).toBe("B");
  });

  it("empate de effectiveAt é resolvido pela mais recente — desempate estável", () => {
    const antiga = tarifa({
      id: "antiga",
      effectiveAt: "2026-09-01",
      createdAt: "2026-09-01T10:00:00.000Z",
    });
    const nova = tarifa({
      id: "nova",
      effectiveAt: "2026-09-01",
      createdAt: "2026-09-01T18:00:00.000Z",
    });
    expect(pickCurrentRate([antiga, nova], dia("2026-09-05"))?.id).toBe("nova");
    expect(pickCurrentRate([nova, antiga], dia("2026-09-05"))?.id).toBe("nova");
  });

  it("a vigência encerrada some da seleção, e a anterior não ressuscita", () => {
    const a = tarifa({ id: "A", effectiveAt: "2026-01-01", validUntil: "2026-08-31" });
    const b = tarifa({ id: "B", effectiveAt: "2026-09-01", validUntil: "2026-09-09" });

    expect(pickCurrentRate([a, b], dia("2026-08-31"))?.id).toBe("A");
    expect(pickCurrentRate([a, b], dia("2026-09-09"))?.id).toBe("B");
    // Depois de 09/09 nenhuma das duas vale — e A, encerrada, não volta.
    expect(pickCurrentRate([a, b], dia("2026-09-10"))).toBeNull();
  });
});
