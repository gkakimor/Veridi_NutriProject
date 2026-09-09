import { describe, expect, it } from "vitest";
import { diasCivisAte, marcadorDeHojeComercial } from "./business-day.js";
import { isLotAvailableForUse, isLotExpired, unavailableReasonForLot } from "./inventory-ledger.js";

/**
 * "Validade 15/09" vale o dia 15 inteiro — TZ-LOTE-01.
 *
 * `Lot.expiryDate` é DATA CIVIL: quem recebe o material escolhe 15/09/2026
 * num `<input type="date">` e nunca escolhe hora. O valor viaja como
 * `2026-09-15`, `z.coerce.date()` o materializa em `2026-09-15T00:00:00.000Z`
 * e a coluna guarda essa meia-noite UTC como MARCADOR do dia.
 *
 * A implementação anterior comparava esse marcador com o relógio
 * (`expiryDate.getTime() < Date.now()`). Duas leituras erradas saíam daí, e a
 * segunda é a que aparecia na operação:
 *
 * 1. o marcador é o PRIMEIRO instante do dia, então o lote vencia à
 *    meia-noite do próprio dia impresso no rótulo — 15/09 às 00:01 já era
 *    "vencido" para o sistema;
 * 2. em São Paulo isso acontece três horas antes: o marcador de 15/09 é
 *    21:00 do dia 14, e um lote com validade 15/09 aparecia vencido desde a
 *    noite de 14/09.
 *
 * A pergunta certa é "o dia 15/09 já acabou na Veridi?", respondida entre
 * DIAS, e é a mesma pergunta da validade da proposta — `venceuEm`, em
 * `business-day.ts`. Aqui não se fabrica fim de dia: não existe 23:59:59
 * nem soma de três horas.
 *
 * O relógio entra por parâmetro. Sem isso, a fronteira do vencimento só seria
 * testável entre 21h e meia-noite, que é justamente quando ninguém olha.
 */

/** Como a coluna guarda 15/09/2026: a meia-noite UTC que marca o dia. */
const VALIDADE_15_09 = new Date("2026-09-15T00:00:00.000Z");
const lote = (expiryDate: Date | null) => ({ expiryDate });

describe("validade de lote é data civil inclusiva", () => {
  it("A · 14/09 23:59 em São Paulo (02:59Z do dia 15) — ainda não venceu", () => {
    // O dia UTC já é 15; o dia da Veridi ainda é 14. Era aqui que a
    // comparação com o relógio dava "vencido" um dia inteiro antes da hora.
    expect(isLotExpired(lote(VALIDADE_15_09), new Date("2026-09-15T02:59:00.000Z"))).toBe(false);
  });

  it("B · 15/09 00:00 em São Paulo (03:00Z) — válido", () => {
    expect(isLotExpired(lote(VALIDADE_15_09), new Date("2026-09-15T03:00:00.000Z"))).toBe(false);
  });

  it("C · 15/09 12:00 em São Paulo (15:00Z) — válido", () => {
    expect(isLotExpired(lote(VALIDADE_15_09), new Date("2026-09-15T15:00:00.000Z"))).toBe(false);
  });

  it("D · 15/09 23:59:59 em São Paulo (02:59:59Z do dia 16) — válido até o último segundo", () => {
    expect(isLotExpired(lote(VALIDADE_15_09), new Date("2026-09-16T02:59:59.999Z"))).toBe(false);
  });

  it("E · 16/09 00:00 em São Paulo (03:00Z do dia 16) — vencido", () => {
    expect(isLotExpired(lote(VALIDADE_15_09), new Date("2026-09-16T03:00:00.000Z"))).toBe(true);
  });

  it("continua vencido nos dias seguintes", () => {
    expect(isLotExpired(lote(VALIDADE_15_09), new Date("2026-10-01T12:00:00.000Z"))).toBe(true);
  });

  it("lote sem validade nunca vence", () => {
    expect(isLotExpired(lote(null), new Date("2099-01-01T00:00:00.000Z"))).toBe(false);
  });
});

describe("viradas de calendário", () => {
  it("F · virada de mês: 30/09 vale o dia 30 inteiro em São Paulo", () => {
    const validade = new Date("2026-09-30T00:00:00.000Z");
    // 30/09 22:00 SP = 01/10 01:00Z — o dia da Veridi ainda é 30.
    expect(isLotExpired(lote(validade), new Date("2026-10-01T01:00:00.000Z"))).toBe(false);
    // 01/10 00:00 SP.
    expect(isLotExpired(lote(validade), new Date("2026-10-01T03:00:00.000Z"))).toBe(true);
  });

  it("G · virada de ano: 31/12 vale o dia 31 inteiro em São Paulo", () => {
    const validade = new Date("2026-12-31T00:00:00.000Z");
    expect(isLotExpired(lote(validade), new Date("2027-01-01T02:00:00.000Z"))).toBe(false);
    expect(isLotExpired(lote(validade), new Date("2027-01-01T03:00:00.000Z"))).toBe(true);
  });

  it("H · 29 de fevereiro de ano bissexto é um dia como outro qualquer", () => {
    const validade = new Date("2028-02-29T00:00:00.000Z");
    expect(isLotExpired(lote(validade), new Date("2028-02-29T15:00:00.000Z"))).toBe(false);
    // 29/02 23:00 SP = 01/03 02:00Z.
    expect(isLotExpired(lote(validade), new Date("2028-03-01T02:00:00.000Z"))).toBe(false);
    expect(isLotExpired(lote(validade), new Date("2028-03-01T03:00:00.000Z"))).toBe(true);
  });
});

/**
 * Disponibilidade e causa da indisponibilidade saem do MESMO predicado. Uma
 * regra por módulo é como o defeito voltaria: o lote sumiria da seleção num
 * lugar e continuaria na outra tela, no mesmo instante.
 */
describe("a mesma regra vale para elegibilidade e para a causa", () => {
  const disponivel = { status: "AVAILABLE", expiryDate: VALIDADE_15_09 };

  it("no próprio dia da validade o lote continua elegível", () => {
    const fimDoDia = new Date("2026-09-16T02:59:59.999Z");
    expect(isLotAvailableForUse(disponivel, fimDoDia)).toBe(true);
    expect(unavailableReasonForLot(disponivel, fimDoDia)).toBeNull();
  });

  it("na meia-noite seguinte deixa de ser elegível, e a causa é o vencimento", () => {
    const diaSeguinte = new Date("2026-09-16T03:00:00.000Z");
    expect(isLotAvailableForUse(disponivel, diaSeguinte)).toBe(false);
    expect(unavailableReasonForLot(disponivel, diaSeguinte)).toBe("EXPIRED");
  });

  it("validade não antecipa bloqueio: quem barra antes é o status da Qualidade", () => {
    const meioDoDia = new Date("2026-09-15T15:00:00.000Z");
    expect(isLotAvailableForUse({ status: "BLOCKED", expiryDate: VALIDADE_15_09 }, meioDoDia)).toBe(false);
    expect(unavailableReasonForLot({ status: "BLOCKED", expiryDate: VALIDADE_15_09 }, meioDoDia)).toBe("BLOCKED");
  });
});

/**
 * A distância até a validade também é contada em dias civis. Medida contra o
 * relógio, ela virava `-1` às 22h do próprio dia da validade e o relatório
 * imprimia "Vencido há 1 dias" num lote que a operação ainda podia consumir.
 */
describe("distância em dias civis", () => {
  it("o dia da validade é zero — 'vence hoje', não 'vencido'", () => {
    expect(diasCivisAte(VALIDADE_15_09, new Date("2026-09-15T03:00:00.000Z"))).toBe(0);
    expect(diasCivisAte(VALIDADE_15_09, new Date("2026-09-16T02:59:59.999Z"))).toBe(0);
  });

  it("no dia seguinte é −1, e não antes", () => {
    expect(diasCivisAte(VALIDADE_15_09, new Date("2026-09-16T03:00:00.000Z"))).toBe(-1);
  });

  it("o dia anterior é 1", () => {
    expect(diasCivisAte(VALIDADE_15_09, new Date("2026-09-14T20:00:00.000Z"))).toBe(1);
  });

  it("atravessa o fim do horário de verão sem perder dia", () => {
    /*
     * 18/02/2018 é o dia em que o horário de verão brasileiro terminou: às
     * 00:00 o relógio voltou para as 23:00 de 17/02, e o dia 17 teve 25
     * horas. Um offset escrito à mão erra a noite inteira aqui; quem decide
     * o deslocamento de cada instante é a base de fusos do `Intl`.
     */
    const validade = new Date("2018-02-17T00:00:00.000Z");
    // 00:00 de 17/02 no horário de verão (−02:00).
    expect(diasCivisAte(validade, new Date("2018-02-17T02:00:00.000Z"))).toBe(0);
    // 23:59 de 17/02, ainda em −02:00.
    expect(diasCivisAte(validade, new Date("2018-02-18T01:59:00.000Z"))).toBe(0);
    // O relógio volta: 23:00 de 17/02 outra vez, agora em −03:00.
    expect(diasCivisAte(validade, new Date("2018-02-18T02:00:00.000Z"))).toBe(0);
    // 00:00 de 18/02 — só agora o dia virou.
    expect(diasCivisAte(validade, new Date("2018-02-18T03:00:00.000Z"))).toBe(-1);
  });

  it("o marcador de hoje é o valor que a coluna teria se guardasse hoje", () => {
    expect(marcadorDeHojeComercial(new Date("2026-09-16T02:59:59.999Z")).toISOString()).toBe(
      "2026-09-15T00:00:00.000Z",
    );
    expect(marcadorDeHojeComercial(new Date("2026-09-16T03:00:00.000Z")).toISOString()).toBe(
      "2026-09-16T00:00:00.000Z",
    );
  });
});
