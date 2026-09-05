import { Prisma } from "@prisma/client";
import type { QuotePaymentMethod, QuotePaymentScheduleDTO } from "@veridi/shared";
import { buildPaymentSchedule as calcularPlano } from "@veridi/shared";

/**
 * Plano de pagamento da proposta — adaptador sobre a função canônica.
 *
 * A aritmética vive em `@veridi/shared` porque a tela precisa mostrar o
 * efeito de mudar uma linha ANTES de salvar, e um segundo motor no navegador
 * divergiria do documento sem ninguém perceber. Aqui só se traduz o
 * `Prisma.Decimal` que vem do banco para a string que a função pura recebe.
 */

export interface PaymentPlanInput {
  subtotal: Prisma.Decimal;
  discountPercent: Prisma.Decimal | null;
  method: QuotePaymentMethod;
  downPaymentPercent: Prisma.Decimal | null;
  installmentCount: number | null;
  installmentIntervalDays: number | null;
  monthlyInterestPercent: Prisma.Decimal | null;
}

export function buildPaymentSchedule(input: PaymentPlanInput): QuotePaymentScheduleDTO {
  return calcularPlano({
    subtotal: input.subtotal.toString(),
    discountPercent: input.discountPercent ? input.discountPercent.toString() : null,
    method: input.method,
    downPaymentPercent: input.downPaymentPercent ? input.downPaymentPercent.toString() : null,
    installmentCount: input.installmentCount,
    installmentIntervalDays: input.installmentIntervalDays,
    monthlyInterestPercent: input.monthlyInterestPercent
      ? input.monthlyInterestPercent.toString()
      : null,
  });
}
