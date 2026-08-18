/** Contratos do módulo de Lotes internos, consumidos por `apps/api` e `apps/web`. */

import type { InventoryOwnerType } from "./ownership.js";

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

/**
 * Origem do lote — mesma infraestrutura de `Lot` para as duas, nunca um
 * segundo modelo só para produto acabado. `RECEIPT`: veio de um
 * Recebimento (Supplier/Receipt/OC). `PRODUCTION`: veio de um
 * `ProductionOutput` (OP/Product) — nunca exige Supplier/Receipt.
 */
export type LotOrigin = "RECEIPT" | "PRODUCTION" | "OPENING_BALANCE";

export const LOT_ORIGIN_LABELS: Record<LotOrigin, string> = {
  RECEIPT: "Recebimento",
  PRODUCTION: "Produção",
  // Lote informado na migração: não veio de compra nem de produção.
  OPENING_BALANCE: "Saldo de abertura",
};

/**
 * Situação DOCUMENTAL do laudo/CoA do lote — independente do status
 * operacional. Aprovar o CoA nunca libera o lote sozinho.
 */
export type CoaStatus = "NOT_REQUIRED" | "PENDING" | "RECEIVED" | "APPROVED" | "REJECTED";

export const COA_STATUSES: readonly CoaStatus[] = [
  "NOT_REQUIRED",
  "PENDING",
  "RECEIVED",
  "APPROVED",
  "REJECTED",
];

export const COA_STATUS_LABELS: Record<CoaStatus, string> = {
  NOT_REQUIRED: "Não exigido",
  PENDING: "Pendente de documento",
  RECEIVED: "Aguardando análise",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
};

export interface LotDTO {
  id: string;
  code: string;
  /** `LOT:<code>` — payload determinístico codificado no QR. Mesmo payload para as duas origens. */
  qrPayload: string;
  origin: LotOrigin;
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  /**
   * Dono do estoque físico — independente de Fornecedor. `CUSTOMER`
   * sempre traz o cliente proprietário; `VERIDI` nunca traz.
   */
  ownerType: InventoryOwnerType;
  ownerCustomerId: string | null;
  ownerCustomerCode: string | null;
  ownerCustomerName: string | null;
  /**
   * Exigência documental congelada quando o lote nasceu — as regras usam
   * este valor, nunca `Item.requiresCoa` atual.
   */
  requiresCoa: boolean;
  coaStatus: CoaStatus;
  coaReviewedAt: string | null;
  coaReviewedByName: string | null;
  coaReviewNote: string | null;
  /** `null` para lotes `PRODUCTION` — nunca fornecedor fake. */
  supplierId: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  /** Sempre `null` para lotes `PRODUCTION` — nunca confundido com o lote Veridi. */
  supplierLot: string | null;
  /** Lote comercial/Veridi — só para lotes `PRODUCTION`, informado pelo usuário na criação, histórico. */
  businessLotNumber: string | null;
  expiryDate: string | null;
  /** Calculado (`expiryDate < hoje`), nunca escrito por job — sem scheduler nesta entrega. */
  isExpired: boolean;
  /** Quanto entrou no evento que criou o lote (recebimento ou primeira produção) — NÃO é saldo atual. Saldo vem do InventoryMovement ledger. */
  initialReceivedQuantity: string;
  /** Soma dos `ProductionOutput` deste lote — só para `origin=PRODUCTION`; `null` para `RECEIPT`. Nunca chamado de saldo: é a quantidade produzida acumulada, não o saldo atual. */
  producedQuantity: string | null;
  /** Derivado do InventoryMovement ledger — nunca uma coluna armazenada em Lot. */
  onHand: string;
  /** Soma das MaterialReservationLine ACTIVE deste lote — real a partir do RELEASE de OP. */
  reserved: string;
  /** `onHand - reserved` se status AVAILABLE e não vencido; "0" caso contrário (bloqueado/aguardando/vencido). */
  available: string;
  status: LotStatus;
  location: string | null;
  /** `null` para lotes `PRODUCTION`. */
  receiptId: string | null;
  receiptCode: string | null;
  purchaseOrderId: string | null;
  purchaseOrderCode: string | null;
  /** `null` para lotes `RECEIPT`. */
  productionOrderId: string | null;
  productionOrderCode: string | null;
  createdAt: string;
  createdBy: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
  blockedAt: string | null;
  blockedBy: string | null;
  blockReason: string | null;
  /**
   * Expedições que levaram este lote embora — só CONFIRMED conta como saída
   * real, mas rascunho e cancelada também aparecem porque explicam onde o
   * lote está comprometido. Vazio quando o lote nunca foi expedido.
   */
  shipments: LotShipmentSummaryDTO[];
}

export interface LotShipmentSummaryDTO {
  id: string;
  code: string;
  status: string;
  shippedAt: string | null;
  /** Quanto deste lote saiu nesta expedição. */
  quantity: string;
  unitCode: string;
  customerOrderId: string | null;
  customerOrderCode: string | null;
  customerId: string | null;
  customerName: string | null;
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

/* ─────────────── Qualidade documental (CoA) ─────────────── */

export interface CoaReviewResultDTO {
  lotId: string;
  lotCode: string;
  coaStatus: CoaStatus;
  /** Estado operacional após a revisão — aprovar não muda, rejeitar pode bloquear. */
  lotStatus: LotStatus;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
}

export interface QualityQueueRowDTO {
  lotId: string;
  lotCode: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  sourceName: string | null;
  declaredNutrient: string | null;
  lotOrigin: LotOrigin;
  supplierName: string | null;
  ownerType: InventoryOwnerType;
  ownerCustomerName: string | null;
  receivedAt: string;
  expiryDate: string | null;
  isExpired: boolean;
  requiresCoa: boolean;
  coaStatus: CoaStatus;
  coaReviewedByName: string | null;
  coaReviewNote: string | null;
  lotStatus: LotStatus;
  onHand: string;
  unitCode: string;
}

export interface QualityQueueResponse {
  rows: QualityQueueRowDTO[];
  page: number;
  pageSize: number;
  total: number;
}
