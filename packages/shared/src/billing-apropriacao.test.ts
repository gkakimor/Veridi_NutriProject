import { describe, expect, it } from "vitest";
import {
  calcularApropriacaoComercialDoFaturamento,
  calcularTotaisFaturamento,
  type ApropriacaoComercial,
  type FaturamentoAtivoAnterior,
} from "./billings.js";

/**
 * A apropriação comercial do Faturamento — BILL-DISCOUNT-01b.
 *
 * Dois defeitos, uma reconciliação só: o desconto global do Pedido não
 * chegava ao Faturamento, e partir uma linha em vários documentos já perdia
 * centavos por arredondamento MESMO SEM DESCONTO. O documento que fecha as
 * quantidades do Pedido absorve as duas diferenças.
 *
 * A invariante que todo cenário abaixo verifica: com o Pedido inteiramente
 * faturado por documentos ativos, `Σ totalAmount == agreedTotalAmount`,
 * exato, sem epsilon.
 */

const SEM_OVERRIDE = "0.00";

/** Simula a emissão sequencial de faturamentos de um mesmo Pedido. */
function emitirEmSequencia(
  pedido: { agreedSubtotalAmount: string | null; agreedTotalAmount: string | null },
  brutos: (string | null)[],
  opcoes: { overrideDelta?: string } = {},
): { resultados: ApropriacaoComercial[]; somaTotal: string } {
  const anteriores: FaturamentoAtivoAnterior[] = [];
  const resultados: ApropriacaoComercial[] = [];
  brutos.forEach((bruto, indice) => {
    const r = calcularApropriacaoComercialDoFaturamento({
      pedido,
      anteriores: [...anteriores],
      grossAmount: bruto,
      fechaOPedido: indice === brutos.length - 1,
      overrideDelta: opcoes.overrideDelta ?? SEM_OVERRIDE,
    });
    resultados.push(r);
    anteriores.push({
      grossAmount: bruto,
      discountAmount: r.discountAmount,
      totalAmount: r.totalAmount,
    });
  });
  const soma = resultados.reduce((s, r) => s + Number(r.totalAmount ?? 0), 0);
  return { resultados, somaTotal: soma.toFixed(2) };
}

/** O bruto de um documento, pela mesma conta que a API e a tela usam. */
const bruto = (quantidade: string, preco: string) =>
  calcularTotaisFaturamento([{ quantity: quantidade, unitPrice: preco }]).totalAmount;

describe("A. sem desconto, um faturamento único", () => {
  it("o documento vale o que as linhas somam, e o ajuste é zero", () => {
    const { resultados, somaTotal } = emitirEmSequencia(
      { agreedSubtotalAmount: "200.00", agreedTotalAmount: "200.00" },
      ["200.00"],
    );
    expect(resultados[0]).toEqual({
      discountAmount: "0.00",
      commercialAdjustmentAmount: "0.00",
      totalAmount: "200.00",
    });
    expect(somaTotal).toBe("200.00");
  });
});

describe("B. desconto de 10%, um faturamento único", () => {
  it("2 × R$ 100,00 com 10%: bruto 200,00, desconto 20,00, total 180,00", () => {
    expect(bruto("2", "100")).toBe("200.00");
    const { resultados, somaTotal } = emitirEmSequencia(
      { agreedSubtotalAmount: "200.00", agreedTotalAmount: "180.00" },
      ["200.00"],
    );
    expect(resultados[0]).toEqual({
      discountAmount: "20.00",
      commercialAdjustmentAmount: "0.00",
      totalAmount: "180.00",
    });
    expect(somaTotal).toBe("180.00");
  });
});

describe("C. desconto de 10% repartido em três faturamentos", () => {
  it("3 × R$ 100,00 em 1+1+1 fecha em 270,00", () => {
    const { resultados, somaTotal } = emitirEmSequencia(
      { agreedSubtotalAmount: "300.00", agreedTotalAmount: "270.00" },
      ["100.00", "100.00", "100.00"],
    );
    expect(resultados.map((r) => r.totalAmount)).toEqual(["90.00", "90.00", "90.00"]);
    expect(resultados.map((r) => r.discountAmount)).toEqual(["10.00", "10.00", "10.00"]);
    expect(resultados.every((r) => r.commercialAdjustmentAmount === "0.00")).toBe(true);
    expect(somaTotal).toBe("270.00");
  });
});

describe("D. resíduo de +0,01 — fragmentação SEM desconto (F-C)", () => {
  it("3 × R$ 33,3333 em três documentos: o fechamento soma o centavo que falta", () => {
    // Cada documento imprime 33,33; três somam 99,99 contra os 100,00 do Pedido.
    expect(bruto("1", "33.3333")).toBe("33.33");
    const { resultados, somaTotal } = emitirEmSequencia(
      { agreedSubtotalAmount: "100.00", agreedTotalAmount: "100.00" },
      ["33.33", "33.33", "33.33"],
    );
    expect(resultados.map((r) => r.commercialAdjustmentAmount)).toEqual(["0.00", "0.00", "0.01"]);
    expect(resultados.map((r) => r.totalAmount)).toEqual(["33.33", "33.33", "33.34"]);
    expect(somaTotal).toBe("100.00");
  });
});

describe("E. resíduo de −0,03 — fragmentação em sete documentos (F-C)", () => {
  it("7 × R$ 14,2857 em sete documentos: o fechamento devolve os três centavos", () => {
    expect(bruto("1", "14.2857")).toBe("14.29");
    const { resultados, somaTotal } = emitirEmSequencia(
      { agreedSubtotalAmount: "100.00", agreedTotalAmount: "100.00" },
      ["14.29", "14.29", "14.29", "14.29", "14.29", "14.29", "14.29"],
    );
    expect(resultados[6]!.commercialAdjustmentAmount).toBe("-0.03");
    expect(resultados[6]!.totalAmount).toBe("14.26");
    expect(somaTotal).toBe("100.00");
  });
});

describe("F. desconto E fragmentação juntos", () => {
  it("3 × R$ 33,3333 com 10% em 1+1+1 fecha exatamente em 90,00", () => {
    const { resultados, somaTotal } = emitirEmSequencia(
      { agreedSubtotalAmount: "100.00", agreedTotalAmount: "90.00" },
      ["33.33", "33.33", "33.33"],
    );
    // Desconto cumulativo: 3,33 · 3,34 · 3,33 = 10,00 exatos.
    expect(resultados.map((r) => r.discountAmount)).toEqual(["3.33", "3.34", "3.33"]);
    // O ajuste do fechamento é o centavo da fragmentação, e aparece separado.
    expect(resultados[2]).toEqual({
      discountAmount: "3.33",
      commercialAdjustmentAmount: "0.01",
      totalAmount: "30.01",
    });
    expect(somaTotal).toBe("90.00");
  });
});

describe("G/H. Pedido sem condição comercial congelada", () => {
  it("sem acordo, o documento vale as linhas e nada é reconciliado", () => {
    const { resultados } = emitirEmSequencia(
      { agreedSubtotalAmount: null, agreedTotalAmount: null },
      ["123.45"],
    );
    expect(resultados[0]).toEqual({
      discountAmount: "0.00",
      commercialAdjustmentAmount: "0.00",
      totalAmount: "123.45",
    });
  });

  it("desconto explicitamente zero: acordado == subtotal, desconto 0,00", () => {
    const { resultados, somaTotal } = emitirEmSequencia(
      { agreedSubtotalAmount: "150.00", agreedTotalAmount: "150.00" },
      ["50.00", "50.00", "50.00"],
    );
    expect(resultados.every((r) => r.discountAmount === "0.00")).toBe(true);
    expect(somaTotal).toBe("150.00");
  });

  it("precificação incompleta: nada é apropriado, tudo fica nulo", () => {
    const r = calcularApropriacaoComercialDoFaturamento({
      pedido: { agreedSubtotalAmount: "100.00", agreedTotalAmount: "90.00" },
      anteriores: [],
      grossAmount: null,
      fechaOPedido: true,
      overrideDelta: SEM_OVERRIDE,
    });
    expect(r).toEqual({
      discountAmount: null,
      commercialAdjustmentAmount: null,
      totalAmount: null,
    });
  });
});

describe("I. cem faturamentos de R$ 0,01 com 50% — o caso patológico", () => {
  it("apropria R$ 0,50 no total, não R$ 1,00", () => {
    const { resultados, somaTotal } = emitirEmSequencia(
      { agreedSubtotalAmount: "1.00", agreedTotalAmount: "0.50" },
      Array.from({ length: 100 }, () => "0.01"),
    );
    const descontoTotal = resultados.reduce((s, r) => s + Number(r.discountAmount), 0);
    // A estratégia ingênua — round(0,01 × 50%) = 0,01 em cada — daria 1,00.
    expect(descontoTotal.toFixed(2)).toBe("0.50");
    expect(somaTotal).toBe("0.50");
    // E nenhum documento fica com desconto maior que o próprio bruto.
    expect(resultados.every((r) => Number(r.discountAmount) <= 0.01)).toBe(true);
  });
});

describe("J. cancelamento e reemissão", () => {
  /*
   * `cancelBilling` hoje só aceita DRAFT — um faturamento EMITIDO é
   * histórico e não se cancela nesta fase. O algoritmo, porém, é definido
   * sobre o conjunto ATIVO: quem sair dele deixa de contar, e o documento
   * que voltar a completar as quantidades vira o novo fechamento. Estes
   * casos provam a mecânica, para o dia em que o domínio permitir.
   */
  const PEDIDO = { agreedSubtotalAmount: "300.00", agreedTotalAmount: "270.00" };

  it("cancelar o fechamento: A e B intactos, e C2 vira o novo fechamento", () => {
    const a = calcularApropriacaoComercialDoFaturamento({
      pedido: PEDIDO, anteriores: [], grossAmount: "100.00",
      fechaOPedido: false, overrideDelta: SEM_OVERRIDE,
    });
    const ativosA: FaturamentoAtivoAnterior[] = [
      { grossAmount: "100.00", discountAmount: a.discountAmount, totalAmount: a.totalAmount },
    ];
    const b = calcularApropriacaoComercialDoFaturamento({
      pedido: PEDIDO, anteriores: ativosA, grossAmount: "100.00",
      fechaOPedido: false, overrideDelta: SEM_OVERRIDE,
    });
    const ativosAB: FaturamentoAtivoAnterior[] = [
      ...ativosA,
      { grossAmount: "100.00", discountAmount: b.discountAmount, totalAmount: b.totalAmount },
    ];
    const c = calcularApropriacaoComercialDoFaturamento({
      pedido: PEDIDO, anteriores: ativosAB, grossAmount: "100.00",
      fechaOPedido: true, overrideDelta: SEM_OVERRIDE,
    });
    expect(c.totalAmount).toBe("90.00");

    // C cancelado: some do conjunto ativo. C2 nasce e volta a fechar.
    const c2 = calcularApropriacaoComercialDoFaturamento({
      pedido: PEDIDO, anteriores: ativosAB, grossAmount: "100.00",
      fechaOPedido: true, overrideDelta: SEM_OVERRIDE,
    });
    // A e B nunca foram recalculados, e o fechamento reconcilia de novo.
    expect(a.totalAmount).toBe("90.00");
    expect(b.totalAmount).toBe("90.00");
    expect(Number(a.totalAmount) + Number(b.totalAmount) + Number(c2.totalAmount)).toBeCloseTo(270, 10);
  });

  it("cancelar um intermediário: o fechamento anterior não muda, e B2 assume", () => {
    // A e C emitidos; B cancelado. B2 nasce e agora é ele que completa.
    const ativosAC: FaturamentoAtivoAnterior[] = [
      { grossAmount: "100.00", discountAmount: "10.00", totalAmount: "90.00" },
      { grossAmount: "100.00", discountAmount: "10.00", totalAmount: "90.00" },
    ];
    const b2 = calcularApropriacaoComercialDoFaturamento({
      pedido: PEDIDO, anteriores: ativosAC, grossAmount: "100.00",
      fechaOPedido: true, overrideDelta: SEM_OVERRIDE,
    });
    expect(b2.discountAmount).toBe("10.00");
    expect(b2.commercialAdjustmentAmount).toBe("0.00");
    expect(b2.totalAmount).toBe("90.00");
    expect(90 + 90 + Number(b2.totalAmount)).toBeCloseTo(270, 10);
  });
});

describe("K. preço unitário de quatro casas", () => {
  it("123 × R$ 4,0531 com 8% fecha no acordado", () => {
    // A linha vale 498,53 — sobre 4,0531, nunca sobre 4,05.
    expect(bruto("123", "4.0531")).toBe("498.53");
    const { resultados, somaTotal } = emitirEmSequencia(
      { agreedSubtotalAmount: "498.53", agreedTotalAmount: "458.65" },
      ["498.53"],
    );
    expect(resultados[0]!.discountAmount).toBe("39.88");
    expect(somaTotal).toBe("458.65");
  });
});

describe("L. ajuste zero", () => {
  it("quando os documentos já fecham, o fechamento não inventa ajuste", () => {
    const { resultados } = emitirEmSequencia(
      { agreedSubtotalAmount: "100.00", agreedTotalAmount: "90.00" },
      ["50.00", "50.00"],
    );
    expect(resultados.map((r) => r.commercialAdjustmentAmount)).toEqual(["0.00", "0.00"]);
    expect(resultados.map((r) => r.totalAmount)).toEqual(["45.00", "45.00"]);
  });
});

describe("M. override de preço move o alvo, e o ajuste não o engole", () => {
  /*
   * Override é exceção comercial DELIBERADA e a diferença entre acordado e
   * faturado é a evidência dela. O fechamento reconcilia contra
   * `acordado + delta do override` — absorve arredondamento, nunca a decisão.
   */
  it("faturar R$ 10,00 acima do acordado deixa o total final R$ 10,00 acima", () => {
    const { resultados, somaTotal } = emitirEmSequencia(
      { agreedSubtotalAmount: "200.00", agreedTotalAmount: "180.00" },
      ["210.00"],
      { overrideDelta: "10.00" },
    );
    expect(resultados[0]!.discountAmount).toBe("20.00");
    expect(resultados[0]!.commercialAdjustmentAmount).toBe("0.00");
    expect(somaTotal).toBe("190.00");
  });

  it("sem override o alvo continua sendo exatamente o acordado", () => {
    const { somaTotal } = emitirEmSequencia(
      { agreedSubtotalAmount: "200.00", agreedTotalAmount: "180.00" },
      ["200.00"],
    );
    expect(somaTotal).toBe("180.00");
  });
});
