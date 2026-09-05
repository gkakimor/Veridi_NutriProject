import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { buildPaymentSchedule, calcularTotaisOrcamento } from "./quote-math.js";

/**
 * A aritmética do Orçamento — a mesma para o documento (API), para a proposta
 * impressa e para a prévia da tela enquanto alguém edita a versão em rascunho.
 *
 * O plano de pagamento tem golden próprio em
 * `apps/api/src/modules/projects/quote-payment.test.ts`; aqui prova-se o total
 * das linhas e a costura entre os dois.
 */
describe("calcularTotaisOrcamento", () => {
  it("quantidade × preço por linha e subtotal como soma das linhas", () => {
    const r = calcularTotaisOrcamento([
      { quotedQuantity: "1000", unitPrice: "12.5000" },
      { quotedQuantity: "500", unitPrice: "9.7203" },
    ]);
    expect(r.lineTotals).toEqual(["12500.00", "4860.15"]);
    expect(r.subtotal).toBe("17360.15");
  });

  it("linha sem preço deixa a proposta sem subtotal — parcial não existe", () => {
    const r = calcularTotaisOrcamento([
      { quotedQuantity: "10", unitPrice: "5" },
      { quotedQuantity: "10", unitPrice: null },
    ]);
    expect(r.lineTotals).toEqual(["50.00", null]);
    expect(r.subtotal).toBeNull();
  });

  it("linha sem quantidade também não vira zero", () => {
    const r = calcularTotaisOrcamento([{ quotedQuantity: null, unitPrice: "5" }]);
    expect(r.lineTotals).toEqual([null]);
    expect(r.subtotal).toBeNull();
  });

  it("valor ilegível não produz NaN nem total falso", () => {
    const r = calcularTotaisOrcamento([{ quotedQuantity: "abc", unitPrice: "5" }]);
    expect(r.lineTotals).toEqual([null]);
    expect(r.subtotal).toBeNull();
  });

  it("proposta sem linha nenhuma não tem subtotal", () => {
    expect(calcularTotaisOrcamento([]).subtotal).toBeNull();
  });

  it("preço zero explícito é preço", () => {
    const r = calcularTotaisOrcamento([{ quotedQuantity: "10", unitPrice: "0" }]);
    expect(r.lineTotals).toEqual(["0.00"]);
    expect(r.subtotal).toBe("0.00");
  });

  it("muitas linhas somam exato em decimal", () => {
    const linhas = Array.from({ length: 10 }, () => ({
      quotedQuantity: "0.1",
      unitPrice: "3",
    }));
    expect(calcularTotaisOrcamento(linhas).subtotal).toBe("3.00");
  });

  /*
   * BACKLOG #15 — a regra comercial canônica, provada no caso em que as duas
   * candidatas divergem.
   */
  it("subtotal é a soma das linhas ARREDONDADAS, não o arredondamento da soma", () => {
    const linhas = [
      { quotedQuantity: "7", unitPrice: "12.3450" },
      { quotedQuantity: "7", unitPrice: "12.3450" },
    ];
    const r = calcularTotaisOrcamento(linhas);

    // Cada linha: 7 × 12,3450 = 86,415 → R$ 86,42 impresso.
    expect(r.lineTotals).toEqual(["86.42", "86.42"]);
    // Σ round(linha) = 172,84. round(Σ bruto = 172,83) daria 172,83.
    expect(r.subtotal).toBe("172.84");
    expect(r.subtotal).not.toBe("172.83");

    // O documento fecha com o que o cliente confere: as linhas.
    const somaDoQueEstaImpresso = new Decimal(r.lineTotals[0]!)
      .plus(r.lineTotals[1]!)
      .toFixed(2);
    expect(r.subtotal).toBe(somaDoQueEstaImpresso);

    // E a regra antiga, escrita à mão, é de fato o outro número — o teste
    // vale porque as duas contas divergem neste caso.
    const regraAntiga = new Decimal("7")
      .times("12.3450")
      .plus(new Decimal("7").times("12.3450"))
      .toFixed(2);
    expect(regraAntiga).toBe("172.83");
  });

  it("o desconto e o total incidem sobre o subtotal já reconciliado", () => {
    const { subtotal } = calcularTotaisOrcamento([
      { quotedQuantity: "7", unitPrice: "12.3450" },
      { quotedQuantity: "7", unitPrice: "12.3450" },
    ]);
    const plano = buildPaymentSchedule({
      subtotal: subtotal!,
      discountPercent: null,
      method: "CASH",
      downPaymentPercent: null,
      installmentCount: null,
      installmentIntervalDays: null,
      monthlyInterestPercent: null,
    });
    expect(plano.subtotal).toBe("172.84");
    expect(plano.total).toBe("172.84");
  });
});

describe("buildPaymentSchedule sobre o subtotal das linhas", () => {
  it("à vista sem desconto: total é o subtotal", () => {
    const { subtotal } = calcularTotaisOrcamento([
      { quotedQuantity: "100", unitPrice: "12.50" },
    ]);
    const plano = buildPaymentSchedule({
      subtotal: subtotal!,
      discountPercent: null,
      method: "CASH",
      downPaymentPercent: null,
      installmentCount: null,
      installmentIntervalDays: null,
      monthlyInterestPercent: null,
    });
    expect(plano.subtotal).toBe("1250.00");
    expect(plano.discountAmount).toBe("0.00");
    expect(plano.total).toBe("1250.00");
    expect(plano.totalPayable).toBe("1250.00");
  });

  it("desconto de 10% sai do subtotal e o total é o preço à vista", () => {
    const plano = buildPaymentSchedule({
      subtotal: "1250.00",
      discountPercent: "10",
      method: "CASH",
      downPaymentPercent: null,
      installmentCount: null,
      installmentIntervalDays: null,
      monthlyInterestPercent: null,
    });
    expect(plano.discountAmount).toBe("125.00");
    expect(plano.total).toBe("1125.00");
  });

  it("parcelado sem juros: soma das parcelas fecha com o total", () => {
    const plano = buildPaymentSchedule({
      subtotal: "1000.00",
      discountPercent: null,
      method: "INSTALLMENTS",
      downPaymentPercent: null,
      installmentCount: 3,
      installmentIntervalDays: null,
      monthlyInterestPercent: null,
    });
    expect(plano.installments.map((p) => p.amount)).toEqual(["333.33", "333.33", "333.34"]);
    expect(plano.totalPayable).toBe("1000.00");
    expect(plano.interestAmount).toBe("0.00");
  });

  it("percentual ausente do contrato não derruba a conta — a tela recalcula a cada tecla", () => {
    const plano = buildPaymentSchedule({
      subtotal: "1000.00",
      discountPercent: undefined,
      method: "CASH",
      downPaymentPercent: undefined,
      installmentCount: undefined,
      installmentIntervalDays: undefined,
      monthlyInterestPercent: undefined,
    });
    expect(plano.total).toBe("1000.00");
    expect(plano.discountPercent).toBeNull();
  });

  it("mudar UMA linha muda o total da proposta pela mesma conta", () => {
    const antes = calcularTotaisOrcamento([
      { quotedQuantity: "100", unitPrice: "12.50" },
      { quotedQuantity: "10", unitPrice: "20.00" },
    ]);
    const depois = calcularTotaisOrcamento([
      { quotedQuantity: "100", unitPrice: "13.25" },
      { quotedQuantity: "10", unitPrice: "20.00" },
    ]);
    expect(antes.subtotal).toBe("1450.00");
    expect(depois.subtotal).toBe("1525.00");

    const condicoes = {
      discountPercent: "10",
      method: "CASH" as const,
      downPaymentPercent: null,
      installmentCount: null,
      installmentIntervalDays: null,
      monthlyInterestPercent: null,
    };
    expect(buildPaymentSchedule({ subtotal: antes.subtotal!, ...condicoes }).total).toBe("1305.00");
    expect(buildPaymentSchedule({ subtotal: depois.subtotal!, ...condicoes }).total).toBe(
      "1372.50",
    );
  });
});
