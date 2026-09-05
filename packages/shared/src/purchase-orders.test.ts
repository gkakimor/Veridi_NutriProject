import { describe, expect, it } from "vitest";
import { calcularTotaisOrdemCompra } from "./purchase-orders.js";

/**
 * A conta do total da OC — a mesma para o documento (API) e para a prévia
 * (tela): quantidade × preço por linha, soma das linhas com preço, 2 casas
 * só na saída.
 */
describe("calcularTotaisOrdemCompra", () => {
  it("quantidade × preço por linha e soma das linhas com preço", () => {
    const r = calcularTotaisOrdemCompra([
      { orderedQuantity: "10", unitPrice: "12.5" },
      { orderedQuantity: "3", unitPrice: "0.3333" },
      { orderedQuantity: "7", unitPrice: null },
    ]);
    expect(r.lineTotals).toEqual(["125.00", "1.00", null]);
    // 125 + 0,9999 = 125,9999 → 126,00: arredonda só no fim, nunca por linha.
    expect(r.orderTotal).toBe("126.00");
  });

  it("preço com 4 casas entra inteiro na conta", () => {
    const r = calcularTotaisOrdemCompra([{ orderedQuantity: "1000", unitPrice: "4.0531" }]);
    expect(r.lineTotals).toEqual(["4053.10"]);
    expect(r.orderTotal).toBe("4053.10");
  });

  it("sem nenhuma linha com preço o total é desconhecido, não zero", () => {
    expect(calcularTotaisOrdemCompra([{ orderedQuantity: "5", unitPrice: null }]).orderTotal).toBeNull();
    expect(calcularTotaisOrdemCompra([]).orderTotal).toBeNull();
  });

  it("valor ilegível não vira NaN nem zero: a linha fica fora e o resto segue", () => {
    const r = calcularTotaisOrdemCompra([
      { orderedQuantity: null, unitPrice: "2" },
      { orderedQuantity: "2", unitPrice: "abc" },
      { orderedQuantity: "2", unitPrice: "3" },
    ]);
    expect(r.lineTotals).toEqual([null, null, "6.00"]);
    expect(r.orderTotal).toBe("6.00");
  });

  it("muitas linhas somam exato em decimal", () => {
    const linhas = Array.from({ length: 10 }, () => ({ orderedQuantity: "0.1", unitPrice: "3" }));
    // 10 × 0,3 = 3,00 — em ponto flutuante daria 2,9999999999999996.
    expect(calcularTotaisOrdemCompra(linhas).orderTotal).toBe("3.00");
  });
});
