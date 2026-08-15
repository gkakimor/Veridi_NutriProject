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
}

export interface CreateReceiptInput {
  receivedAt: string;
  invoiceNumber?: string;
  documentReference?: string;
  notes?: string;
  lines: CreateReceiptLineInput[];
}
