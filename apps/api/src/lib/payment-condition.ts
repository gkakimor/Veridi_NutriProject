import { Prisma } from "@prisma/client";
import type { Customer } from "@prisma/client";
import type { CustomerPaymentDefaultsDTO, QuotePaymentMethod } from "@veridi/shared";
import { PARCELADO_SEM_PARCELAS_MESSAGE, parceladoSemParcelas } from "@veridi/shared";

/**
 * Forma e condição de pagamento no domínio — CUSTOMER-PAYMENT-DEFAULTS-01.
 *
 * Duas regras moram aqui porque valem para o Cliente e para o Orçamento:
 *
 * 1. **Parcelado exige parcelas.** `INSTALLMENTS` sem `installmentCount` era
 *    aceito, e o plano derivado saía à vista: a proposta dizia "Parcelado" e o
 *    PDF e o Pedido diziam "À vista". Agora esse estado não se grava.
 * 2. **O padrão do Cliente é sugestão copiada, nunca lida ao vivo.** O que sai
 *    daqui é o valor que a versão nova GRAVA; nenhuma leitura de versão cai
 *    para o cadastro do cliente.
 */

/**
 * "Parcelado sem parcelas" pedido por quem grava. `campo` é o caminho que a
 * resposta de validação aponta — `installmentCount` no Orçamento,
 * `defaultInstallmentCount` no Cliente —, para a tela pôr a frase ao lado do
 * campo certo.
 */
export class InstallmentsWithoutCountError extends Error {
  readonly campo: string;

  constructor(campo: string) {
    super(PARCELADO_SEM_PARCELAS_MESSAGE);
    this.name = "InstallmentsWithoutCountError";
    this.campo = campo;
  }
}

/** Recusa o estado "Parcelado sem parcelas" que a gravação produziria. */
export function exigirParcelas(
  method: QuotePaymentMethod | null | undefined,
  installmentCount: number | null | undefined,
  campo: string,
): void {
  if (parceladoSemParcelas(method, installmentCount)) throw new InstallmentsWithoutCountError(campo);
}

/** A resposta de validação da recusa — o mesmo formato das recusas do Zod. */
export function respostaDaRecusaDeParcelas(error: InstallmentsWithoutCountError) {
  return {
    error: "validation_error",
    message: error.message,
    issues: [{ path: error.campo, message: error.message }],
  };
}

/** As seis colunas do pagamento padrão, para `select` de quem precisa delas. */
export const padraoDePagamentoSelect = {
  defaultPaymentInstrument: true,
  defaultPaymentMethod: true,
  defaultDownPaymentPercent: true,
  defaultInstallmentCount: true,
  defaultInstallmentIntervalDays: true,
  defaultMonthlyInterestPercent: true,
} as const;

export type PadraoDePagamentoGravado = Pick<Customer, keyof typeof padraoDePagamentoSelect>;

export function padraoDePagamentoDTO(customer: PadraoDePagamentoGravado): CustomerPaymentDefaultsDTO {
  return {
    defaultPaymentInstrument: customer.defaultPaymentInstrument,
    defaultPaymentMethod: customer.defaultPaymentMethod,
    defaultDownPaymentPercent: customer.defaultDownPaymentPercent
      ? customer.defaultDownPaymentPercent.toFixed(4)
      : null,
    defaultInstallmentCount: customer.defaultInstallmentCount,
    defaultInstallmentIntervalDays: customer.defaultInstallmentIntervalDays,
    defaultMonthlyInterestPercent: customer.defaultMonthlyInterestPercent
      ? customer.defaultMonthlyInterestPercent.toFixed(4)
      : null,
  };
}

/** O bloco da condição padrão que o corpo pediu — chave ausente não mexe. */
export interface CondicaoPadraoInformada {
  defaultPaymentMethod?: QuotePaymentMethod | null | undefined;
  defaultDownPaymentPercent?: string | null | undefined;
  defaultInstallmentCount?: number | null | undefined;
  defaultInstallmentIntervalDays?: number | null | undefined;
  defaultMonthlyInterestPercent?: string | null | undefined;
}

const CAMPOS_DA_CONDICAO_PADRAO = [
  "defaultPaymentMethod",
  "defaultDownPaymentPercent",
  "defaultInstallmentCount",
  "defaultInstallmentIntervalDays",
  "defaultMonthlyInterestPercent",
] as const satisfies readonly (keyof CondicaoPadraoInformada)[];

/** O corpo mexe na condição padrão? Sem isso, não há o que resolver nem travar. */
export function tocaCondicaoPadrao(informada: CondicaoPadraoInformada): boolean {
  return CAMPOS_DA_CONDICAO_PADRAO.some((campo) => informada[campo] !== undefined);
}

/**
 * A condição padrão como vai ficar gravada: o gravado com o que o corpo pediu
 * por cima, inteira.
 *
 * Condição não informada ou à vista não guarda parcelamento — número escondido
 * no registro ressuscitaria sozinho quando alguém voltasse para parcelado, a
 * mesma regra do PATCH do Orçamento. Parcelado sem parcelas é recusado.
 */
export function condicaoPadraoParaGravar(
  gravado: PadraoDePagamentoGravado | null,
  informada: CondicaoPadraoInformada,
) {
  const method =
    informada.defaultPaymentMethod !== undefined
      ? informada.defaultPaymentMethod
      : (gravado?.defaultPaymentMethod ?? null);

  if (method !== "INSTALLMENTS") {
    return {
      defaultPaymentMethod: method,
      defaultDownPaymentPercent: null,
      defaultInstallmentCount: null,
      defaultInstallmentIntervalDays: null,
      defaultMonthlyInterestPercent: null,
    };
  }

  const decimal = (valor: string | null | undefined, atual: Prisma.Decimal | null | undefined) =>
    valor === undefined ? (atual ?? null) : valor === null ? null : new Prisma.Decimal(valor);
  const inteiro = (valor: number | null | undefined, atual: number | null | undefined) =>
    valor === undefined ? (atual ?? null) : valor;

  const bloco = {
    defaultPaymentMethod: method,
    defaultDownPaymentPercent: decimal(
      informada.defaultDownPaymentPercent,
      gravado?.defaultDownPaymentPercent,
    ),
    defaultInstallmentCount: inteiro(informada.defaultInstallmentCount, gravado?.defaultInstallmentCount),
    defaultInstallmentIntervalDays: inteiro(
      informada.defaultInstallmentIntervalDays,
      gravado?.defaultInstallmentIntervalDays,
    ),
    defaultMonthlyInterestPercent: decimal(
      informada.defaultMonthlyInterestPercent,
      gravado?.defaultMonthlyInterestPercent,
    ),
  };
  exigirParcelas(bloco.defaultPaymentMethod, bloco.defaultInstallmentCount, "defaultInstallmentCount");
  return bloco;
}

/**
 * O pagamento que a PRIMEIRA proposta real recebe do padrão do cliente — V1 do
 * projeto, ou a primeira depois de só haver legado.
 *
 * Forma e condição vêm cada uma inteira, de uma fonte só: a forma é sempre a do
 * cliente (legado não tem forma); a condição é a do cliente quando ele tem
 * uma, e sem ela nada é escrito — a versão nasce como nascia (à vista, ou a
 * cópia da anterior legada). Nunca mistura campo do cliente com campo de outra
 * origem.
 */
export function pagamentoInicialDoCliente(customer: PadraoDePagamentoGravado) {
  return {
    paymentInstrument: customer.defaultPaymentInstrument,
    ...(customer.defaultPaymentMethod !== null
      ? {
          paymentMethod: customer.defaultPaymentMethod,
          downPaymentPercent: customer.defaultDownPaymentPercent,
          installmentCount: customer.defaultInstallmentCount,
          installmentIntervalDays: customer.defaultInstallmentIntervalDays,
          monthlyInterestPercent: customer.defaultMonthlyInterestPercent,
        }
      : {}),
  };
}
