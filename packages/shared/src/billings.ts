import { Decimal, type DecimalInstance } from "./decimal-config.js";

/**
 * Contratos de Faturamento (Billing) — documento COMERCIAL/OPERACIONAL,
 * nunca fiscal (NF-e/DANFE/SEFAZ/impostos estão fora do MVP). A quantidade
 * faturável vem SEMPRE do que foi realmente expedido (`ShipmentLine` de uma
 * Expedição CONFIRMED), nunca do pedido/reservado/planejado/produzido.
 */

export const BILLING_CODE_PREFIX = "FAT";

/** `ISSUED` é histórico imutável — correção pós-emissão é evolução futura. */
export type BillingStatus = "DRAFT" | "ISSUED" | "CANCELLED";

/**
 * Aviso obrigatório em qualquer apresentação impressa do Faturamento.
 * O documento é comercial/operacional: não emite Nota Fiscal, não gera
 * DANFE/XML e não substitui a obrigação fiscal.
 */
export const BILLING_NON_FISCAL_NOTICE =
  "Documento comercial/operacional — não é Nota Fiscal.";

export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  DRAFT: "Rascunho",
  ISSUED: "Emitido",
  CANCELLED: "Cancelado",
};

export const BILLING_STATUSES: readonly BillingStatus[] = ["DRAFT", "ISSUED", "CANCELLED"];

/** Estado de faturamento de uma Expedição CONFIRMED — sempre derivado. */
export type ShipmentBillingStatus = "PENDING" | "DRAFT" | "ISSUED";

export const SHIPMENT_BILLING_STATUS_LABELS: Record<ShipmentBillingStatus, string> = {
  PENDING: "Pendente",
  DRAFT: "Em preparação",
  ISSUED: "Faturada",
};

/**
 * Estado de faturamento DERIVADO do Pedido — nunca persistido e nunca
 * misturado ao `CustomerOrder.status`, que continua representando só o
 * fluxo operacional/logístico.
 */
export type CustomerOrderBillingStatus = "NOT_READY" | "PENDING" | "PARTIALLY_BILLED" | "BILLED";

export const CUSTOMER_ORDER_BILLING_STATUS_LABELS: Record<CustomerOrderBillingStatus, string> = {
  NOT_READY: "Sem expedição confirmada",
  PENDING: "Aguardando faturamento",
  PARTIALLY_BILLED: "Parcialmente faturado",
  BILLED: "Faturado",
};

export interface BillingLineDTO {
  id: string;
  shipmentLineId: string;
  customerOrderLineId: string;
  productId: string;
  productCode: string;
  productName: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  lotId: string | null;
  lotCode: string | null;
  businessLotNumber: string | null;
  /** Idêntica à `ShipmentLine.quantity` — nunca editável. */
  quantity: string;
  unitCode: string;
  /**
   * O **preço acordado** no Pedido, congelado na criação do Faturamento.
   * `null` só quando o Pedido de origem não tinha preço acordado.
   */
  agreedUnitPrice: string | null;
  /**
   * O **preço efetivamente faturado**. Nasce igual a `agreedUnitPrice` e só
   * difere após um override explícito. BRL quando informado.
   */
  unitPrice: string | null;
  /** `quantity × unitPrice`; `null` quando a linha não tem preço. Nunca persistido. */
  lineTotal: string | null;
  /** `true` quando o faturado difere do acordado por ação explícita. */
  priceOverridden: boolean;
  overrideReason: string | null;
  overriddenBy: string | null;
  overriddenAt: string | null;
  position: number;
}

export interface BillingDTO {
  id: string;
  code: string;
  customerOrderId: string;
  customerOrderCode: string;
  shipmentId: string;
  shipmentCode: string;
  shipmentDate: string | null;
  customerId: string;
  customerCode: string | null;
  customerName: string | null;
  customerTradeName: string | null;
  customerCnpj: string | null;
  status: BillingStatus;
  externalReference: string | null;
  notes: string | null;
  lines: BillingLineDTO[];
  totalQuantity: string;
  /** Soma das linhas do documento; `null` quando falta preço em alguma. */
  grossAmount: string | null;
  /**
   * Percentual acordado no Pedido, congelado na criação. `null` = não havia
   * condição com desconto; `"0.0000"` = desconto explicitamente zero.
   */
  discountPercentSnapshot: string | null;
  /** Desconto do Pedido apropriado NESTE documento — cabeçalho, nunca linha. */
  discountAmount: string | null;
  /**
   * Correção de arredondamento que só o documento de FECHAMENTO carrega.
   * Positiva, zero ou negativa. Não é desconto.
   */
  commercialAdjustmentAmount: string | null;
  /**
   * `grossAmount − discountAmount + commercialAdjustmentAmount` — o valor do
   * documento. Só existe quando TODAS as linhas têm preço.
   */
  totalAmount: string | null;
  /** `false` quando alguma linha está sem preço; a UI mostra "Valores incompletos". */
  hasCompletePricing: boolean;
  issuedAt: string | null;
  issuedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
}

export interface BillingListResponse {
  billings: BillingDTO[];
  page: number;
  pageSize: number;
  total: number;
}

/** Expedição CONFIRMED sem faturamento emitido — base do futuro relatório R-16. */
export interface AwaitingBillingRowDTO {
  shipmentId: string;
  shipmentCode: string;
  shipmentDate: string | null;
  customerOrderId: string;
  customerOrderCode: string;
  /** Identidade do cliente — a fila cita, e a citação abre o cadastro. */
  customerId: string;
  customerName: string | null;
  totalQuantity: string;
  billingStatus: ShipmentBillingStatus;
  /** Preenchidos quando já existe um Billing DRAFT para esta Expedição. */
  billingId: string | null;
  billingCode: string | null;
}

export interface AwaitingBillingListResponse {
  rows: AwaitingBillingRowDTO[];
}

export interface CreateBillingInput {
  shipmentId: string;
}

export interface UpdateBillingLineInput {
  billingLineId: string;
  /** `>= 0`; string vazia/ausente limpa o preço. */
  unitPrice?: string;
}

export interface UpdateBillingInput {
  externalReference?: string;
  notes?: string;
  lines?: UpdateBillingLineInput[];
}

export interface CancelBillingInput {
  reason: string;
}

/** Uma linha, como está no documento ou como está sendo digitada. */
export interface LinhaParaTotalDoFaturamento {
  /** Vem da expedição confirmada — nunca editável, mas pode faltar na prévia. */
  quantity: string | null;
  /** `null` = sem preço; texto ilegível também chega como `null`. */
  unitPrice: string | null;
}

export interface TotaisDoFaturamento {
  /** `quantity × unitPrice` por linha, 2 casas; `null` sem preço ou sem quantidade. */
  lineTotals: (string | null)[];
  /** `false` quando alguma linha está sem preço — total parcial não existe. */
  hasCompletePricing: boolean;
  /** Soma das linhas JÁ arredondadas; `null` quando o preço está incompleto. */
  totalAmount: string | null;
}

/**
 * A conta do Faturamento — uma só, para a API, para o documento e para a prévia.
 *
 * A tela somava `Number(qty) * Number(price)` enquanto a API somava em
 * `Decimal`: dois motores para o mesmo número, e o operador via o rodapé
 * discordar da linha justamente na hora de emitir.
 *
 * O total do documento é a soma das linhas IMPRESSAS — cada linha fecha em
 * dois decimais e o documento é a soma dessas linhas. `Σ round(linha)` e
 * `round(Σ linha)` divergem, e o que o cliente confere são as linhas.
 *
 * O preço unitário guarda 4 casas: `123 × 4,0531` fecha em R$ 498,53, e é esse
 * o número, não `123 × 4,05`. Nada é arredondado antes da multiplicação.
 */
export function calcularTotaisFaturamento(
  lines: LinhaParaTotalDoFaturamento[],
): TotaisDoFaturamento {
  const lineTotals: (string | null)[] = [];
  for (const line of lines) {
    if (line.quantity === null || line.unitPrice === null) {
      lineTotals.push(null);
      continue;
    }
    let total: DecimalInstance;
    try {
      total = new Decimal(line.quantity).times(line.unitPrice);
    } catch {
      lineTotals.push(null);
      continue;
    }
    lineTotals.push(total.isFinite() ? total.toFixed(2) : null);
  }
  const hasCompletePricing = lines.length > 0 && lineTotals.every((total) => total !== null);
  const totalAmount = hasCompletePricing
    ? lineTotals
        .reduce((sum, total) => sum.plus(new Decimal(total!)), new Decimal(0))
        .toFixed(2)
    : null;
  return { lineTotals, hasCompletePricing, totalAmount };
}

/* ------------------------------------------------------------------ *
 * Apropriação comercial — desconto global e fechamento do Pedido
 * ------------------------------------------------------------------ */

/** Condição comercial CONGELADA do Pedido. Nunca a condição viva. */
export interface CondicaoComercialDoPedido {
  /** `CustomerOrder.agreedSubtotalAmount` — bruto acordado, 2 casas. */
  agreedSubtotalAmount: string | null;
  /** `CustomerOrder.agreedTotalAmount` — líquido acordado, 2 casas. */
  agreedTotalAmount: string | null;
}

/** Um Faturamento ATIVO já emitido deste Pedido, como está gravado. */
export interface FaturamentoAtivoAnterior {
  grossAmount: string | null;
  discountAmount: string | null;
  totalAmount: string | null;
}

export interface ApropriacaoComercialInput {
  pedido: CondicaoComercialDoPedido;
  /** Emitidos e NÃO cancelados. Cancelado nunca entra. */
  anteriores: FaturamentoAtivoAnterior[];
  /** Σ das linhas deste documento, já em 2 casas. `null` = preço incompleto. */
  grossAmount: string | null;
  /** Este documento completa as quantidades do Pedido? */
  fechaOPedido: boolean;
  /**
   * Σ `quantidade × (unitPrice − agreedUnitPrice)` de TODAS as linhas ativas
   * (anteriores emitidas + este documento), 2 casas.
   *
   * Override de preço é EXCEÇÃO COMERCIAL DELIBERADA, e a diferença entre o
   * acordado e o faturado é a evidência dela (`PRODUCT_RULES.md` §34). Puxar
   * o total de volta ao acordado apagaria justamente essa evidência: o alvo
   * do fechamento anda com o override, e o ajuste continua absorvendo só
   * arredondamento. Sem override isto é `"0.00"` e o alvo é o acordado.
   */
  overrideDelta: string;
}

export interface ApropriacaoComercial {
  /** Desconto apropriado NESTE documento. Nunca rateado nas linhas. */
  discountAmount: string | null;
  /** Correção de arredondamento; só o documento de fechamento a carrega. */
  commercialAdjustmentAmount: string | null;
  /** `grossAmount − discountAmount + commercialAdjustmentAmount`. */
  totalAmount: string | null;
}

function dinheiroComercial(valor: DecimalInstance): DecimalInstance {
  return valor.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Decimal a partir de string opcional; ausente ou ilegível vira `null`. */
function valorOuNulo(valor: string | null | undefined): DecimalInstance | null {
  if (valor === null || valor === undefined || valor === "") return null;
  try {
    const numero = new Decimal(valor);
    return numero.isFinite() ? numero : null;
  } catch {
    return null;
  }
}

function somar(valores: (string | null)[]): DecimalInstance {
  return valores.reduce((soma, valor) => {
    const parcela = valorOuNulo(valor);
    return parcela ? soma.plus(parcela) : soma;
  }, new Decimal(0));
}

/**
 * COMO O DESCONTO GLOBAL DO PEDIDO CHEGA AO FATURAMENTO.
 *
 * O desconto é do CABEÇALHO, nunca das linhas: `agreedUnitPrice` continua
 * sendo o preço que o cliente aceitou, e nenhuma linha ganha um preço
 * líquido que ninguém negociou (`PRODUCT_RULES.md` §34).
 *
 * DOCUMENTO INTERMEDIÁRIO — apropriação CUMULATIVA, não proporcional
 * isolada. Aplicar `round(bruto × percentual)` em cada documento acumula
 * resíduo: cem faturamentos de R$ 0,01 com 50% dariam R$ 1,00 de desconto
 * sobre R$ 1,00, quando o acordado eram R$ 0,50. Aqui cada documento
 * pergunta quanto desconto o Pedido JÁ deveria ter apropriado até este
 * bruto acumulado, e aplica só a diferença. O erro nunca soma.
 *
 * DOCUMENTO DE FECHAMENTO — aquele que completa as quantidades do Pedido
 * (não "o último no tempo"): apropria todo o desconto que sobrou e recebe o
 * `commercialAdjustmentAmount`, a diferença entre o que os documentos já
 * somam e a condição acordada.
 *
 * O ajuste NÃO é desconto e não se esconde dentro dele. Ele existe porque
 * cada linha fecha em dois decimais: partir uma linha de `3 × 33,3333` em
 * três documentos dá `33,33 × 3 = 99,99` contra os `100,00` do Pedido — e
 * isso acontece mesmo com desconto ZERO. Uma reconciliação só, para as duas
 * fontes.
 *
 * Função PURA: não lê banco, não conhece Prisma, não decide se o documento
 * fecha — quem chama informa.
 */
export function calcularApropriacaoComercialDoFaturamento(
  input: ApropriacaoComercialInput,
): ApropriacaoComercial {
  const bruto = valorOuNulo(input.grossAmount);
  // Sem bruto não há documento com valor: precificação incompleta.
  if (bruto === null) {
    return { discountAmount: null, commercialAdjustmentAmount: null, totalAmount: null };
  }

  const subtotalAcordado = valorOuNulo(input.pedido.agreedSubtotalAmount);
  const totalAcordado = valorOuNulo(input.pedido.agreedTotalAmount);

  /*
   * Pedido digitado direto não tem condição comercial congelada: não existe
   * desconto para apropriar nem alvo para reconciliar, e o documento vale o
   * que suas linhas somam — exatamente como antes desta capacidade.
   */
  if (subtotalAcordado === null || totalAcordado === null) {
    return {
      discountAmount: "0.00",
      commercialAdjustmentAmount: "0.00",
      totalAmount: dinheiroComercial(bruto).toFixed(2),
    };
  }

  /*
   * O desconto acordado sai da SUBTRAÇÃO dos dois valores já congelados e
   * fechados, nunca de recalcular `subtotal × percentual`: foram esses dois
   * números que o cliente viu na proposta.
   */
  const descontoAcordado = Decimal.max(dinheiroComercial(subtotalAcordado.minus(totalAcordado)), 0);
  const descontoJaApropriado = somar(input.anteriores.map((b) => b.discountAmount));
  const descontoRestante = Decimal.max(descontoAcordado.minus(descontoJaApropriado), 0);

  let desconto: DecimalInstance;
  if (input.fechaOPedido) {
    desconto = descontoRestante;
  } else if (descontoAcordado.isZero() || subtotalAcordado.isZero()) {
    desconto = new Decimal(0);
  } else {
    const brutoAcumulado = somar(input.anteriores.map((b) => b.grossAmount)).plus(bruto);
    const alvoAcumulado = dinheiroComercial(
      descontoAcordado.times(brutoAcumulado).dividedBy(subtotalAcordado),
    );
    // Nunca apropriar mais do que o acordado, nem devolver desconto já dado.
    desconto = Decimal.min(
      Decimal.max(alvoAcumulado.minus(descontoJaApropriado), 0),
      descontoRestante,
    );
  }

  const preliminar = dinheiroComercial(bruto.minus(desconto));

  if (!input.fechaOPedido) {
    return {
      discountAmount: desconto.toFixed(2),
      commercialAdjustmentAmount: "0.00",
      totalAmount: preliminar.toFixed(2),
    };
  }

  const totalJaFaturado = somar(input.anteriores.map((b) => b.totalAmount));
  const override = valorOuNulo(input.overrideDelta) ?? new Decimal(0);
  const alvoRestante = dinheiroComercial(totalAcordado.plus(override).minus(totalJaFaturado));
  const ajuste = dinheiroComercial(alvoRestante.minus(preliminar));

  return {
    discountAmount: desconto.toFixed(2),
    commercialAdjustmentAmount: ajuste.toFixed(2),
    totalAmount: dinheiroComercial(preliminar.plus(ajuste)).toFixed(2),
  };
}

/**
 * O SINAL de um valor comercial, sem passar por `Number`.
 *
 * O ajuste de fechamento é o único valor do documento que pode ser negativo,
 * e a tela precisa dele como "− R$ 0,03", não "R$ -0,03". Converter para
 * `Number` só para descobrir o sinal reintroduziria ponto flutuante num
 * caminho que o `documents.test.tsx` proíbe no impresso — e por bom motivo.
 */
export function sinalDoValorComercial(valor: string | null | undefined): {
  zero: boolean;
  negativo: boolean;
  /** O mesmo valor sem o sinal. `"0.00"` quando ilegível. */
  absoluto: string;
} {
  const numero = valorOuNulo(valor ?? null);
  if (numero === null) return { zero: true, negativo: false, absoluto: "0.00" };
  return {
    zero: numero.isZero(),
    negativo: numero.isNegative(),
    absoluto: numero.abs().toFixed(2),
  };
}

/**
 * `bruto − desconto + ajuste`, em duas casas.
 *
 * A tela precisa da conta para mostrar a PRÉVIA do rascunho enquanto o
 * preço está sendo digitado: o bruto muda a cada tecla, e o desconto vem do
 * servidor, que é quem conhece os outros faturamentos do Pedido. Uma
 * subtração só, aqui, em vez de `Number` na página.
 */
export function totalDoFaturamento(
  grossAmount: string | null,
  discountAmount: string | null,
  commercialAdjustmentAmount: string | null,
): string | null {
  const bruto = valorOuNulo(grossAmount);
  if (bruto === null) return null;
  const desconto = valorOuNulo(discountAmount) ?? new Decimal(0);
  const ajuste = valorOuNulo(commercialAdjustmentAmount) ?? new Decimal(0);
  return dinheiroComercial(bruto.minus(desconto).plus(ajuste)).toFixed(2);
}
