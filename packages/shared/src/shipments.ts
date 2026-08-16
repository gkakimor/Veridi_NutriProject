/**
 * Contratos de Expedição (Shipment) — separação e saída física de produto
 * acabado de um Pedido. Só uma Expedição CONFIRMED altera estoque; DRAFT é
 * apenas separação. O futuro Faturamento se baseia no realmente expedido
 * (`ShipmentLine.quantity` de Expedições CONFIRMED), nunca na quantidade
 * pedida/reservada/planejada.
 */

export const SHIPMENT_CODE_PREFIX = "EXP";

/** `CONFIRMED` é histórico imutável — reversão exigiria devolução/reentrada explícita, fora desta fase. */
export type ShipmentStatus = "DRAFT" | "CONFIRMED" | "CANCELLED";

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  DRAFT: "Rascunho",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
};

export const SHIPMENT_STATUSES: readonly ShipmentStatus[] = ["DRAFT", "CONFIRMED", "CANCELLED"];

export interface ShipmentLineDTO {
  id: string;
  customerOrderLineId: string;
  customerOrderReservationLineId: string;
  productId: string;
  productCode: string;
  productName: string;
  itemId: string;
  finishedItemCode: string | null;
  finishedItemName: string | null;
  lotId: string | null;
  lotCode: string | null;
  businessLotNumber: string | null;
  expiryDate: string | null;
  location: string | null;
  quantity: string;
  unitCode: string;
  position: number;
  /** `reservedRemaining` da linha de reserva de origem — o teto do que esta linha pode enviar. */
  reservedRemaining: string;
}

export interface ShipmentDTO {
  id: string;
  code: string;
  customerOrderId: string;
  customerOrderCode: string;
  customerId: string;
  customerName: string | null;
  status: ShipmentStatus;
  shipmentDate: string | null;
  notes: string | null;
  lines: ShipmentLineDTO[];
  /** Soma das quantidades das linhas. */
  totalQuantity: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
}

export interface ShipmentListResponse {
  shipments: ShipmentDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ShipmentLineInput {
  customerOrderReservationLineId: string;
  /** `0 <= quantity <= reservedRemaining`; `0` não gera linha. */
  quantity: string;
}

export interface UpdateShipmentInput {
  notes?: string;
  lines?: ShipmentLineInput[];
}

export interface CancelShipmentInput {
  reason: string;
}

/**
 * Status de reserva por linha do Pedido — base da Reserva Complementar
 * (produto produzido depois do Plano precisa ser explicitamente reservado
 * antes de poder ser expedido). Análise pura, nunca persistida.
 */
export interface ReservationStatusLineDTO {
  customerOrderLineId: string;
  productId: string;
  productCode: string;
  productName: string;
  itemId: string;
  unitCode: string;
  orderedQuantity: string;
  shippedQuantity: string;
  /** Soma dos `reservedRemaining` das linhas de reserva ativas desta linha do Pedido. */
  reservedRemaining: string;
  /** `ordered - shipped - reservedRemaining`, nunca negativo. */
  stillToReserve: string;
  /** Available atual do Finished Product Item (ledger) — respeita Quality/validade. */
  currentAvailable: string;
  /** `min(stillToReserve, currentAvailable)`. */
  suggestedAdditionalReserve: string;
}

export interface ReservationStatusDTO {
  customerOrderId: string;
  lines: ReservationStatusLineDTO[];
}

export interface ReserveAvailableLineInput {
  customerOrderLineId: string;
  quantity: string;
}

export interface ReserveAvailableInput {
  lines: ReserveAvailableLineInput[];
}

export interface ReallocateReservationLineInput {
  /** Linha de reserva cujo remanescente (não expedido) será realocado via FEFO/FIFO. */
  customerOrderReservationLineId: string;
}
