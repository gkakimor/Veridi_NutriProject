/** Contratos do módulo de Pedido do Cliente + Plano de Atendimento, consumidos por `apps/api` e `apps/web`. */

export const CUSTOMER_ORDER_CODE_PREFIX = "PED";

/**
 * DRAFT editável; CONFIRMED congela cliente/produtos/quantidades (snapshot)
 * e habilita o Plano de Atendimento; IN_FULFILLMENT ocorre quando o Plano é
 * aplicado (reserva de Produto Acabado + OPs DRAFT geradas para o déficit).
 * READY/PARTIALLY_SHIPPED/SHIPPED ficam para expedição futura — ainda não
 * alcançáveis.
 */
export type CustomerOrderStatus = "DRAFT" | "CONFIRMED" | "IN_FULFILLMENT" | "CANCELLED";

export const CUSTOMER_ORDER_STATUS_LABELS: Record<CustomerOrderStatus, string> = {
  DRAFT: "Rascunho",
  CONFIRMED: "Confirmado",
  IN_FULFILLMENT: "Em atendimento",
  CANCELLED: "Cancelado",
};

export const CUSTOMER_ORDER_STATUSES: readonly CustomerOrderStatus[] = [
  "DRAFT",
  "CONFIRMED",
  "IN_FULFILLMENT",
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
  quantity: string;
  unitCode: string;
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

export interface CustomerOrderGeneratedProductionOrderDTO {
  id: string;
  code: string;
  productId: string;
  productCode: string;
  productName: string;
  customerOrderLineId: string;
  plannedQuantity: string;
  outputUnitCode: string;
  status: string;
}

export interface CustomerOrderDTO {
  id: string;
  code: string;
  customerId: string;
  customerCode: string | null;
  customerName: string | null;
  customerTradeName: string | null;
  customerCnpj: string | null;
  orderDate: string;
  requestedDeliveryDate: string | null;
  status: CustomerOrderStatus;
  notes: string | null;
  lines: CustomerOrderLineDTO[];
  /** Null até o Plano de Atendimento ser aplicado. */
  reservation: CustomerOrderReservationDTO | null;
  /** OPs DRAFT geradas ao aplicar o Plano — uma por linha com déficit. */
  generatedProductionOrders: CustomerOrderGeneratedProductionOrderDTO[];
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
