/** Contratos do módulo de Recebimento, consumidos por `apps/api` e `apps/web`. */

import type { InventoryOwnerType } from "./ownership.js";
import type { CoaStatus } from "./lots.js";

export const RECEIPT_CODE_PREFIX = "REC";

/**
 * Origem do recebimento. `CUSTOMER_SUPPLIED` existe exatamente para NÃO
 * precisar de Ordem de Compra falsa nem Fornecedor fake quando o material
 * é enviado pelo próprio cliente.
 */
export type ReceiptSourceType = "PURCHASE_ORDER" | "CUSTOMER_SUPPLIED";

export const RECEIPT_SOURCE_TYPES: readonly ReceiptSourceType[] = [
  "PURCHASE_ORDER",
  "CUSTOMER_SUPPLIED",
];

export const RECEIPT_SOURCE_TYPE_LABELS: Record<ReceiptSourceType, string> = {
  PURCHASE_ORDER: "Ordem de Compra",
  CUSTOMER_SUPPLIED: "Material enviado pelo cliente",
};

export interface ReceiptLineDTO {
  id: string;
  /** `null` em recebimento de material do cliente — a linha é direta, sem OC. */
  purchaseOrderLineId: string | null;
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
  /** Dono do lote criado por esta linha. */
  ownerType: InventoryOwnerType;
  /** Situação documental do lote gerado por esta linha. */
  coaStatus: CoaStatus | null;
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
  sourceType: ReceiptSourceType;
  /** Preenchidos só quando `sourceType = PURCHASE_ORDER`. */
  purchaseOrderId: string | null;
  purchaseOrderCode: string | null;
  supplierId: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  /** Preenchidos só quando `sourceType = CUSTOMER_SUPPLIED` — dono do material. */
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
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

/** Linha direta de material do cliente — sem OC, com Item informado no próprio recebimento. */
export interface CustomerSuppliedReceiptLineInput {
  itemId: string;
  receivedQuantity: string;
  unitCode?: string;
  /** Lote do fabricante informado pelo cliente — nunca substitui o lote interno. */
  supplierLot?: string;
  expiryDate?: string;
  location?: string;
}

export interface CreateCustomerSuppliedReceiptInput {
  customerId: string;
  receivedAt: string;
  /** Opcional: material do cliente pode chegar com documento diferente de NF. */
  invoiceNumber?: string;
  documentReference?: string;
  notes?: string;
  lines: CustomerSuppliedReceiptLineInput[];
}

export interface CreateReceiptInput {
  receivedAt: string;
  invoiceNumber?: string;
  documentReference?: string;
  notes?: string;
  lines: CreateReceiptLineInput[];
}
