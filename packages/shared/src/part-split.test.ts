import { describe, expect, it } from "vitest";
import { Decimal } from "./decimal-config.js";
import { ESCALA_RATEIO_POR_PARTE, partShare, splitDecimal } from "./part-split.js";

/**
 * Rateio de uma quantidade pelas partes da produção — o motor, num lugar só.
 *
 * A conta já existia em `apps/api`; ela subiu para cá porque o documento
 * impresso da Ordem de Produção dividia por conta própria e discordava dela.
 * O que estes testes fixam é o CONTRATO que os dois lados passam a compartilhar
 * — não a implementação.
 */

function soma(partes: Decimal[]): Decimal {
  return partes.reduce((total, parte) => total.plus(parte), new Decimal(0));
}

describe("splitDecimal", () => {
  it("divisão exata dá partes iguais", () => {
    const partes = splitDecimal("9", 3);
    expect(partes.map((p) => p.toString())).toEqual(["3", "3", "3"]);
  });

  it("a última parte absorve o resto — a soma fecha com o total", () => {
    const partes = splitDecimal("10", 3);
    expect(partes.map((p) => p.toString())).toEqual(["3.333333", "3.333333", "3.333334"]);
    expect(soma(partes).equals(new Decimal("10"))).toBe(true);
  });

  it("trunca as primeiras partes — nunca arredonda para cima", () => {
    /*
     * 2 / 3 = 0,6666... `ROUND_HALF_UP` daria 0,666667 nas três, somando
     * 2,000001: mais material do que a ordem planeja. `ROUND_DOWN` deixa a
     * sobra para a última parte, e a sobra é sempre não-negativa.
     */
    const partes = splitDecimal("2", 3);
    expect(partes.map((p) => p.toString())).toEqual(["0.666666", "0.666666", "0.666668"]);
    expect(soma(partes).equals(new Decimal("2"))).toBe(true);
    expect(partes[2]!.greaterThan(partes[0]!)).toBe(true);
  });

  it("fecha com o total em qualquer número de partes do domínio", () => {
    // O schema aceita de 1 a 99 partes. A soma fecha em todas.
    const total = new Decimal("100");
    for (let partes = 1; partes <= 99; partes += 1) {
      expect(soma(splitDecimal(total, partes)).equals(total)).toBe(true);
    }
  });

  it("preserva as doze casas de uma quantidade DECIMAL(24,12)", () => {
    // O total tem doze casas; a soma das partes continua sendo ele, exato.
    const total = new Decimal("1.000000000003");
    const partes = splitDecimal(total, 3);
    expect(partes.map((p) => p.toString())).toEqual([
      "0.333333",
      "0.333333",
      "0.333334000003",
    ]);
    expect(soma(partes).equals(total)).toBe(true);
  });

  it("parte única devolve o total inteiro", () => {
    expect(splitDecimal("10", 1).map((p) => p.toString())).toEqual(["10"]);
    expect(splitDecimal("10", 0).map((p) => p.toString())).toEqual(["10"]);
  });

  it("zero dividido continua zero em todas as partes", () => {
    const partes = splitDecimal("0", 4);
    expect(partes.map((p) => p.toString())).toEqual(["0", "0", "0", "0"]);
  });

  it("a escala do rateio é seis casas", () => {
    expect(ESCALA_RATEIO_POR_PARTE).toBe(6);
    const partes = splitDecimal("1", 3);
    expect(partes[0]!.decimalPlaces()).toBe(6);
  });

  it("nunca é float: 10/3 não vira 3.3333333333333335", () => {
    expect(10 / 3).toBe(3.3333333333333335);
    expect(splitDecimal("10", 3)[0]!.toString()).toBe("3.333333");
  });
});

describe("partShare", () => {
  it("devolve a parte pedida, 1-based", () => {
    expect(partShare("2", 3, 1).toString()).toBe("0.666666");
    expect(partShare("2", 3, 2).toString()).toBe("0.666666");
    expect(partShare("2", 3, 3).toString()).toBe("0.666668");
  });

  it("parte fora do intervalo é zero, não erro", () => {
    expect(partShare("2", 3, 0).toString()).toBe("0");
    expect(partShare("2", 3, 4).toString()).toBe("0");
  });
});
