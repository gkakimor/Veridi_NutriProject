import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  abaixoDaMenorCasa,
  comSimboloReal,
  ehZeroDecimal,
  formatarDecimalTexto,
  sinalEModulo,
  sumiriaAoExibir,
} from "./decimal-format";
import { formatBRL, formatUnitPriceBRL } from "./currency";
import { formatPercent } from "./percent";
import { formatQuantity } from "./quantity";
import { formatUnitCost } from "../components/CostBreakdown";

/**
 * Formatação decimal por texto — PREC-FMT-01.
 *
 * O defeito que este arquivo guarda é o do último trecho da cadeia: o dado
 * chega à tela com doze casas e passava por `Number` antes de virar texto. Um
 * `double` tem 53 bits de mantissa, e `9007199254740993.12` já não existe lá
 * dentro — vira `9007199254740994`. A fundação inteira, do schema à API, para
 * ser desfeita no `toLocaleString`.
 *
 * O contrato VISUAL não mudou: cada caso abaixo foi medido contra o
 * `Intl.NumberFormat` pt-BR que estava no lugar. O que mudou é que a decisão
 * de casas passou a ser do formatter, sobre dígitos.
 */

/** Não é representável em `double`: vira `...994` na conversão. */
const ALEM_DO_SAFE_INTEGER = "9007199254740993.12";

describe("formatarDecimalTexto", () => {
  it.each([
    ["duas casas fixas", "1234.5", 2, 2, true, "1.234,50"],
    ["arredonda para cima na metade — HALF_UP", "0.125", 2, 2, true, "0,13"],
    ["arredonda para cima também com 4ª ímpar", "0.135", 2, 2, true, "0,14"],
    ["não é banker's: 2,5 com zero casas sobe", "2.5", 0, 0, true, "3"],
    ["negativo afasta do zero", "-0.125", 2, 2, true, "-0,13"],
    ["milhar agrupado", "9876543.21", 2, 2, true, "9.876.543,21"],
    ["sem agrupamento quando pedido", "9876543.21", 2, 2, false, "9876543,21"],
    ["zeros à direita saem até o mínimo", "4.0500", 2, 4, true, "4,05"],
    ["zeros à direita saem parcialmente", "4.0530", 2, 4, true, "4,053"],
    ["mínimo zero deixa o inteiro puro", "5.0000", 0, 2, true, "5"],
    ["carry sobe a parte inteira", "9.999", 2, 2, true, "10,00"],
    ["carry atravessa o milhar", "999.999", 2, 2, true, "1.000,00"],
    ["notação científica pequena", "1e-7", 0, 8, true, "0,0000001"],
    ["notação científica grande", "1.5e3", 2, 2, true, "1.500,00"],
    ["zero com duas casas", "0", 2, 2, true, "0,00"],
  ])("%s: %s → %s", (_nome, valor, minimo, maximo, agruparMilhar, esperado) => {
    expect(formatarDecimalTexto(valor, { minimo, maximo, agruparMilhar })).toBe(esperado);
  });

  it("preserva dígitos que o double não representa", () => {
    // A prova do item: `Number("9007199254740993.12")` já é `9007199254740994`.
    expect(Number(ALEM_DO_SAFE_INTEGER)).toBe(9007199254740994);
    expect(formatarDecimalTexto(ALEM_DO_SAFE_INTEGER, { minimo: 2, maximo: 2 })).toBe(
      "9.007.199.254.740.993,12",
    );
  });

  it("preserva as doze casas de um resultado técnico quando pedidas", () => {
    expect(formatarDecimalTexto("1.234567890123", { minimo: 0, maximo: 12 })).toBe(
      "1,234567890123",
    );
  });

  it("entrada ilegível devolve null — quem chama decide o que mostrar", () => {
    for (const ruim of ["", "abc", "1,5", "--1", "."]) {
      expect(formatarDecimalTexto(ruim, { minimo: 2, maximo: 2 })).toBeNull();
    }
  });

  it("o sinal acompanha o valor original, não o arredondado", () => {
    // Era negativo; some com duas casas, mas continua sendo negativo — é o que
    // o `Intl` fazia, e esconder o sinal diria que o valor é zero neutro.
    expect(formatarDecimalTexto("-0.001", { minimo: 2, maximo: 2 })).toBe("-0,00");
    expect(formatarDecimalTexto("0", { minimo: 2, maximo: 2 })).toBe("0,00");
  });
});

describe("predicados sobre os dígitos", () => {
  it("sumiriaAoExibir distingue zero real de valor que some", () => {
    expect(sumiriaAoExibir("0.0032", 2)).toBe(true);
    expect(sumiriaAoExibir("0", 2)).toBe(false);
    expect(sumiriaAoExibir("0.00000000", 2)).toBe(false);
    // `0,005` NÃO some: com HALF_UP ele vira `0,01`.
    expect(sumiriaAoExibir("0.005", 2)).toBe(false);
    expect(sumiriaAoExibir("0.0049", 2)).toBe(true);
  });

  it("abaixoDaMenorCasa é magnitude, não arredondamento", () => {
    // `0,0000005` arredondaria para `0,000001`, mas está abaixo de `10^-6`.
    expect(abaixoDaMenorCasa("0.0000005", 6)).toBe(true);
    expect(abaixoDaMenorCasa("0.000001", 6)).toBe(false);
    expect(abaixoDaMenorCasa("0", 6)).toBe(false);
    expect(abaixoDaMenorCasa("1.5", 6)).toBe(false);
  });

  it("ehZeroDecimal reconhece zero em qualquer forma escrita", () => {
    for (const zero of ["0", "0.0", "0.00000000", "-0", "0e10"]) {
      expect(ehZeroDecimal(zero)).toBe(true);
    }
    expect(ehZeroDecimal("0.00000001")).toBe(false);
  });

  it("sinalEModulo separa sinal do valor sem passar por float", () => {
    expect(sinalEModulo("-1234.56789")).toEqual({ negativo: true, modulo: "1234.56789" });
    expect(sinalEModulo("1234.56789")).toEqual({ negativo: false, modulo: "1234.56789" });
    // Zero não é negativo, qualquer que seja a forma escrita.
    expect(sinalEModulo("-0.00").negativo).toBe(false);
    // O módulo continua íntegro: nenhum dígito passou por `double`.
    expect(sinalEModulo("-9007199254740993.12").modulo).toBe("9007199254740993.12");
  });

  it("comSimboloReal põe o sinal antes do símbolo", () => {
    expect(comSimboloReal("1.234,57")).toBe("R$ 1.234,57");
    expect(comSimboloReal("-1.234,57")).toBe("-R$ 1.234,57");
  });
});

describe("os formatters da tela, com o contrato de sempre", () => {
  it.each([
    ["total redondo", "1234.5", "R$ 1.234,50"],
    ["total negativo arredonda afastando do zero", "-1234.56789", "-R$ 1.234,57"],
    ["zero é zero", "0", "R$ 0,00"],
    ["valor pequeno some — formatBRL não abre casas", "0.0032", "R$ 0,00"],
    ["além do double", ALEM_DO_SAFE_INTEGER, "R$ 9.007.199.254.740.993,12"],
  ])("formatBRL %s: %s → %s", (_nome, valor, esperado) => {
    expect(formatBRL(valor)).toBe(esperado);
  });

  it.each([
    ["quatro casas aparecem", "4.0531", "R$ 4,0531"],
    ["três casas, sem zero de enchimento", "4.0530", "R$ 4,053"],
    ["preço redondo lê como moeda", "4.0500", "R$ 4,05"],
    ["oito casas fecham em quatro, HALF_UP", "4.05318764", "R$ 4,0532"],
    ["negativo", "-4.0531", "-R$ 4,0531"],
  ])("formatUnitPriceBRL %s: %s → %s", (_nome, valor, esperado) => {
    expect(formatUnitPriceBRL(valor)).toBe(esperado);
  });

  it.each([
    ["duas casas é a política, mesmo com oito servidas", "3.14159265", "R$ 3,14"],
    ["custo minúsculo abre até seis casas", "0.0032", "R$ 0,0032"],
    ["abaixo da política de 6 casas some, como sempre somou", "0.00000001", "R$ 0,00"],
    ["zeros à direita não viram ruído", "4.05000000", "R$ 4,05"],
    ["zero real", "0.00000000", "R$ 0,00"],
    ["além do double", ALEM_DO_SAFE_INTEGER, "R$ 9.007.199.254.740.993,12"],
  ])("formatUnitCost %s: %s → %s", (_nome, valor, esperado) => {
    expect(formatUnitCost(valor)).toBe(esperado);
  });

  it.each([
    ["percentual redondo perde os zeros", "5.0000", "5%"],
    ["duas casas é o teto", "16.0512", "16,05%"],
    ["negativo", "-62.5000", "-62,5%"],
    ["milhar agrupado", "1234.5678", "1.234,57%"],
  ])("formatPercent %s: %s → %s", (_nome, valor, esperado) => {
    expect(formatPercent(valor)).toBe(esperado);
  });

  it.each([
    ["seis casas é o teto", "0.0061224489795918367347", "0,006122"],
    ["zeros à direita saem", "2.500000", "2,5"],
    ["sem separador de milhar — quantidade é copiada", "1000", "1000"],
    ["abaixo de 10^-6 a quantidade diz ≈ 0", "0.000000048", "≈ 0"],
    ["negativo", "-0.5", "-0,5"],
    ["zero", "0", "0"],
  ])("formatQuantity %s: %s → %s", (_nome, valor, esperado) => {
    expect(formatQuantity(valor)).toBe(esperado);
  });

  it("quantidade abaixo da menor casa vira ≈ 0, com sinal", () => {
    expect(formatQuantity("0.0000005")).toBe("≈ 0");
    expect(formatQuantity("-0.0000005")).toBe("≈ -0");
    expect(formatQuantity("0")).toBe("0");
  });

  it("desconhecido continua desconhecido — nunca R$ 0,00", () => {
    expect(formatBRL(null)).toBe("—");
    expect(formatUnitPriceBRL(null)).toBe("—");
    expect(formatUnitCost(null)).toBe("—");
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
    expect(formatQuantity(null)).toBe("—");
    expect(formatQuantity(undefined)).toBe("—");
    expect(formatQuantity("")).toBe("—");
  });

  it("nenhum formatter passa por Number — a fonte prova", () => {
    /*
     * O gate do item: nenhum dos quatro arquivos de formatação pode conter
     * `Number(`, `parseFloat`, `Math.round` ou `toLocaleString`. Um teste de
     * saída sozinho não pegaria a reintrodução de um float que só erra em
     * valor grande.
     */
    for (const arquivo of [
      "src/lib/decimal-format.ts",
      "src/lib/currency.ts",
      "src/lib/percent.ts",
      "src/lib/quantity.ts",
    ]) {
      const fonte = readFileSync(join(process.cwd(), arquivo), "utf8");
      const corpo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(corpo, `${arquivo} usa toLocaleString`).not.toContain("toLocaleString");
      expect(corpo, `${arquivo} usa Math.round`).not.toContain("Math.round");
      expect(corpo, `${arquivo} usa parseFloat`).not.toContain("parseFloat");
      expect(corpo, `${arquivo} usa Intl`).not.toContain("Intl.");
      expect(corpo, `${arquivo} converte para Number`).not.toMatch(/Number\(/);
    }
  });
});
