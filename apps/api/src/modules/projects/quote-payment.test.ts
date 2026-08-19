import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { buildPaymentSchedule } from "./quote-payment.js";

/**
 * Aritmética do plano de pagamento — golden fixo, conferido à mão.
 *
 * Sem valores esperados escritos por extenso, um erro na fórmula passaria
 * despercebido: o teste recalcularia o mesmo engano e concordaria consigo
 * mesmo. Os números abaixo saem da definição da Tabela Price, não do código.
 *
 * Estes testes não tocam o banco.
 */

const dec = (value: string) => new Prisma.Decimal(value);

/** Soma o que o cliente efetivamente desembolsa. */
function desembolso(plano: ReturnType<typeof buildPaymentSchedule>): string {
  return plano.installments
    .reduce((soma, parcela) => soma.plus(parcela.amount), new Prisma.Decimal(plano.downPayment ?? 0))
    .toFixed(2);
}

describe("Plano de pagamento — Tabela Price", () => {
  it("à vista: desconto entra, parcelas não existem", () => {
    const plano = buildPaymentSchedule({
      subtotal: dec("10000"),
      discountPercent: dec("10"),
      method: "CASH",
      downPaymentPercent: null,
      installmentCount: null,
      installmentIntervalDays: null,
      monthlyInterestPercent: null,
    });

    expect(plano.discountAmount).toBe("1000.00");
    expect(plano.total).toBe("9000.00");
    expect(plano.installments).toEqual([]);
    // Sem prazo não há juros: pagar à vista custa o preço à vista.
    expect(plano.totalPayable).toBe("9000.00");
    expect(plano.interestAmount).toBe("0.00");
  });

  it("parcelado sem juros: divide o financiado e a soma fecha", () => {
    const plano = buildPaymentSchedule({
      subtotal: dec("10000"),
      discountPercent: null,
      method: "INSTALLMENTS",
      downPaymentPercent: null,
      installmentCount: 4,
      installmentIntervalDays: 30,
      monthlyInterestPercent: null,
    });

    expect(plano.installments.map((p) => p.amount)).toEqual([
      "2500.00",
      "2500.00",
      "2500.00",
      "2500.00",
    ]);
    expect(plano.installments.map((p) => p.dueInDays)).toEqual([30, 60, 90, 120]);
    expect(plano.totalPayable).toBe("10000.00");
    expect(plano.interestAmount).toBe("0.00");
  });

  it("entrada mais parcelas sem juros", () => {
    const plano = buildPaymentSchedule({
      subtotal: dec("10000"),
      discountPercent: dec("10"),
      method: "INSTALLMENTS",
      downPaymentPercent: dec("20"),
      installmentCount: 3,
      installmentIntervalDays: 30,
      monthlyInterestPercent: null,
    });

    // 9.000,00 de total; entrada de 1.800,00; 7.200,00 em 3×.
    expect(plano.downPayment).toBe("1800.00");
    expect(plano.financedAmount).toBe("7200.00");
    expect(plano.installments.map((p) => p.amount)).toEqual(["2400.00", "2400.00", "2400.00"]);
    expect(desembolso(plano)).toBe("9000.00");
    expect(plano.totalPayable).toBe("9000.00");
  });

  it("GOLDEN — desconto, entrada, 3 parcelas e juros de 2% ao mês", () => {
    const plano = buildPaymentSchedule({
      subtotal: dec("10000"),
      discountPercent: dec("10"),
      method: "INSTALLMENTS",
      downPaymentPercent: dec("20"),
      installmentCount: 3,
      installmentIntervalDays: 30,
      monthlyInterestPercent: dec("2"),
    });

    /*
     * Conferência independente da implementação:
     *   subtotal      10.000,00
     *   desconto 10%   1.000,00  →  total 9.000,00
     *   entrada  20%   1.800,00  →  financiado 7.200,00
     *   PMT = 7200 × 0,02 / (1 − 1,02⁻³)
     *       = 144 / 0,05767736...  = 2.496,63
     *   desembolso = 1.800,00 + 3 × 2.496,63 = 9.289,89
     *   juros      = 9.289,89 − 9.000,00     =   289,89
     */
    expect(plano.subtotal).toBe("10000.00");
    expect(plano.discountAmount).toBe("1000.00");
    expect(plano.total).toBe("9000.00");
    expect(plano.downPayment).toBe("1800.00");
    expect(plano.financedAmount).toBe("7200.00");
    expect(plano.installments.map((p) => p.amount)).toEqual(["2496.63", "2496.63", "2496.63"]);
    expect(plano.totalPayable).toBe("9289.89");
    expect(plano.interestAmount).toBe("289.89");
    expect(desembolso(plano)).toBe(plano.totalPayable);
  });

  it("GOLDEN — 12 parcelas a 1,5% ao mês sobre 12.000,00", () => {
    const plano = buildPaymentSchedule({
      subtotal: dec("12000"),
      discountPercent: null,
      method: "INSTALLMENTS",
      downPaymentPercent: null,
      installmentCount: 12,
      installmentIntervalDays: 30,
      monthlyInterestPercent: dec("1.5"),
    });

    /*
     *   1,015¹²  = 1,1956182...
     *   1,015⁻¹² = 0,8363870...
     *   PMT = 12000 × 0,015 / (1 − 0,8363870)
     *       = 180 / 0,1636130  = 1.100,16
     *   desembolso = 12 × 1.100,16 = 13.201,92
     *   juros      = 13.201,92 − 12.000,00 = 1.201,92
     */
    expect(plano.installments).toHaveLength(12);
    expect(new Set(plano.installments.map((p) => p.amount))).toEqual(new Set(["1100.16"]));
    expect(plano.installments.at(-1)!.dueInDays).toBe(360);
    expect(plano.totalPayable).toBe("13201.92");
    expect(plano.interestAmount).toBe("1201.92");
  });

  it("centavos: a última parcela absorve o resto e a soma bate exatamente", () => {
    const plano = buildPaymentSchedule({
      subtotal: dec("10000"),
      discountPercent: null,
      method: "INSTALLMENTS",
      downPaymentPercent: null,
      installmentCount: 3,
      installmentIntervalDays: 30,
      monthlyInterestPercent: null,
    });

    // 10.000,00 / 3 não fecha em centavos: 3.333,33 × 3 = 9.999,99.
    expect(plano.installments.map((p) => p.amount)).toEqual([
      "3333.33",
      "3333.33",
      "3333.34",
    ]);
    // Uma proposta cujas linhas não somam o total destrói a confiança nela.
    expect(desembolso(plano)).toBe("10000.00");
    expect(plano.totalPayable).toBe("10000.00");
    expect(plano.interestAmount).toBe("0.00");
  });

  it("dinheiro sempre com duas casas — nada de R$ X,XXXXXX", () => {
    const plano = buildPaymentSchedule({
      subtotal: dec("7777.77"),
      discountPercent: dec("7.5"),
      method: "INSTALLMENTS",
      downPaymentPercent: dec("13"),
      installmentCount: 7,
      installmentIntervalDays: 30,
      monthlyInterestPercent: dec("1.99"),
    });

    const valores = [
      plano.subtotal,
      plano.discountAmount,
      plano.total,
      plano.downPayment!,
      plano.financedAmount!,
      plano.totalPayable,
      plano.interestAmount,
      ...plano.installments.map((p) => p.amount),
    ];
    for (const valor of valores) {
      expect(valor, `valor com casas demais: ${valor}`).toMatch(/^-?\d+\.\d{2}$/);
    }
    expect(desembolso(plano)).toBe(plano.totalPayable);
  });

  it("intervalo diferente de 30 dias converte a taxa mensal pelo expoente", () => {
    const quinzenal = buildPaymentSchedule({
      subtotal: dec("10000"),
      discountPercent: null,
      method: "INSTALLMENTS",
      downPaymentPercent: null,
      installmentCount: 2,
      installmentIntervalDays: 15,
      monthlyInterestPercent: dec("2"),
    });

    // Meio mês cobra menos que um mês inteiro — e os vencimentos acompanham.
    expect(quinzenal.installments.map((p) => p.dueInDays)).toEqual([15, 30]);
    expect(Number(quinzenal.interestAmount)).toBeGreaterThan(0);
    const mensal = buildPaymentSchedule({
      subtotal: dec("10000"),
      discountPercent: null,
      method: "INSTALLMENTS",
      downPaymentPercent: null,
      installmentCount: 2,
      installmentIntervalDays: 30,
      monthlyInterestPercent: dec("2"),
    });
    expect(Number(quinzenal.interestAmount)).toBeLessThan(Number(mensal.interestAmount));
  });

  it("juros zero é o mesmo que sem juros", () => {
    const plano = buildPaymentSchedule({
      subtotal: dec("6000"),
      discountPercent: null,
      method: "INSTALLMENTS",
      downPaymentPercent: null,
      installmentCount: 3,
      installmentIntervalDays: 30,
      monthlyInterestPercent: dec("0"),
    });

    expect(plano.installments.map((p) => p.amount)).toEqual(["2000.00", "2000.00", "2000.00"]);
    expect(plano.monthlyInterestPercent).toBeNull();
    expect(plano.interestAmount).toBe("0.00");
  });
});
