import { describe, expect, it } from "vitest";
import { formatQuantity, formatQuantityWithUnit } from "./quantity";

/**
 * O caso que motivou isto é real: a tela de Formulação mostrava
 * `0.0061224489795918367347 kg` na coluna "Físico / unidade", e o Inventário
 * Físico mostrava saldos com o mesmo excesso. Vinte e duas casas num número
 * que alguém vai conferir contra uma balança.
 */
describe("quantidade para leitura humana", () => {
  it("corta a precisão que o domínio não tem", () => {
    // O banco guarda Decimal(18,6); o resto é ruído de divisão.
    expect(formatQuantity("0.0061224489795918367347")).toBe("0,006122");
    expect(formatQuantity("3.8775510204081632653")).toBe("3,877551");
  });

  it("tira zero à direita, que não informa nada", () => {
    expect(formatQuantity("2.500000")).toBe("2,5");
    expect(formatQuantity("10.000000")).toBe("10");
  });

  it("usa vírgula, e NÃO agrupa milhar", () => {
    // Agrupar seria o português correto de ler e o veneno de copiar: o campo
    // decimal trata um separador único como casa decimal, então "1.234,5"
    // colado de volta viraria outro número.
    expect(formatQuantity("1234.5")).toBe("1234,5");
    expect(formatQuantity("1000")).toBe("1000");
  });

  it("valor abaixo da precisão vira aproximação, nunca zero", () => {
    // Zero significa "não precisa de material". Dizer zero para material que
    // existe seria mentir na direção perigosa.
    expect(formatQuantity("0.0000001")).toBe("≈ 0");
    expect(formatQuantity("0")).toBe("0");
  });

  it("ausência é travessão, não zero", () => {
    expect(formatQuantity(null)).toBe("—");
    expect(formatQuantity(undefined)).toBe("—");
    expect(formatQuantity("")).toBe("—");
  });

  it("o que não é número volta como veio, sem inventar", () => {
    expect(formatQuantity("indefinido")).toBe("indefinido");
  });

  it("a unidade vem colada, que é como se lê", () => {
    expect(formatQuantityWithUnit("0.0061224489795918367347", "kg")).toBe("0,006122 kg");
    expect(formatQuantityWithUnit(null, "kg")).toBe("—");
    expect(formatQuantityWithUnit("5", null)).toBe("5");
  });
});
