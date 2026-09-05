import { describe, expect, it } from "vitest";
import { calcularTotaisFaturamento } from "./billings.js";

/**
 * A conta do Faturamento — a mesma para o documento (API), para a impressão e
 * para a prévia da tela: quantidade × preço por linha em 2 casas, documento
 * igual à SOMA DAS LINHAS impressas, e total só quando todas têm preço.
 */
describe("calcularTotaisFaturamento", () => {
  it("quantidade × preço por linha, documento é a soma das linhas", () => {
    const r = calcularTotaisFaturamento([
      { quantity: "100", unitPrice: "12.5000" },
      { quantity: "50", unitPrice: "3.0000" },
    ]);
    expect(r.lineTotals).toEqual(["1250.00", "150.00"]);
    expect(r.hasCompletePricing).toBe(true);
    expect(r.totalAmount).toBe("1400.00");
  });

  it("preço com 4 casas entra inteiro: 100 × 13,2500 = 1.325,00", () => {
    const r = calcularTotaisFaturamento([{ quantity: "100", unitPrice: "13.2500" }]);
    expect(r.lineTotals).toEqual(["1325.00"]);
    expect(r.totalAmount).toBe("1325.00");
  });

  it("cada linha fecha em 2 casas ANTES de somar — como na nota fiscal", () => {
    // 123 × 4,0531 = 498,5313 → 498,53; 147 × 9,7203 = 1428,8841 → 1428,88.
    // Somar os produtos cheios e arredondar no fim daria 1.927,42, e o papel
    // com as duas linhas impressas soma 1.927,41.
    const r = calcularTotaisFaturamento([
      { quantity: "123", unitPrice: "4.0531" },
      { quantity: "147", unitPrice: "9.7203" },
    ]);
    expect(r.lineTotals).toEqual(["498.53", "1428.88"]);
    expect(r.totalAmount).toBe("1927.41");
  });

  it("linha sem preço deixa o documento sem total — parcial não existe", () => {
    const r = calcularTotaisFaturamento([
      { quantity: "10", unitPrice: "5" },
      { quantity: "10", unitPrice: null },
    ]);
    expect(r.lineTotals).toEqual(["50.00", null]);
    expect(r.hasCompletePricing).toBe(false);
    expect(r.totalAmount).toBeNull();
  });

  it("valor ilegível não vira NaN nem zero: a linha fica sem total", () => {
    const r = calcularTotaisFaturamento([{ quantity: "10", unitPrice: "abc" }]);
    expect(r.lineTotals).toEqual([null]);
    expect(r.totalAmount).toBeNull();
  });

  it("documento sem linha nenhuma não tem total", () => {
    const r = calcularTotaisFaturamento([]);
    expect(r.hasCompletePricing).toBe(false);
    expect(r.totalAmount).toBeNull();
  });

  it("preço zero explícito é preço, não ausência", () => {
    const r = calcularTotaisFaturamento([{ quantity: "10", unitPrice: "0" }]);
    expect(r.lineTotals).toEqual(["0.00"]);
    expect(r.hasCompletePricing).toBe(true);
    expect(r.totalAmount).toBe("0.00");
  });

  it("muitas linhas somam exato em decimal", () => {
    const linhas = Array.from({ length: 10 }, () => ({ quantity: "0.1", unitPrice: "3" }));
    // 10 × 0,30 = 3,00 — em ponto flutuante daria 2,9999999999999996.
    expect(calcularTotaisFaturamento(linhas).totalAmount).toBe("3.00");
  });
});
