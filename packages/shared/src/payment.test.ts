import { describe, expect, it } from "vitest";
import {
  PARCELADO_SEM_PARCELAS_MESSAGE,
  PAYMENT_INSTRUMENTS,
  PAYMENT_INSTRUMENT_LABELS,
  parceladoSemParcelas,
} from "./payment.js";
import { buildPaymentSchedule } from "./quote-math.js";

/**
 * Forma e condição de pagamento — o vocabulário comum (CUSTOMER-PAYMENT-DEFAULTS-01).
 *
 * A paridade da lista com o enum do banco está no teste da API
 * (`customer-payment-defaults.test.ts`); aqui ficam os rótulos e a regra
 * "parcelado exige parcelas" que API e tela aplicam com a mesma função.
 */
describe("formas de pagamento", () => {
  it("cinco formas, na ordem do seletor, cada uma com rótulo em português", () => {
    expect([...PAYMENT_INSTRUMENTS]).toEqual(["PIX", "BOLETO", "BANK_TRANSFER", "CARD", "OTHER"]);
    expect(PAYMENT_INSTRUMENTS.map((forma) => PAYMENT_INSTRUMENT_LABELS[forma])).toEqual([
      "PIX",
      "Boleto",
      "Transferência",
      "Cartão",
      "Outro",
    ]);
  });
});

describe("parcelado exige parcelas", () => {
  it.each([
    ["INSTALLMENTS", null, true],
    ["INSTALLMENTS", undefined, true],
    ["INSTALLMENTS", 1, false],
    ["INSTALLMENTS", 120, false],
    ["CASH", null, false],
    [null, null, false],
    [undefined, undefined, false],
  ] as const)("condição %s com %s parcelas: recusa = %s", (method, parcelas, recusa) => {
    expect(parceladoSemParcelas(method, parcelas)).toBe(recusa);
  });

  it("a frase é uma só, e diz o que falta", () => {
    expect(PARCELADO_SEM_PARCELAS_MESSAGE).toBe("Parcelado exige o número de parcelas.");
  });

  it("é o estado que o plano não sabe representar: parcelado sem parcelas sai à vista", () => {
    // A conta do plano não mudou — por isso a gravação desse estado é recusada.
    const plano = buildPaymentSchedule({
      subtotal: "1000.00",
      discountPercent: null,
      method: "INSTALLMENTS",
      downPaymentPercent: "20",
      installmentCount: null,
      installmentIntervalDays: 30,
      monthlyInterestPercent: null,
    });
    expect(plano.method).toBe("CASH");
    expect(plano.installments).toEqual([]);
  });
});
