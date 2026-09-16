/**
 * Forma e condição de pagamento — o vocabulário comum de Cliente, Orçamento e
 * Pedido (CUSTOMER-PAYMENT-DEFAULTS-01).
 *
 * Duas perguntas diferentes, que o produto chegou a chamar pelo mesmo nome:
 *
 * - **Forma de pagamento** é o MEIO — PIX, boleto, transferência, cartão.
 *   `PaymentInstrument`. Não mexe em valor, juros, desconto nem vencimento.
 * - **Condição de pagamento** é o PRAZO — à vista ou parcelado, com entrada,
 *   parcelas, intervalo e juros. `QuotePaymentMethod` e os quatro campos do
 *   parcelamento; o plano é derivado deles (`buildPaymentSchedule`).
 *
 * O texto livre `paymentTerms` não é nenhuma das duas: no documento ele é
 * "Observações de pagamento".
 */

import type { QuotePaymentMethod } from "./projects.js";

/**
 * As formas, na ordem do seletor. O enum do banco (`PaymentInstrument`) tem os
 * mesmos valores, e um teste da API confere as duas listas. "Não informada" não
 * é valor da lista: é `null`, no Cliente, na versão e no Pedido.
 */
export const PAYMENT_INSTRUMENTS = ["PIX", "BOLETO", "BANK_TRANSFER", "CARD", "OTHER"] as const;

export type PaymentInstrument = (typeof PAYMENT_INSTRUMENTS)[number];

export const PAYMENT_INSTRUMENT_LABELS: Record<PaymentInstrument, string> = {
  PIX: "PIX",
  BOLETO: "Boleto",
  BANK_TRANSFER: "Transferência",
  CARD: "Cartão",
  OTHER: "Outro",
};

/**
 * O pagamento padrão do Cliente — SUGESTÃO para novos orçamentos, nunca
 * autoridade viva.
 *
 * Copiado para a V1 do Orçamento quando ela nasce e oferecido ao rascunho por
 * "Aplicar padrão do cliente"; alterar o Cliente depois não muda versão nem
 * Pedido. Tudo `null` é o cliente sem padrão — todo cliente anterior a esta
 * capability. Condição `null` ou `CASH` não guarda parcelamento.
 */
export interface CustomerPaymentDefaultsDTO {
  defaultPaymentInstrument: PaymentInstrument | null;
  defaultPaymentMethod: QuotePaymentMethod | null;
  defaultDownPaymentPercent: string | null;
  defaultInstallmentCount: number | null;
  defaultInstallmentIntervalDays: number | null;
  defaultMonthlyInterestPercent: string | null;
}

/**
 * "Parcelado" sem número de parcelas não é condição: o plano derivado sairia à
 * vista enquanto a proposta diz parcelado. A API recusa gravar esse estado —
 * no padrão do Cliente, nas condições do Orçamento, na simulação e no envio —,
 * e a tela recusa o mesmo, ao lado do campo, com a mesma frase.
 */
export const PARCELADO_SEM_PARCELAS_MESSAGE = "Parcelado exige o número de parcelas.";

export function parceladoSemParcelas(
  method: QuotePaymentMethod | null | undefined,
  installmentCount: number | null | undefined,
): boolean {
  return method === "INSTALLMENTS" && (installmentCount === null || installmentCount === undefined);
}
