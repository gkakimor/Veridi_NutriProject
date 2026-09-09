import { describe, expect, it } from "vitest";
import {
  diaComercialPorExtenso,
  diaDaColunaDeData,
  hojeComercial,
  venceuEm,
} from "./business-day.js";

/**
 * "Válido até 15/09" vale o dia 15 inteiro — na operação brasileira.
 *
 * Duas comparações erram esta pergunta, e o sistema já usou as duas:
 *
 * 1. `new Date(validUntil) >= new Date()` mede o PRIMEIRO instante do dia e
 *    vence a proposta na virada da meia-noite do dia anterior ao impresso;
 * 2. o fim do dia em UTC (`setUTCHours(23,59,59,999)`) vence a proposta às
 *    **21h de São Paulo do próprio dia 15** — três horas antes da hora, e o
 *    defeito só aparece à noite, o que é o pior horário para descobri-lo.
 *
 * A validade é uma DATA CIVIL. A comparação é entre o dia de hoje na Veridi e
 * o dia escrito na proposta; nenhum instante é fabricado. Os casos abaixo são
 * os do handoff, com o instante UTC equivalente escrito ao lado — é ele que
 * chega ao servidor.
 */

/** Como a coluna guarda: meia-noite UTC do dia escolhido no `<input type="date">`. */
const QUINZE_DE_SETEMBRO = new Date("2026-09-15T00:00:00.000Z");

describe("validade é data civil da operação brasileira", () => {
  it("A · 15/09 00:01 em São Paulo (03:01Z) — vigente", () => {
    expect(venceuEm(QUINZE_DE_SETEMBRO, new Date("2026-09-15T03:01:00.000Z"))).toBe(false);
  });

  it("B · 15/09 20:59 em São Paulo (23:59Z do dia 15) — vigente", () => {
    expect(venceuEm(QUINZE_DE_SETEMBRO, new Date("2026-09-15T23:59:00.000Z"))).toBe(false);
  });

  /*
   * A partir daqui o dia UTC já virou e o dia de São Paulo não. Era exatamente
   * onde a implementação anterior reprovava.
   */
  it("C · 15/09 21:01 em São Paulo (00:01Z do dia 16) — vigente", () => {
    expect(venceuEm(QUINZE_DE_SETEMBRO, new Date("2026-09-16T00:01:00.000Z"))).toBe(false);
  });

  it("D · 15/09 23:59:59 em São Paulo (02:59:59Z do dia 16) — vigente", () => {
    expect(venceuEm(QUINZE_DE_SETEMBRO, new Date("2026-09-16T02:59:59.000Z"))).toBe(false);
  });

  it("E · 16/09 00:00 em São Paulo (03:00Z do dia 16) — vencida", () => {
    expect(venceuEm(QUINZE_DE_SETEMBRO, new Date("2026-09-16T03:00:00.000Z"))).toBe(true);
  });

  it("continua vencida dias depois", () => {
    expect(venceuEm(QUINZE_DE_SETEMBRO, new Date("2026-10-01T12:00:00.000Z"))).toBe(true);
  });

  it("ainda não vence no dia anterior, mesmo tarde da noite em UTC", () => {
    // 14/09 23:00 em São Paulo = 15/09 02:00Z: o dia da Veridi ainda é 14.
    expect(venceuEm(QUINZE_DE_SETEMBRO, new Date("2026-09-15T02:00:00.000Z"))).toBe(false);
  });

  it("sem validade não há vencimento", () => {
    expect(venceuEm(null, new Date("2099-01-01T00:00:00.000Z"))).toBe(false);
    expect(venceuEm(undefined, new Date("2099-01-01T00:00:00.000Z"))).toBe(false);
  });
});

describe("viradas de calendário", () => {
  it("virada de mês: 30/09 vale até o fim do dia 30 em São Paulo", () => {
    const trintaDeSetembro = new Date("2026-09-30T00:00:00.000Z");
    // 30/09 22:00 SP = 01/10 01:00Z — o dia da Veridi ainda é 30.
    expect(venceuEm(trintaDeSetembro, new Date("2026-10-01T01:00:00.000Z"))).toBe(false);
    // 01/10 00:00 SP = 01/10 03:00Z.
    expect(venceuEm(trintaDeSetembro, new Date("2026-10-01T03:00:00.000Z"))).toBe(true);
  });

  it("virada de ano: 31/12 vale até o fim do dia 31 em São Paulo", () => {
    const trintaEUmDeDezembro = new Date("2026-12-31T00:00:00.000Z");
    expect(venceuEm(trintaEUmDeDezembro, new Date("2027-01-01T02:00:00.000Z"))).toBe(false);
    expect(venceuEm(trintaEUmDeDezembro, new Date("2027-01-01T03:00:00.000Z"))).toBe(true);
  });

  it("29 de fevereiro de ano bissexto é um dia como qualquer outro", () => {
    const bissexto = new Date("2028-02-29T00:00:00.000Z");
    expect(diaDaColunaDeData(bissexto)).toBe("2028-02-29");
    expect(venceuEm(bissexto, new Date("2028-03-01T02:00:00.000Z"))).toBe(false);
    expect(venceuEm(bissexto, new Date("2028-03-01T03:00:00.000Z"))).toBe(true);
  });
});

describe("leitura dos dias", () => {
  it("o dia da coluna é o dia que foi digitado, lido em UTC", () => {
    expect(diaDaColunaDeData(QUINZE_DE_SETEMBRO)).toBe("2026-09-15");
  });

  it("o dia de hoje é o da operação brasileira, não o do relógio UTC", () => {
    // 16/09 01:00Z ainda é 15/09 às 22h em São Paulo.
    expect(hojeComercial(new Date("2026-09-16T01:00:00.000Z"))).toBe("2026-09-15");
    expect(hojeComercial(new Date("2026-09-16T03:00:00.000Z"))).toBe("2026-09-16");
  });

  /*
   * O fuso vem do `Intl`, que carrega a base de fusos: se o horário de verão
   * voltar, a virada acompanha sozinha. Um offset fixo `-03:00` responderia
   * errado por cinco meses do ano, e em silêncio.
   */
  it("a virada usa a base de fusos, não um offset fixo", () => {
    // 2018 ainda tinha horário de verão no Brasil: 15/11 era GMT-2.
    // 16/11 01:30Z = 15/11 23:30 em São Paulo — ainda o dia 15.
    expect(hojeComercial(new Date("2018-11-16T01:30:00.000Z"))).toBe("2018-11-15");
    // Sem DST, o mesmo relógio UTC em setembro já seria o dia 15 às 22:30.
    expect(hojeComercial(new Date("2018-09-16T01:30:00.000Z"))).toBe("2018-09-15");
  });

  it("a data por extenso é a que o cliente leu, sem deslocar um dia", () => {
    expect(diaComercialPorExtenso(QUINZE_DE_SETEMBRO)).toBe("15/09/2026");
  });
});
