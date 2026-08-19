import { Prisma } from "@prisma/client";
import type {
  QuoteInstallmentDTO,
  QuotePaymentMethod,
  QuotePaymentScheduleDTO,
} from "@veridi/shared";

/**
 * Plano de pagamento da proposta.
 *
 * Nada aqui é digitado: subtotal, desconto, entrada, prazo e juros entram;
 * desconto em reais, preço à vista, entrada, parcelas e juros totais saem.
 * Valor de parcela editável faria a proposta impressa e a conta do sistema
 * saírem de fontes diferentes — e divergirem sem ninguém perceber.
 *
 * O parcelamento com juros é Tabela Price: parcelas iguais, juros sobre o
 * saldo devedor. Sem juros, é a divisão simples.
 */

const CEM = new Prisma.Decimal(100);
const CENTAVO = new Prisma.Decimal("0.01");
const TRINTA_DIAS = new Prisma.Decimal(30);

export interface PaymentPlanInput {
  subtotal: Prisma.Decimal;
  discountPercent: Prisma.Decimal | null;
  method: QuotePaymentMethod;
  downPaymentPercent: Prisma.Decimal | null;
  installmentCount: number | null;
  installmentIntervalDays: number | null;
  monthlyInterestPercent: Prisma.Decimal | null;
}

function dinheiro(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Taxa do PERÍODO a partir da taxa mensal.
 *
 * A taxa é declarada ao mês porque é assim que se negocia. Quando o intervalo
 * entre parcelas não é de 30 dias, converter proporcionalmente no expoente
 * mantém o juro equivalente — dividir por 30 e multiplicar pelos dias daria
 * um número diferente do que o cliente pagaria de fato.
 */
function taxaDoPeriodo(mensal: Prisma.Decimal, dias: number): Prisma.Decimal {
  if (mensal.isZero()) return new Prisma.Decimal(0);
  const taxa = mensal.dividedBy(CEM);
  if (dias === 30) return taxa;
  const expoente = new Prisma.Decimal(dias).dividedBy(TRINTA_DIAS);
  return taxa.plus(1).pow(expoente).minus(1);
}

/** Price: PMT = PV × i / (1 − (1+i)^−n). Sem juros, PV / n. */
function parcelaPrice(
  financiado: Prisma.Decimal,
  taxa: Prisma.Decimal,
  parcelas: number,
): Prisma.Decimal {
  if (taxa.isZero()) return financiado.dividedBy(parcelas);
  const fator = taxa.plus(1).pow(-parcelas);
  return financiado.times(taxa).dividedBy(new Prisma.Decimal(1).minus(fator));
}

export function buildPaymentSchedule(input: PaymentPlanInput): QuotePaymentScheduleDTO {
  const subtotal = dinheiro(input.subtotal);
  const percentual = input.discountPercent;
  const desconto =
    percentual && !percentual.isZero() ? dinheiro(subtotal.times(percentual).dividedBy(CEM)) : new Prisma.Decimal(0);
  const total = dinheiro(subtotal.minus(desconto));

  const base = {
    subtotal: subtotal.toFixed(2),
    discountPercent: percentual ? percentual.toFixed(4) : null,
    discountAmount: desconto.toFixed(2),
    total: total.toFixed(2),
    method: input.method,
  };

  const parcelas = input.installmentCount ?? 0;
  if (input.method === "CASH" || parcelas < 1) {
    return {
      ...base,
      method: "CASH",
      downPaymentPercent: null,
      downPayment: null,
      financedAmount: null,
      monthlyInterestPercent: null,
      installmentIntervalDays: null,
      installments: [],
      totalPayable: total.toFixed(2),
      interestAmount: "0.00",
    };
  }

  const intervalo = input.installmentIntervalDays ?? 30;
  const entradaPercentual = input.downPaymentPercent;
  const entrada =
    entradaPercentual && !entradaPercentual.isZero()
      ? dinheiro(total.times(entradaPercentual).dividedBy(CEM))
      : new Prisma.Decimal(0);
  const financiado = total.minus(entrada);

  const mensal = input.monthlyInterestPercent ?? new Prisma.Decimal(0);
  const taxa = taxaDoPeriodo(mensal, intervalo);
  const valorParcela = dinheiro(parcelaPrice(financiado, taxa, parcelas));

  /*
   * O resíduo de centavos vai na ÚLTIMA parcela. Alguma tem que absorver a
   * diferença, senão a soma impressa não bate com o total — e uma proposta
   * que não fecha na conta destrói a confiança no documento inteiro.
   */
  const somaDasIguais = valorParcela.times(parcelas - 1);
  const semJuros = taxa.isZero();
  const ultima = semJuros
    ? dinheiro(financiado.minus(somaDasIguais))
    : valorParcela;

  const lista: QuoteInstallmentDTO[] = [];
  for (let numero = 1; numero <= parcelas; numero += 1) {
    lista.push({
      number: numero,
      amount: (numero === parcelas ? ultima : valorParcela).toFixed(2),
      dueInDays: numero * intervalo,
    });
  }

  const somaParcelas = lista.reduce(
    (soma, parcela) => soma.plus(new Prisma.Decimal(parcela.amount)),
    new Prisma.Decimal(0),
  );
  const aPagar = dinheiro(entrada.plus(somaParcelas));
  const juros = aPagar.minus(total);

  return {
    ...base,
    method: "INSTALLMENTS",
    downPaymentPercent: entradaPercentual ? entradaPercentual.toFixed(4) : null,
    downPayment: entrada.toFixed(2),
    financedAmount: financiado.toFixed(2),
    monthlyInterestPercent: mensal.isZero() ? null : mensal.toFixed(4),
    installmentIntervalDays: intervalo,
    installments: lista,
    totalPayable: aPagar.toFixed(2),
    interestAmount: (juros.lessThan(CENTAVO) && juros.greaterThan(CENTAVO.negated())
      ? new Prisma.Decimal(0)
      : juros
    ).toFixed(2),
  };
}
