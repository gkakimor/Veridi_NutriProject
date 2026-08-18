/** Contratos do módulo de Pedido do Cliente + Plano de Atendimento, consumidos por `apps/api` e `apps/web`. */

import type { CustomerOrderBillingStatus } from "./billings.js";
import type { CustomerAddress } from "./customers.js";
import type { ProductionOrderStatus } from "./production-orders.js";

export const CUSTOMER_ORDER_CODE_PREFIX = "PED";

/**
 * DRAFT editável; CONFIRMED congela cliente/produtos/quantidades (snapshot)
 * e habilita o Plano de Atendimento; IN_FULFILLMENT ocorre quando o Plano é
 * aplicado (reserva de Produto Acabado + OPs DRAFT geradas para o déficit);
 * PARTIALLY_SHIPPED/SHIPPED são derivados de Expedições CONFIRMED reais —
 * nunca definidos manualmente. `READY` não existe nesta fase.
 */
export type CustomerOrderStatus =
  | "DRAFT"
  | "CONFIRMED"
  | "IN_FULFILLMENT"
  | "PARTIALLY_SHIPPED"
  | "SHIPPED"
  | "CANCELLED";

export const CUSTOMER_ORDER_STATUS_LABELS: Record<CustomerOrderStatus, string> = {
  DRAFT: "Rascunho",
  CONFIRMED: "Confirmado",
  IN_FULFILLMENT: "Em atendimento",
  PARTIALLY_SHIPPED: "Parcialmente expedido",
  SHIPPED: "Expedido",
  CANCELLED: "Cancelado",
};

export const CUSTOMER_ORDER_STATUSES: readonly CustomerOrderStatus[] = [
  "DRAFT",
  "CONFIRMED",
  "IN_FULFILLMENT",
  "PARTIALLY_SHIPPED",
  "SHIPPED",
  "CANCELLED",
];

export type CustomerOrderReservationStatus = "ACTIVE" | "RELEASED";

export interface CustomerOrderLineDTO {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  finishedItemId: string | null;
  finishedItemCode: string | null;
  finishedItemName: string | null;
  orderedQuantity: string;
  unitCode: string;
  position: number;
  /** Soma das ShipmentLines de Expedições CONFIRMED — sempre derivada, nunca coluna própria. */
  shippedQuantity: string;
  /** `orderedQuantity - shippedQuantity`, nunca negativo. */
  outstandingQuantity: string;
  /** Soma das BillingLines de Faturamentos ISSUED — DRAFT/CANCELLED nunca contam. */
  billedQuantity: string;
  /** `shippedQuantity - billedQuantity`, nunca negativo — expedido ainda não faturado. */
  unbilledShippedQuantity: string;
}

export interface CustomerOrderReservationLineDTO {
  id: string;
  customerOrderLineId: string;
  productId: string;
  productCode: string;
  productName: string;
  itemId: string;
  /** Null quando o Finished Product Item não controla lote. */
  lotId: string | null;
  lotCode: string | null;
  businessLotNumber: string | null;
  expiryDate: string | null;
  location: string | null;
  lotStatus: string | null;
  quantity: string;
  unitCode: string;
  /** Soma já expedida desta linha (Expedições CONFIRMED). */
  shippedQuantity: string;
  /** `quantity - shippedQuantity`, nunca negativo — o que ainda pode ser expedido/realocado. */
  reservedRemaining: string;
  /** Preenchidos quando o remanescente foi realocado para outro lote — nunca apagada. */
  releasedAt: string | null;
  releasedBy: string | null;
  releaseReason: string | null;
  /** `id` da linha original que esta linha substitui, quando nasceu de uma realocação. */
  replacesLineId: string | null;
}

/**
 * Reserva de PRODUTO ACABADO por Pedido — contexto próprio, nunca reaproveita
 * `MaterialReservation` (matéria-prima/embalagem de OP). Nunca cria
 * `InventoryMovement`; histórica (nunca deletada, mesmo `RELEASED`).
 */
export interface CustomerOrderReservationDTO {
  id: string;
  status: CustomerOrderReservationStatus;
  createdAt: string;
  createdBy: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
  releaseReason: string | null;
  lines: CustomerOrderReservationLineDTO[];
}

export interface CustomerOrderShipmentSummaryDTO {
  id: string;
  code: string;
  status: string;
  shipmentDate: string | null;
  /** Soma das quantidades das linhas desta Expedição. */
  totalQuantity: string;
  lineCount: number;
}

export interface CustomerOrderBillingSummaryDTO {
  id: string;
  code: string;
  shipmentId: string;
  shipmentCode: string;
  status: string;
  totalQuantity: string;
  /** `null` quando alguma linha está sem preço. */
  totalAmount: string | null;
  issuedAt: string | null;
}

export interface CustomerOrderLinkedPurchaseOrderDTO {
  id: string;
  code: string;
  supplierId: string;
  supplierName: string;
  lineCount: number;
  status: string;
  orderTotal: string | null;
}

export interface CustomerOrderGeneratedProductionOrderDTO {
  id: string;
  code: string;
  productId: string;
  productCode: string;
  productName: string;
  customerOrderLineId: string;
  plannedQuantity: string;
  /** Soma dos apontamentos reais da OP — `0` enquanto nada foi produzido. */
  producedQuantity: string;
  outputUnitCode: string;
  status: ProductionOrderStatus;
}

export interface CustomerOrderDTO {
  id: string;
  code: string;
  customerId: string;
  customerCode: string | null;
  customerName: string | null;
  customerTradeName: string | null;
  customerCnpj: string | null;
  /** Endereço congelado no CONFIRM; `null` em pedidos anteriores à cap. 33. */
  customerAddress: CustomerAddress;
  orderDate: string;
  requestedDeliveryDate: string | null;
  status: CustomerOrderStatus;
  notes: string | null;
  lines: CustomerOrderLineDTO[];
  /** Null até o Plano de Atendimento ser aplicado. */
  reservation: CustomerOrderReservationDTO | null;
  /** OPs DRAFT geradas ao aplicar o Plano — uma por linha com déficit. */
  generatedProductionOrders: CustomerOrderGeneratedProductionOrderDTO[];
  /** OCs (qualquer status) vinculadas a este Pedido pela Sugestão de Compra. */
  linkedPurchaseOrders: CustomerOrderLinkedPurchaseOrderDTO[];
  /** Expedições deste Pedido (qualquer status) — só CONFIRMED conta como expedido. */
  shipments: CustomerOrderShipmentSummaryDTO[];
  /** Faturamentos deste Pedido (qualquer status) — só ISSUED conta como faturado. */
  billings: CustomerOrderBillingSummaryDTO[];
  /** Estado de faturamento DERIVADO — nunca persistido, nunca misturado ao `status`. */
  billingStatus: CustomerOrderBillingStatus;
  confirmedAt: string | null;
  confirmedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
}

export interface CustomerOrderListResponse {
  customerOrders: CustomerOrderDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CustomerOrderLineInput {
  productId: string;
  orderedQuantity: string;
}

export interface CreateCustomerOrderInput {
  customerId: string;
  requestedDeliveryDate?: string;
  notes?: string;
  lines?: CustomerOrderLineInput[];
}

export interface UpdateCustomerOrderInput {
  customerId?: string;
  requestedDeliveryDate?: string;
  notes?: string;
  lines?: CustomerOrderLineInput[];
}

export interface CancelCustomerOrderInput {
  reason: string;
}
