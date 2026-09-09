import { describe, expect, it } from "vitest";
import { diaComercialPorExtenso, fimDoDiaComercial, venceuEm } from "./business-day.js";

/**
 * "Válido até 15/09" vale o dia 15 inteiro.
 *
 * A comparação ingênua — `new Date(validUntil) >= new Date()` — trata a data
 * como o PRIMEIRO instante do dia e vence a proposta na virada da meia-noite
 * do dia anterior ao que está impresso. Com a coluna gravada em UTC e o leitor
 * em `America/Sao_Paulo`, `2026-09-15T00:00:00Z` é 14/09 às 21h: a proposta
 * morreria três horas antes de o dia dela começar.
 *
 * Estes casos fixam a fronteira nos dois lados.
 */

/** Como a coluna guarda: meia-noite UTC do dia escolhido no `<input type="date">`. */
const QUINZE_DE_SETEMBRO = new Date("2026-09-15T00:00:00.000Z");

describe("dia comercial — a validade cobre o dia inteiro", () => {
  it("o fim do dia é o último milissegundo dele", () => {
    expect(fimDoDiaComercial(QUINZE_DE_SETEMBRO).toISOString()).toBe("2026-09-15T23:59:59.999Z");
  });

  it("não vence no primeiro instante do próprio dia", () => {
    expect(venceuEm(QUINZE_DE_SETEMBRO, new Date("2026-09-15T00:00:00.000Z"))).toBe(false);
  });

  it("não vence às 23:59 do dia da validade", () => {
    expect(venceuEm(QUINZE_DE_SETEMBRO, new Date("2026-09-15T23:59:00.000Z"))).toBe(false);
  });

  it("não vence no último milissegundo do dia", () => {
    expect(venceuEm(QUINZE_DE_SETEMBRO, new Date("2026-09-15T23:59:59.999Z"))).toBe(false);
  });

  it("vence no primeiro instante do dia seguinte", () => {
    expect(venceuEm(QUINZE_DE_SETEMBRO, new Date("2026-09-16T00:00:00.000Z"))).toBe(true);
  });

  it("continua vencida dias depois", () => {
    expect(venceuEm(QUINZE_DE_SETEMBRO, new Date("2026-10-01T09:00:00.000Z"))).toBe(true);
  });

  /*
   * O caso que a comparação ingênua erra: 15/09 às 21h em São Paulo ainda é o
   * dia 15 para quem lê a proposta — e é 16/09 às 00h em UTC. Aqui a pergunta
   * é sobre o DIA impresso, não sobre o instante em que o servidor roda.
   */
  it("a virada do dia é a do calendário da data gravada, não a do relógio do servidor", () => {
    // 15/09 20h em São Paulo = 15/09 23h UTC: ainda vale.
    expect(venceuEm(QUINZE_DE_SETEMBRO, new Date("2026-09-15T23:00:00.000Z"))).toBe(false);
  });

  it("sem validade não há vencimento", () => {
    expect(venceuEm(null, new Date("2099-01-01T00:00:00.000Z"))).toBe(false);
    expect(venceuEm(undefined, new Date("2099-01-01T00:00:00.000Z"))).toBe(false);
  });

  it("a data por extenso é a que o cliente leu, sem deslocar um dia", () => {
    expect(diaComercialPorExtenso(QUINZE_DE_SETEMBRO)).toBe("15/09/2026");
  });
});
