import { QUOTE_PAYMENT_METHOD_LABELS } from "@veridi/shared";
import type { QuotePaymentScheduleDTO } from "@veridi/shared";
import { formatBRL } from "./currency";
import { formatPercent } from "./percent";

/**
 * A condição de pagamento de uma proposta, em uma linha legível.
 *
 * "Parcelado — entrada de R$ 2.250,00 e 3× de R$ 2.318,02, juros de 2% ao mês".
 *
 * A frase nasceu dentro da Origem Comercial do Pedido e passou a ser precisa
 * em duas telas — lá e no resumo comercial do Projeto. Duas cópias divergiriam
 * na primeira vez que alguém acertasse o texto de um lado só, e a divergência
 * seria sobre DINHEIRO: o Pedido diria uma condição e o Projeto outra, sobre a
 * mesma proposta.
 *
 * É APRESENTAÇÃO, e só. Nada aqui calcula: entrada, parcelas, juros e total a
 * prazo já vêm derivados do servidor em `paymentSchedule`, porque valor de
 * parcela não se digita e não se recalcula no navegador. O helper mora em
 * `lib/` de propósito — o Projeto não pode importar a UI do Pedido para ler
 * uma frase.
 */
export function condicaoDePagamentoPorExtenso(
  plano: QuotePaymentScheduleDTO | null | undefined,
): string {
  if (!plano) return "—";

  const metodo = QUOTE_PAYMENT_METHOD_LABELS[plano.method];
  // À vista não tem parcela para descrever; parcelamento sem parcela derivada
  // é dado incompleto, e inventar "0×" seria pior que dizer só o método.
  if (plano.method !== "INSTALLMENTS" || plano.installments.length === 0) return metodo;

  const entrada =
    Number(plano.downPayment ?? 0) > 0 ? `entrada de ${formatBRL(plano.downPayment)} e ` : "";
  const juros = plano.monthlyInterestPercent
    ? `, juros de ${formatPercent(plano.monthlyInterestPercent)} ao mês`
    : " sem juros";

  return `${metodo} — ${entrada}${plano.installments.length}× de ${formatBRL(plano.installments[0]!.amount)}${juros}`;
}
