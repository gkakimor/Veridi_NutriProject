/** Contratos do módulo de Lotes internos, consumidos por `apps/api` e `apps/web`. */

/**
 * Prefixo do payload de QR do lote. O QR identifica só o lote interno —
 * nunca dados mutáveis (quantidade/status/localização/validade/fornecedor).
 * Ex.: `LOT:LT-20260815-000123`.
 */
export const LOT_QR_PREFIX = "LOT:";

/** Remove o prefixo `LOT:` (se presente) e normaliza espaços/caixa do código escaneado/digitado. */
export function normalizeLotLookupCode(raw: string): string {
  const trimmed = raw.trim();
  const withoutPrefix = trimmed.toUpperCase().startsWith(LOT_QR_PREFIX)
    ? trimmed.slice(LOT_QR_PREFIX.length)
    : trimmed;
  return withoutPrefix.trim().toUpperCase();
}

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
  /** `LOT:<code>` — payload determinístico codificado no QR. */
  qrPayload: string;
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
  /** Quanto entrou neste recebimento — NÃO é saldo atual. Saldo vem do InventoryMovement ledger. */
  initialReceivedQuantity: string;
  /** Derivado do InventoryMovement ledger — nunca uma coluna armazenada em Lot. */
  onHand: string;
  /** Soma das MaterialReservationLine ACTIVE deste lote — real a partir do RELEASE de OP. */
  reserved: string;
  /** `onHand - reserved` se status AVAILABLE e não vencido; "0" caso contrário (bloqueado/aguardando/vencido). */
  available: string;
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
