/**
 * Contratos de Expedição (Shipment) — separação e saída física de produto
 * acabado de um Pedido. Só uma Expedição CONFIRMED altera estoque; DRAFT é
 * apenas separação. O futuro Faturamento se baseia no realmente expedido
 * (`ShipmentLine.quantity` de Expedições CONFIRMED), nunca na quantidade
 * pedida/reservada/planejada.
 */

import type { ShipmentBillingStatus } from "./billings.js";

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
  /** Linha loteada com quantidade > 0 exige conferência física antes da confirmação. */
  requiresVerification: boolean;
  /** Conferência física do lote — auditoria, nunca movimento de estoque. */
  verifiedAt: string | null;
  verifiedBy: string | null;
}

/**
 * Situação de conferência de um produto da Expedição — **derivada, nunca
 * persistida**. `READY` = há quantidade separada e nenhum lote conferido
 * ainda; `VERIFIED` = todos os lotes com quantidade > 0 foram conferidos.
 */
export type ShipmentProductStatus = "PENDING" | "READY" | "PARTIAL" | "VERIFIED";

export const SHIPMENT_PRODUCT_STATUS_LABELS: Record<ShipmentProductStatus, string> = {
  PENDING: "Pendente",
  READY: "Pronto",
  PARTIAL: "Parcial",
  VERIFIED: "Conferido",
};

/**
 * Progresso por linha do Pedido dentro da Expedição. Todos os totais são
 * derivados na leitura — nada aqui é armazenado.
 */
export interface ShipmentProductGroupDTO {
  customerOrderLineId: string;
  productId: string;
  productCode: string;
  productName: string;
  /** `null` enquanto o Pedido não tem snapshot do Finished Product Item. */
  itemId: string | null;
  finishedItemCode: string | null;
  finishedItemName: string | null;
  unitCode: string;
  orderedQuantity: string;
  /** Já expedido em Expedições CONFIRMED (inclui esta, depois de confirmada). */
  shippedQuantity: string;
  /** `ordered - shipped`, nunca negativo. */
  outstandingQuantity: string;
  /** Soma dos `reservedRemaining` das linhas desta Expedição. */
  reservedRemaining: string;
  /** Soma das quantidades desta Expedição para este produto. */
  shippingNow: string;
  lotsRequired: number;
  lotsVerified: number;
  status: ShipmentProductStatus;
}

export interface ShipmentVerificationSummaryDTO {
  /** Produtos com quantidade > 0 nesta Expedição. */
  productCount: number;
  lotsRequired: number;
  lotsVerified: number;
  allLotsVerified: boolean;
}

export interface VerifyShipmentLineInput {
  /** Código puro (`LT-...`) ou payload de QR (`LOT:LT-...`). */
  lotCode: string;
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
  /** Um grupo por linha do Pedido — inclusive produtos ainda sem reserva nesta Expedição. */
  products: ShipmentProductGroupDTO[];
  /** Contagem de produtos/lotes conferidos — nunca soma de unidades incompatíveis. */
  verification: ShipmentVerificationSummaryDTO;
  /** Soma das quantidades das linhas. */
  totalQuantity: string;
  /** Estado de faturamento derivado — só relevante quando `CONFIRMED`. */
  billingStatus: ShipmentBillingStatus;
  /** Preenchidos quando existe um Billing ativo (DRAFT/ISSUED) para esta Expedição. */
  billingId: string | null;
  billingCode: string | null;
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
