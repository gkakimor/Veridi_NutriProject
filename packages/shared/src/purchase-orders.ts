/** Contratos do módulo de Ordens de Compra, consumidos por `apps/api` e `apps/web`. */

export const PURCHASE_ORDER_CODE_PREFIX = "OC";

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
  orderedAt: string | null;
  orderedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
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
