/** Contratos do serviço de sugestão de alocação de lotes (FEFO/FIFO), consumidos por `apps/api` e `apps/web`. */

/**
 * FEFO para itens com validade; FIFO (recebimento mais antigo) como
 * fallback para itens que controlam lote sem validade; NO_LOT quando o
 * item não controla lote (não há escolha de lote possível).
 */
export type AllocationStrategy = "FEFO" | "FIFO" | "NO_LOT";

export const ALLOCATION_STRATEGY_LABELS: Record<AllocationStrategy, string> = {
  FEFO: "FEFO",
  FIFO: "FIFO",
  NO_LOT: "Sem controle de lote",
};

export interface LotAllocationDTO {
  lotId: string;
  lotCode: string;
  supplierLot: string | null;
  expiryDate: string | null;
  location: string | null;
  /** Decimal como string — On Hand elegível do lote no momento da consulta. */
  availableQuantity: string;
  /** Decimal como string — quanto deste lote a sugestão usa. */
  suggestedQuantity: string;
}

/**
 * Recomendação de alocação — nunca uma reserva/movimentação. Puro
 * cálculo sob demanda a partir do InventoryMovement ledger.
 */
export interface AllocationSuggestionDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  strategy: AllocationStrategy;
  requiredQuantity: string;
  /** Soma do On Hand elegível (AVAILABLE, não vencido, saldo > 0) — nunca inclui On Order. */
  availableQuantity: string;
  allocatedQuantity: string;
  /** `max(0, requiredQuantity - allocatedQuantity)` — falta é resultado operacional válido, não erro. */
  shortageQuantity: string;
  /** Vazio quando o item não controla lote (`strategy: "NO_LOT"`). */
  allocations: LotAllocationDTO[];
}
