/** Contratos do módulo de Recebimento, consumidos por `apps/api` e `apps/web`. */

export const RECEIPT_CODE_PREFIX = "REC";

export interface ReceiptLineDTO {
  id: string;
  purchaseOrderLineId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  /** Decimal como string — nunca usar float JS como fonte de precisão. */
  receivedQuantity: string;
  supplierLot: string | null;
  expiryDate: string | null;
  location: string | null;
  lotId: string | null;
  lotCode: string | null;
  /** Preço previsto/negociado da linha da OC — referência visual, nunca custo real. */
  purchaseUnitPrice: string | null;
  /** Custo efetivo de aquisição por unidade de estoque. `null` = desconhecido (nunca `0`). */
  actualUnitCost: string | null;
  costUpdatedAt: string | null;
  costUpdatedBy: string | null;
  costNote: string | null;
}

export interface ReceiptDTO {
  id: string;
  code: string;
  purchaseOrderId: string;
  purchaseOrderCode: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  receivedAt: string;
  invoiceNumber: string | null;
  documentReference: string | null;
  notes: string | null;
  lines: ReceiptLineDTO[];
  createdAt: string;
  createdBy: string | null;
}

export interface ReceiptListResponse {
  receipts: ReceiptDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateReceiptLineInput {
  purchaseOrderLineId: string;
  /** Decimal como string (ou number, convertido no cliente) — evita perda de precisão. */
  receivedQuantity: string;
  supplierLot?: string;
  expiryDate?: string;
  location?: string;
  /**
   * Custo efetivo de aquisição por unidade de estoque — SEMPRE opcional:
   * o recebimento físico nunca falha por falta de custo. Nunca preenchido
   * automaticamente a partir do preço da OC.
   */
  actualUnitCost?: string;
}

export interface CreateReceiptInput {
  receivedAt: string;
  invoiceNumber?: string;
  documentReference?: string;
  notes?: string;
  lines: CreateReceiptLineInput[];
}
