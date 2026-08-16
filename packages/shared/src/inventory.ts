/** Contratos do módulo de Estoque (ledger, disponibilidade, ajustes, inventário físico). */

import type { ItemType } from "./items.js";
import type { LotStatus } from "./lots.js";

/**
 * Tipos do ledger. Preparado para expansão futura (RETURN_TO_STOCK) — não
 * criado agora porque devolução pós-produção ainda não existe.
 */
export type InventoryMovementType =
  | "RECEIPT_IN"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT"
  | "LOSS"
  | "PRODUCTION_CONSUMPTION"
  | "FINISHED_GOOD_PRODUCTION";

export const INVENTORY_MOVEMENT_TYPES: readonly InventoryMovementType[] = [
  "RECEIPT_IN",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "LOSS",
  "PRODUCTION_CONSUMPTION",
  "FINISHED_GOOD_PRODUCTION",
];

export const INVENTORY_MOVEMENT_TYPE_LABELS: Record<InventoryMovementType, string> = {
  RECEIPT_IN: "Entrada — Recebimento",
  ADJUSTMENT_IN: "Ajuste de entrada",
  ADJUSTMENT_OUT: "Ajuste de saída",
  LOSS: "Perda",
  PRODUCTION_CONSUMPTION: "Consumo de produção",
  FINISHED_GOOD_PRODUCTION: "Entrada — Produção",
};

/**
 * Sinal usado para somar o On Hand — nunca um valor negativo armazenado no
 * banco; `quantity` do movimento é sempre a magnitude (positiva).
 */
export const INVENTORY_MOVEMENT_DIRECTION: Record<InventoryMovementType, 1 | -1> = {
  RECEIPT_IN: 1,
  ADJUSTMENT_IN: 1,
  ADJUSTMENT_OUT: -1,
  LOSS: -1,
  PRODUCTION_CONSUMPTION: -1,
  FINISHED_GOOD_PRODUCTION: 1,
};

export type InventoryMovementSourceType =
  | "RECEIPT"
  | "MANUAL_ADJUSTMENT"
  | "STOCK_COUNT"
  | "MANUAL_LOSS"
  | "PRODUCTION_CONSUMPTION"
  | "FINISHED_GOOD_PRODUCTION";

export const INVENTORY_MOVEMENT_SOURCE_LABELS: Record<InventoryMovementSourceType, string> = {
  RECEIPT: "Recebimento",
  MANUAL_ADJUSTMENT: "Ajuste manual",
  STOCK_COUNT: "Inventário físico",
  MANUAL_LOSS: "Perda manual",
  PRODUCTION_CONSUMPTION: "Consumo de produção",
  FINISHED_GOOD_PRODUCTION: "Produção",
};

export interface InventoryMovementDTO {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  lotId: string | null;
  lotCode: string | null;
  type: InventoryMovementType;
  /** Decimal como string — sempre positivo (magnitude); sinal vem do `type`. */
  quantity: string;
  occurredAt: string;
  sourceType: InventoryMovementSourceType;
  sourceId: string | null;
  receiptId: string | null;
  receiptCode: string | null;
  purchaseOrderId: string | null;
  purchaseOrderCode: string | null;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface InventoryMovementListResponse {
  movements: InventoryMovementDTO[];
  page: number;
  pageSize: number;
  total: number;
}

/** Resumo de disponibilidade por item — nível Visão Geral do Estoque. */
export interface InventoryItemSummaryDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  unitCode: string;
  controlsLot: boolean;
  /** Soma algébrica dos InventoryMovements — nunca uma coluna armazenada. */
  onHand: string;
  /** Soma das MaterialReservationLine de reservas ACTIVE — real a partir do RELEASE de OP. */
  reserved: string;
  /** `onHand - reserved`, nunca negativo, restrito a lotes AVAILABLE/não vencidos quando o item controla lote. */
  available: string;
  /** Quantidade aberta em OCs ORDERED/PARTIALLY_RECEIVED — nunca uma segunda quantidade persistida. */
  onOrder: string;
}

export interface InventoryListResponse {
  items: InventoryItemSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface InventoryLotBreakdownDTO {
  lotId: string;
  lotCode: string;
  expiryDate: string | null;
  isExpired: boolean;
  location: string | null;
  status: LotStatus;
  onHand: string;
  /** Soma das MaterialReservationLine ACTIVE deste lote. */
  reserved: string;
  /** `onHand - reserved` se status AVAILABLE e não vencido; "0" caso contrário — material bloqueado não some do estoque. */
  available: string;
}

export interface InventoryItemDetailDTO extends InventoryItemSummaryDTO {
  /** Vazio quando `controlsLot=false`. Ordenado por validade (ascendente) e depois código — apresentação, não é FEFO operacional. */
  lots: InventoryLotBreakdownDTO[];
}

export interface CreateInventoryAdjustmentInput {
  itemId: string;
  lotId?: string;
  type: "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "LOSS";
  quantity: string;
  reason: string;
}

export interface StockCountInput {
  itemId: string;
  lotId?: string;
  countedQuantity: string;
  /** Obrigatório quando há diferença; validado no backend. */
  reason?: string;
}

export interface StockCountResultDTO {
  itemId: string;
  lotId: string | null;
  systemQuantity: string;
  countedQuantity: string;
  /** `countedQuantity - systemQuantity`. */
  difference: string;
  /** `null` quando não houve diferença — nenhum InventoryMovement é criado nesse caso. */
  movementCreated: InventoryMovementDTO | null;
}
