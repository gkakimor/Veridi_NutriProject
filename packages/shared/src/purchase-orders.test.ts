import { describe, expect, it } from "vitest";
import { Decimal } from "./decimal-config.js";
import { calcularTotaisOrdemCompra } from "./purchase-orders.js";

/**
 * A conta do total da OC — a mesma para o documento (API) e para a prévia
 * (tela). `PRODUCT_RULES.md` §61, BACKLOG #18:
 *
 *     lineTotal  = round(quantidade × preço unitário, 2)
 *     orderTotal = Σ lineTotal
 *
 * O contrato central é o INVARIANTE: o rodapé é sempre igual à soma das linhas
 * impressas. Quem confere o papel somando a coluna chega ao mesmo número, e
 * essa é a única propriedade que o documento precisa ter.
 *
 * Antes desta capability o rodapé era `round(Σ valores brutos, 2)`. Com preço
 * de oito casas as duas contas divergem em centavos — o acceptance abaixo é
 * exatamente esse caso.
 */

/** Soma das linhas como quem confere o papel: uma coluna de duas casas. */
function somaDaColuna(lineTotals: (string | null)[]): string {
  return lineTotals
    .filter((total): total is string => total !== null)
    .reduce((soma, total) => soma.plus(total), new Decimal(0))
    .toFixed(2);
}

describe("calcularTotaisOrdemCompra", () => {
  it("B. o caso canônico do #18: 40,53 + 0,13 + 0,13 fecha 40,79", () => {
    const r = calcularTotaisOrdemCompra([
      { orderedQuantity: "10", unitPrice: "4.05318764" },
      { orderedQuantity: "1", unitPrice: "0.125" },
      { orderedQuantity: "5", unitPrice: "0.025" },
    ]);

    expect(r.lineTotals).toEqual(["40.53", "0.13", "0.13"]);
    expect(r.orderTotal).toBe("40.79");

    // A conta ANTIGA, para deixar a diferença visível: soma cheia
    // (40,53187640 + 0,125 + 0,125 = 40,78187640) fecharia 40,78.
    const somaCheia = new Decimal("10")
      .times("4.05318764")
      .plus(new Decimal("1").times("0.125"))
      .plus(new Decimal("5").times("0.025"));
    expect(somaCheia.toFixed(8)).toBe("40.78187640");
    expect(r.orderTotal).not.toBe(somaCheia.toFixed(2));
  });

  it("A. uma linha sem diferença de arredondamento continua igual", () => {
    const r = calcularTotaisOrdemCompra([{ orderedQuantity: "10", unitPrice: "12.5" }]);
    expect(r.lineTotals).toEqual(["125.00"]);
    expect(r.orderTotal).toBe("125.00");
  });

  it("C. frações abaixo e acima de meio centavo, na mesma ordem", () => {
    const r = calcularTotaisOrdemCompra([
      { orderedQuantity: "1", unitPrice: "0.114" }, // 0,114  → 0,11 (desce)
      { orderedQuantity: "1", unitPrice: "0.115" }, // 0,115  → 0,12 (empate, sobe)
      { orderedQuantity: "1", unitPrice: "0.116" }, // 0,116  → 0,12 (sobe)
      { orderedQuantity: "3", unitPrice: "0.3333" }, // 0,9999 → 1,00
    ]);
    expect(r.lineTotals).toEqual(["0.11", "0.12", "0.12", "1.00"]);
    expect(r.orderTotal).toBe("1.35");
    expect(r.orderTotal).toBe(somaDaColuna(r.lineTotals));
  });

  it("D. preço com 8 casas entra inteiro na multiplicação", () => {
    // O operando NÃO é arredondado antes: 4,05318764, não 4,05 nem 4,0532.
    const r = calcularTotaisOrdemCompra([{ orderedQuantity: "1000", unitPrice: "4.05318764" }]);
    expect(r.lineTotals).toEqual(["4053.19"]);
    // Com o preço cortado em 4 casas daria 4.053,10 — 9 centavos de diferença.
    expect(r.orderTotal).not.toBe("4053.10");
    expect(r.orderTotal).toBe("4053.19");
  });

  it("E. quantidade de alta precisão não é reduzida antes da conta", () => {
    // `orderedQuantity` é `DECIMAL(24,12)`: 0,000000048 kg × R$ 1.000.000
    // são R$ 0,048 → R$ 0,05. Cortar a quantidade antes zeraria a linha.
    const r = calcularTotaisOrdemCompra([
      { orderedQuantity: "0.000000048", unitPrice: "1000000" },
      { orderedQuantity: "0.123456789012", unitPrice: "8.10000000" },
    ]);
    expect(r.lineTotals).toEqual(["0.05", "1.00"]);
    expect(r.orderTotal).toBe("1.05");
  });

  it("F. zero é zero de verdade, e soma como zero", () => {
    const r = calcularTotaisOrdemCompra([
      { orderedQuantity: "10", unitPrice: "0" },
      { orderedQuantity: "0", unitPrice: "4.05318764" },
      { orderedQuantity: "2", unitPrice: "1.5" },
    ]);
    expect(r.lineTotals).toEqual(["0.00", "0.00", "3.00"]);
    expect(r.orderTotal).toBe("3.00");
  });

  it("G. sem preço a linha não tem total, e sem nenhum preço o total é desconhecido", () => {
    // Ausência não vira zero: `null` é "ainda não precificado".
    const r = calcularTotaisOrdemCompra([
      { orderedQuantity: "7", unitPrice: null },
      { orderedQuantity: "2", unitPrice: "3" },
    ]);
    expect(r.lineTotals).toEqual([null, "6.00"]);
    expect(r.orderTotal).toBe("6.00");

    expect(
      calcularTotaisOrdemCompra([{ orderedQuantity: "5", unitPrice: null }]).orderTotal,
    ).toBeNull();
    expect(calcularTotaisOrdemCompra([]).orderTotal).toBeNull();
  });

  it("H. uma linha só: o rodapé é a própria linha", () => {
    const r = calcularTotaisOrdemCompra([{ orderedQuantity: "3", unitPrice: "0.125" }]);
    expect(r.lineTotals).toEqual(["0.38"]);
    expect(r.orderTotal).toBe("0.38");
  });

  it("I. muitas linhas: cada meio centavo sobe, e o rodapé acompanha", () => {
    // 40 linhas de 0,125 — cada uma fecha 0,13, e o documento soma 5,20.
    // Pela conta antiga o bruto seria 5,00: vinte centavos de diferença, e a
    // página somaria 5,20 enquanto o rodapé diria 5,00.
    const linhas = Array.from({ length: 40 }, () => ({
      orderedQuantity: "1",
      unitPrice: "0.125",
    }));
    const r = calcularTotaisOrdemCompra(linhas);
    expect(new Set(r.lineTotals)).toEqual(new Set(["0.13"]));
    expect(r.orderTotal).toBe("5.20");
    expect(r.orderTotal).toBe(somaDaColuna(r.lineTotals));
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

  it("soma em decimal, nunca em float", () => {
    const linhas = Array.from({ length: 10 }, () => ({ orderedQuantity: "0.1", unitPrice: "3" }));
    // 10 × 0,30 = 3,00 — em ponto flutuante daria 2,9999999999999996.
    expect(calcularTotaisOrdemCompra(linhas).orderTotal).toBe("3.00");
  });

  it("empate de meio centavo sobe — ROUND_HALF_UP, nunca banker's", () => {
    // `1 × 0,125` → `0,13`. Banker's arredondaria para o par: `0,12`.
    expect(calcularTotaisOrdemCompra([{ orderedQuantity: "1", unitPrice: "0.125" }]).lineTotals)
      .toEqual(["0.13"]);
    // E o empate com a segunda casa ÍMPAR sobe também: 0,135 → 0,14.
    expect(calcularTotaisOrdemCompra([{ orderedQuantity: "1", unitPrice: "0.135" }]).lineTotals)
      .toEqual(["0.14"]);
    // A prova de que o modo viaja na chamada: com banker's ligado no processo,
    // o resultado não muda. A janela é síncrona e o global volta no `finally`.
    const original = Decimal.rounding;
    try {
      Decimal.set({ rounding: Decimal.ROUND_HALF_EVEN });
      expect(calcularTotaisOrdemCompra([{ orderedQuantity: "1", unitPrice: "0.125" }]).lineTotals)
        .toEqual(["0.13"]);
    } finally {
      Decimal.set({ rounding: original });
    }
    expect(Decimal.rounding).toBe(Decimal.ROUND_HALF_UP);
  });

  it("INVARIANTE do #18: orderTotal é sempre a soma dos lineTotals impressos", () => {
    /*
     * O contrato da capability, sobre um conjunto representativo: preço de 8
     * casas, empates de meio centavo para os dois lados, quantidade
     * fracionária, linha sem preço, zero explícito e valor ilegível. Se o
     * rodapé voltar a somar valores brutos, este teste é o que acusa.
     */
    const conjuntos: Parameters<typeof calcularTotaisOrdemCompra>[0][] = [
      [
        { orderedQuantity: "10", unitPrice: "4.05318764" },
        { orderedQuantity: "1", unitPrice: "0.125" },
        { orderedQuantity: "5", unitPrice: "0.025" },
      ],
      [
        { orderedQuantity: "3", unitPrice: "0.3333" },
        { orderedQuantity: "7", unitPrice: null },
        { orderedQuantity: "0.000000048", unitPrice: "1000000" },
        { orderedQuantity: "2", unitPrice: "0" },
      ],
      [
        { orderedQuantity: "1", unitPrice: "0.115" },
        { orderedQuantity: "1", unitPrice: "0.114" },
        { orderedQuantity: "2", unitPrice: "abc" },
        { orderedQuantity: "1000", unitPrice: "4.05318764" },
      ],
      Array.from({ length: 25 }, (_, i) => ({
        orderedQuantity: String(i + 1),
        unitPrice: "0.00500001",
      })),
    ];

    for (const linhas of conjuntos) {
      const r = calcularTotaisOrdemCompra(linhas);
      expect(r.orderTotal).toBe(somaDaColuna(r.lineTotals));
    }
  });
});
