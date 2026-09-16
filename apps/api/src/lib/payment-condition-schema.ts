import { z } from "zod";
import { LIMITES_INTEIROS_DAS_CONDICOES, PAYMENT_INSTRUMENTS } from "@veridi/shared";
import { optionalDecimalStringSchema } from "./decimal-schema.js";
import { lerInteiroDecimal } from "./integer-schema.js";

/**
 * Os campos de forma e condição de pagamento, uma vez só — as condições do
 * Orçamento e o pagamento padrão do Cliente (CUSTOMER-PAYMENT-DEFAULTS-01) usam
 * os MESMOS limites e as mesmas mensagens. Duas cópias divergiriam na primeira
 * vez que alguém mexesse num teto de um lado só.
 */

const optionalDecimal = optionalDecimalStringSchema();

/** Inteiro opcional maior que zero; `null` e `""` são "não informado". */
export const optionalPositiveInt = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    // Leitura estrita (API-INT-COERCION-01): o que não é inteiro decimal
    // canônico vira NaN e cai na mesma recusa abaixo.
    return lerInteiroDecimal(value) ?? Number.NaN;
  })
  .refine((value) => value === undefined || value === null || (Number.isInteger(value) && value > 0), {
    message: "Informe um número inteiro maior que zero",
  });

/** Percentual opcional com teto — desconto de 100% não é desconto, é doação. */
export function optionalPercent(max: number) {
  return optionalDecimal.refine(
    (value) => value === undefined || value === null || Number(value) <= max,
    { message: `Percentual precisa ser no máximo ${max}` },
  );
}

/** À vista ou parcelado — a CONDIÇÃO. */
export const paymentMethodSchema = z.enum(["CASH", "INSTALLMENTS"], {
  errorMap: () => ({ message: "Condição de pagamento inválida" }),
});

/** PIX, boleto... — a FORMA. Valor fora da lista para aqui, em 400, antes do Prisma. */
export const paymentInstrumentSchema = z.enum(PAYMENT_INSTRUMENTS, {
  errorMap: () => ({ message: "Forma de pagamento inválida" }),
});

/** Os quatro campos do parcelamento, com os limites que a tela também aplica. */
export const camposDoParcelamento = {
  // Entrada de 100% seria a proposta à vista com outro nome.
  downPaymentPercent: optionalPercent(99.99),
  // Os tetos são os mesmos que a tela aplica: uma fonte só, em @veridi/shared
  // (QUOTE-INT-FIELDS-01). O mínimo é o `> 0` de `optionalPositiveInt`.
  installmentCount: optionalPositiveInt.refine(
    (value) =>
      value === undefined ||
      value === null ||
      value <= LIMITES_INTEIROS_DAS_CONDICOES.installmentCount.maximo,
    { message: `No máximo ${LIMITES_INTEIROS_DAS_CONDICOES.installmentCount.maximo} parcelas` },
  ),
  installmentIntervalDays: optionalPositiveInt.refine(
    (value) =>
      value === undefined ||
      value === null ||
      value <= LIMITES_INTEIROS_DAS_CONDICOES.installmentIntervalDays.maximo,
    {
      message: `Intervalo entre parcelas: no máximo ${LIMITES_INTEIROS_DAS_CONDICOES.installmentIntervalDays.maximo} dias`,
    },
  ),
  monthlyInterestPercent: optionalPercent(100),
};
