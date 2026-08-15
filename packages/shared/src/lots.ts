/** Contratos do módulo de Lotes internos, consumidos por `apps/api` e `apps/web`. */

export type LotStatus = "AWAITING_RELEASE" | "AVAILABLE" | "BLOCKED" | "EXPIRED";

export const LOT_STATUSES: readonly LotStatus[] = [
  "AWAITING_RELEASE",
  "AVAILABLE",
  "BLOCKED",
  "EXPIRED",
];

export const LOT_STATUS_LABELS: Record<LotStatus, string> = {
  AWAITING_RELEASE: "Aguardando liberação",
  AVAILABLE: "Disponível",
  BLOCKED: "Bloqueado",
  EXPIRED: "Vencido",
};

export interface LotDTO {
  id: string;
  code: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  supplierLot: string | null;
  expiryDate: string | null;
  /** Calculado (`expiryDate < hoje`), nunca escrito por job — sem scheduler nesta entrega. */
  isExpired: boolean;
  /** Quanto entrou neste recebimento — NÃO é saldo atual. Saldo virá de Inventory Movements. */
  initialReceivedQuantity: string;
  status: LotStatus;
  location: string | null;
  receiptId: string;
  receiptCode: string;
  purchaseOrderId: string;
  purchaseOrderCode: string;
  createdAt: string;
  createdBy: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
  blockedAt: string | null;
  blockedBy: string | null;
  blockReason: string | null;
}

export interface LotListResponse {
  lots: LotDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface BlockLotInput {
  reason: string;
}
