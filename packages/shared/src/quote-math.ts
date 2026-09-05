/**
 * A aritmética do Orçamento — uma só, para a API, para o documento impresso
 * e para a prévia da tela.
 *
 * Nada aqui é digitado: quantidade, preço, desconto, entrada, prazo e juros
 * entram; subtotal, desconto em reais, preço à vista, entrada, parcelas e
 * juros totais saem. Valor de parcela editável faria a proposta impressa e a
 * conta do sistema saírem de fontes diferentes — e divergirem sem ninguém
 * perceber.
 *
 * O parcelamento com juros é Tabela Price: parcelas iguais, juros sobre o
 * saldo devedor. Sem juros, é a divisão simples.
 */

import Decimal from "decimal.js";
import type {
  QuoteInstallmentDTO,
  QuotePaymentMethod,
  QuotePaymentScheduleDTO,
} from "./projects.js";

const CEM = new Decimal(100);
const CENTAVO = new Decimal("0.01");
const TRINTA_DIAS = new Decimal(30);

function dinheiro(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Uma linha da proposta, como está gravada ou como está sendo digitada. */
export interface LinhaParaTotalDoOrcamento {
  /** `null` = ainda não informada; texto ilegível também chega como `null`. */
  quotedQuantity: string | null;
  /** `null` = ainda não precificada; `"0"` é preço zero explícito. */
  unitPrice: string | null;
}

export interface TotaisDoOrcamento {
  /** `quotedQuantity × unitPrice` por linha, 2 casas; `null` sem um dos dois. */
  lineTotals: (string | null)[];
  /**
   * Soma das linhas ANTES do desconto — só existe quando TODAS têm total.
   * Somar o que está precificado e ignorar o resto entregaria um número
   * menor que a proposta, com cara de total.
   */
  subtotal: string | null;
}

export function calcularTotaisOrcamento(
  lines: LinhaParaTotalDoOrcamento[],
): TotaisDoOrcamento {
  const lineTotals: (string | null)[] = [];
  for (const line of lines) {
    if (line.quotedQuantity === null || line.unitPrice === null) {
      lineTotals.push(null);
      continue;
    }
    let total: Decimal;
    try {
      total = new Decimal(line.quotedQuantity).times(line.unitPrice);
    } catch {
      lineTotals.push(null);
      continue;
    }
    lineTotals.push(total.isFinite() ? total.toFixed(2) : null);
  }
  const completo = lines.length > 0 && lineTotals.every((total) => total !== null);
  const subtotal = completo
    ? lineTotals.reduce((sum, total) => sum.plus(new Decimal(total!)), new Decimal(0)).toFixed(2)
    : null;
  return { lineTotals, subtotal };
}

/** Entradas do plano, como decimais em string — nunca float. */
export interface PlanoDePagamentoInput {
  subtotal: string;
  discountPercent: string | null | undefined;
  method: QuotePaymentMethod;
  downPaymentPercent: string | null | undefined;
  installmentCount: number | null | undefined;
  installmentIntervalDays: number | null | undefined;
  monthlyInterestPercent: string | null | undefined;
}

/**
 * Percentual opcional como `Decimal` — ausente ou ilegível vira `null`.
 *
 * Esta função roda a cada tecla numa tela: um percentual que o contrato não
 * trouxe (ou que veio inválido) não pode derrubar o render inteiro. Ausência
 * é ausência, e o plano segue sem ela.
 */
function percentualOuNulo(valor: string | null | undefined): Decimal | null {
  if (valor === null || valor === undefined || valor === "") return null;
  try {
    const numero = new Decimal(valor);
    return numero.isFinite() ? numero : null;
  } catch {
    return null;
  }
}

/**
 * Taxa do PERÍODO a partir da taxa mensal.
 *
 * A taxa é declarada ao mês porque é assim que se negocia. Quando o intervalo
 * entre parcelas não é de 30 dias, converter proporcionalmente no expoente
 * mantém o juro equivalente — dividir por 30 e multiplicar pelos dias daria
 * um número diferente do que o cliente pagaria de fato.
 */
function taxaDoPeriodo(mensal: Decimal, dias: number): Decimal {
  if (mensal.isZero()) return new Decimal(0);
  const taxa = mensal.dividedBy(CEM);
  if (dias === 30) return taxa;
  const expoente = new Decimal(dias).dividedBy(TRINTA_DIAS);
  return taxa.plus(1).pow(expoente).minus(1);
}

/** Price: PMT = PV × i / (1 − (1+i)^−n). Sem juros, PV / n. */
function parcelaPrice(financiado: Decimal, taxa: Decimal, parcelas: number): Decimal {
  if (taxa.isZero()) return financiado.dividedBy(parcelas);
  const fator = taxa.plus(1).pow(-parcelas);
  return financiado.times(taxa).dividedBy(new Decimal(1).minus(fator));
}

export function buildPaymentSchedule(input: PlanoDePagamentoInput): QuotePaymentScheduleDTO {
  const subtotal = dinheiro(new Decimal(input.subtotal));
  const percentual = percentualOuNulo(input.discountPercent);
  const desconto =
    percentual && !percentual.isZero()
      ? dinheiro(subtotal.times(percentual).dividedBy(CEM))
      : new Decimal(0);
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
  const entradaPercentual = percentualOuNulo(input.downPaymentPercent);
  const entrada =
    entradaPercentual && !entradaPercentual.isZero()
      ? dinheiro(total.times(entradaPercentual).dividedBy(CEM))
      : new Decimal(0);
  const financiado = total.minus(entrada);

  const mensal = percentualOuNulo(input.monthlyInterestPercent) ?? new Decimal(0);
  const taxa = taxaDoPeriodo(mensal, intervalo);
  const valorParcela = dinheiro(parcelaPrice(financiado, taxa, parcelas));

  /*
   * O resíduo de centavos vai na ÚLTIMA parcela. Alguma tem que absorver a
   * diferença, senão a soma impressa não bate com o total — e uma proposta
   * que não fecha na conta destrói a confiança no documento inteiro.
   */
  const somaDasIguais = valorParcela.times(parcelas - 1);
  const semJuros = taxa.isZero();
  const ultima = semJuros ? dinheiro(financiado.minus(somaDasIguais)) : valorParcela;

  const lista: QuoteInstallmentDTO[] = [];
  for (let numero = 1; numero <= parcelas; numero += 1) {
    lista.push({
      number: numero,
      amount: (numero === parcelas ? ultima : valorParcela).toFixed(2),
      dueInDays: numero * intervalo,
    });
  }

  const somaParcelas = lista.reduce(
    (soma, parcela) => soma.plus(new Decimal(parcela.amount)),
    new Decimal(0),
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
      ? new Decimal(0)
      : juros
    ).toFixed(2),
  };
}
