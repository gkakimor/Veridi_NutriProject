/** Contratos do módulo de Ordens de Compra, consumidos por `apps/api` e `apps/web`. */

import { Decimal, type DecimalInstance } from "./decimal-config.js";

export const PURCHASE_ORDER_CODE_PREFIX = "OC";

export interface LinhaParaTotalDaOrdem {
  /** Como está no documento ou como foi digitada, já legível; `null` quando não há. */
  orderedQuantity: string | null;
  unitPrice: string | null;
}

export interface TotaisDaOrdemDeCompra {
  /** `round(orderedQuantity × unitPrice, 2)`; `null` sem preço ou sem quantidade. */
  lineTotals: (string | null)[];
  /** Soma dos `lineTotals` já fechados; `null` se nenhuma linha tiver preço. */
  orderTotal: string | null;
}

/** Escala do dinheiro no documento — duas casas, o que se confere no papel. */
const ESCALA_MONETARIA = 2;

/**
 * A conta do total previsto da OC — uma só, para a API e para a tela.
 *
 * **O rodapé fecha com as linhas que estão na página.** `PRODUCT_RULES.md`
 * §61, BACKLOG #18:
 *
 *     lineTotal  = round(quantidade × preço unitário, 2)
 *     orderTotal = Σ lineTotal
 *
 * e nunca `round(Σ valores brutos, 2)`. Com preço de oito casas as duas contas
 * divergem em centavos: `10 × 4,05318764` mais `1 × 0,125` mais `5 × 0,025`
 * imprime `40,53 + 0,13 + 0,13`, que quem confere soma como `40,79` — e a
 * conta antiga fechava `40,78`. Um rodapé que não bate com a soma da página
 * destrói a confiança no documento inteiro, e a pessoa que confere está certa.
 *
 * O operando NÃO é arredondado: a multiplicação usa o preço íntegro de
 * `DECIMAL(20,8)` e a quantidade de `DECIMAL(24,12)`. O único fechamento é o
 * da LINHA, que é o número impresso. Precisão do operando não é precisão do
 * total — `PRODUCT_RULES.md` §57.
 *
 * A prévia da tela e o documento da API passam por aqui, pela mesma função:
 * a tela já somou `Number(qty) * Number(price)` por conta própria, e o rodapé
 * de uma OC gravada mostrava o total do último salvamento ao lado de linhas
 * recalculadas ao vivo. Uma regra só, num lugar só.
 */
export function calcularTotaisOrdemCompra(lines: LinhaParaTotalDaOrdem[]): TotaisDaOrdemDeCompra {
  let orderTotal: DecimalInstance | null = null;
  const lineTotals: (string | null)[] = [];
  for (const line of lines) {
    if (line.orderedQuantity === null || line.unitPrice === null) {
      lineTotals.push(null);
      continue;
    }
    let bruto: DecimalInstance;
    try {
      bruto = new Decimal(line.orderedQuantity).times(line.unitPrice);
    } catch {
      lineTotals.push(null);
      continue;
    }
    if (!bruto.isFinite()) {
      lineTotals.push(null);
      continue;
    }
    /*
     * `ROUND_HALF_UP` DECLARADO, não herdado do default do `decimal.js` —
     * mesma disciplina de §60: o critério que decide o centavo de um documento
     * não pode depender de uma configuração global que outra capability pode
     * trocar de carona. Meio centavo sobe: `0,125` vira `0,13`.
     */
    const fechado = bruto.toDecimalPlaces(ESCALA_MONETARIA, Decimal.ROUND_HALF_UP);
    orderTotal = orderTotal === null ? fechado : orderTotal.plus(fechado);
    lineTotals.push(fechado.toFixed(ESCALA_MONETARIA));
  }
  // A soma de valores que já têm duas casas já tem duas casas; o `toFixed`
  // final é normalização de formato, não um segundo arredondamento.
  return {
    lineTotals,
    orderTotal: orderTotal === null ? null : orderTotal.toFixed(ESCALA_MONETARIA),
  };
}

export type PurchaseOrderStatus =
  | "DRAFT"
  | "ORDERED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CANCELLED";

export const PURCHASE_ORDER_STATUSES: readonly PurchaseOrderStatus[] = [
  "DRAFT",
  "ORDERED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
];

export const PURCHASE_ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Rascunho",
  ORDERED: "Confirmado",
  PARTIALLY_RECEIVED: "Recebido parcialmente",
  RECEIVED: "Recebido",
  CANCELLED: "Cancelado",
};

/** Status que contribuem para "Em Compra" (quantidade aberta pendente de recebimento). */
export const OPEN_PURCHASE_ORDER_STATUSES: readonly PurchaseOrderStatus[] = [
  "ORDERED",
  "PARTIALLY_RECEIVED",
];

/** `CUSTOMER_ORDER` só é atribuída internamente pela Sugestão de Compra — nunca aceito do client no endpoint público. */
export type PurchaseOrderOrigin = "MANUAL" | "CUSTOMER_ORDER";

export const PURCHASE_ORDER_ORIGIN_LABELS: Record<PurchaseOrderOrigin, string> = {
  MANUAL: "Manual",
  CUSTOMER_ORDER: "Pedido do Cliente",
};

export interface PurchaseOrderLineDTO {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  /** Decimal como string — nunca usar float JS como fonte de precisão. */
  orderedQuantity: string;
  unitPrice: string | null;
  /** `orderedQuantity × unitPrice`, `null` se a linha não tiver preço. */
  lineTotal: string | null;
  /** Derivado da soma dos ReceiptLines confirmados — nunca uma coluna mutável própria. */
  receivedQuantity: string;
  /** `orderedQuantity - receivedQuantity`. */
  openQuantity: string;
}

export interface PurchaseOrderDTO {
  id: string;
  code: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  supplierCnpj: string | null;
  orderDate: string;
  expectedDeliveryDate: string | null;
  status: PurchaseOrderStatus;
  notes: string | null;
  lines: PurchaseOrderLineDTO[];
  /** Soma dos `lineTotal` conhecidos; `null` se nenhuma linha tiver preço. */
  orderTotal: string | null;
  origin: PurchaseOrderOrigin;
  /** Preenchidos só quando `origin = "CUSTOMER_ORDER"`. */
  customerOrderId: string | null;
  customerOrderCode: string | null;
  orderedAt: string | null;
  orderedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Recebimentos desta OC, do mais antigo ao mais recente. A OC pede, o
   * recebimento é o que de fato chegou: sem esta lista, conferir uma entrega
   * obrigava a sair para a lista geral de recebimentos e procurar pelo código
   * da ordem.
   */
  receipts: PurchaseOrderReceiptSummaryDTO[];
}

export interface PurchaseOrderReceiptSummaryDTO {
  id: string;
  code: string;
  receivedAt: string;
  invoiceNumber: string | null;
  lineCount: number;
  /** Soma do que entrou neste recebimento, na unidade de cada linha. */
  receivedQuantity: string;
  /** Quantos lotes internos este recebimento gerou. */
  lotCount: number;
}

export interface PurchaseOrderListResponse {
  purchaseOrders: PurchaseOrderDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PurchaseOrderLineInput {
  itemId: string;
  /** Decimal como string (ou number, convertido no cliente) — evita perda de precisão. */
  orderedQuantity: string;
  unitPrice?: string;
}

export interface CreatePurchaseOrderInput {
  supplierId: string;
  orderDate: string;
  expectedDeliveryDate?: string;
  notes?: string;
  lines?: PurchaseOrderLineInput[];
}

export interface UpdatePurchaseOrderInput {
  supplierId?: string;
  orderDate?: string;
  expectedDeliveryDate?: string;
  notes?: string;
  lines?: PurchaseOrderLineInput[];
}

export interface CancelPurchaseOrderInput {
  reason: string;
}
