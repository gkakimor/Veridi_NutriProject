import { describe, expect, it } from "vitest";
import {
  anoComercial,
  diaCivil,
  diaComercialCompacto,
  diaDoInstantePorExtenso,
  hojeComercial,
  instanteComercialPorExtenso,
  limitesDeDiasComerciais,
  limitesDeHojeComercial,
  limitesDoDiaComercial,
} from "./business-timezone.js";

/**
 * O fuso operacional decide o que é "hoje", que dia um instante pertence e
 * como um carimbo de tempo é lido. Aqui se prova que quem responde isso é a
 * base de fusos do `Intl` — nunca o relógio da máquina, nunca um offset fixo.
 */

/** Como a coluna de data-só guarda: meia-noite UTC do dia escolhido. */
const QUINZE_DE_SETEMBRO = new Date("2026-09-15T00:00:00.000Z");

describe("limites do dia comercial", () => {
  it("o dia 15/09 começa às 03:00Z e termina às 02:59:59.999Z do dia 16", () => {
    const { inicio, fim } = limitesDoDiaComercial("2026-09-15");
    expect(inicio.toISOString()).toBe("2026-09-15T03:00:00.000Z");
    expect(fim.toISOString()).toBe("2026-09-16T02:59:59.999Z");
  });

  it("o instante 01:00Z de 16/09 cai DENTRO do dia comercial 15/09", () => {
    const { inicio, fim } = limitesDoDiaComercial("2026-09-15");
    const instante = new Date("2026-09-16T01:00:00.000Z");
    expect(instante >= inicio && instante <= fim).toBe(true);
  });

  it("virada de mês: 30/09 termina às 02:59:59.999Z de 01/10", () => {
    expect(limitesDoDiaComercial("2026-09-30").fim.toISOString()).toBe(
      "2026-10-01T02:59:59.999Z",
    );
  });

  it("virada de ano: 31/12 termina às 02:59:59.999Z de 01/01", () => {
    expect(limitesDoDiaComercial("2026-12-31").fim.toISOString()).toBe(
      "2027-01-01T02:59:59.999Z",
    );
  });

  it("com horário de verão o dia começa às 02:00Z — a base de fusos decide", () => {
    // Novembro de 2018: o Brasil ainda tinha DST, e São Paulo era GMT-2.
    expect(limitesDoDiaComercial("2018-11-15").inicio.toISOString()).toBe(
      "2018-11-15T02:00:00.000Z",
    );
  });

  it("`hoje` sai do dia comercial, não do relógio da máquina", () => {
    const { inicio, fim } = limitesDeHojeComercial(new Date("2026-09-16T01:00:00.000Z"));
    expect(inicio.toISOString()).toBe("2026-09-15T03:00:00.000Z");
    expect(fim.toISOString()).toBe("2026-09-16T02:59:59.999Z");
  });
});

describe("ano e dia comercial de um instante", () => {
  it("31/12 às 22h em São Paulo ainda é o ano velho", () => {
    // 01/01/2027 01:00Z = 31/12/2026 22:00 em São Paulo.
    expect(anoComercial(new Date("2027-01-01T01:00:00.000Z"))).toBe(2026);
    expect(diaComercialCompacto(new Date("2027-01-01T01:00:00.000Z"))).toBe("20261231");
  });

  it("01/01 às 00:30 em São Paulo já é o ano novo", () => {
    expect(anoComercial(new Date("2027-01-01T03:30:00.000Z"))).toBe(2027);
    expect(diaComercialCompacto(new Date("2027-01-01T03:30:00.000Z"))).toBe("20270101");
  });
});

describe("instante para leitura humana", () => {
  it("01:30Z aparece como o dia anterior, 22:30, para quem lê em São Paulo", () => {
    expect(instanteComercialPorExtenso(new Date("2026-09-09T01:30:00.000Z"))).toMatch(
      /^08\/09\/2026,? 22:30/,
    );
  });

  it("meio do dia continua no mesmo dia", () => {
    expect(instanteComercialPorExtenso(new Date("2026-09-09T15:00:00.000Z"))).toMatch(
      /^09\/09\/2026,? 12:00/,
    );
  });
});
describe("leitura dos dias", () => {
  it("o dia da coluna é o dia que foi digitado, lido em UTC", () => {
    expect(diaCivil(QUINZE_DE_SETEMBRO, "UTC")).toBe("2026-09-15");
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
    expect(QUINZE_DE_SETEMBRO.toLocaleDateString("pt-BR", { timeZone: "UTC" })).toBe("15/09/2026");
  });
});
