/** Contratos do módulo de Ordens de Compra, consumidos por `apps/api` e `apps/web`. */

import Decimal from "decimal.js";

export const PURCHASE_ORDER_CODE_PREFIX = "OC";

export interface LinhaParaTotalDaOrdem {
  /** Como está no documento ou como foi digitada, já legível; `null` quando não há. */
  orderedQuantity: string | null;
  unitPrice: string | null;
}

export interface TotaisDaOrdemDeCompra {
  /** `orderedQuantity × unitPrice` por linha, 2 casas; `null` sem preço ou sem quantidade. */
  lineTotals: (string | null)[];
  /** Soma das linhas com preço, 2 casas só na saída; `null` se nenhuma tiver preço. */
  orderTotal: string | null;
}

/**
 * A conta do total previsto da OC — uma só, para a API e para a tela.
 *
 * A tela somava `Number(qty) * Number(price)` enquanto a API somava em
 * `Decimal`, e o rodapé de uma OC gravada mostrava o `orderTotal` do último
 * salvamento ao lado de linhas recalculadas ao vivo: número vivo ao lado de
 * número velho. Agora a prévia e o documento passam pela mesma função. Nada é
 * arredondado antes da soma; as 2 casas entram só na saída, como o total em
 * dinheiro sempre foi.
 */
export function calcularTotaisOrdemCompra(lines: LinhaParaTotalDaOrdem[]): TotaisDaOrdemDeCompra {
  let orderTotal: Decimal | null = null;
  const lineTotals: (string | null)[] = [];
  for (const line of lines) {
    if (line.orderedQuantity === null || line.unitPrice === null) {
      lineTotals.push(null);
      continue;
    }
    let total: Decimal;
    try {
      total = new Decimal(line.orderedQuantity).times(line.unitPrice);
    } catch {
      lineTotals.push(null);
      continue;
    }
    if (!total.isFinite()) {
      lineTotals.push(null);
      continue;
    }
    orderTotal = orderTotal === null ? total : orderTotal.plus(total);
    lineTotals.push(total.toFixed(2));
  }
  return { lineTotals, orderTotal: orderTotal === null ? null : orderTotal.toFixed(2) };
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
