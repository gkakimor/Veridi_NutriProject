/**
 * Contratos de Faturamento (Billing) — documento COMERCIAL/OPERACIONAL,
 * nunca fiscal (NF-e/DANFE/SEFAZ/impostos estão fora do MVP). A quantidade
 * faturável vem SEMPRE do que foi realmente expedido (`ShipmentLine` de uma
 * Expedição CONFIRMED), nunca do pedido/reservado/planejado/produzido.
 */

export const BILLING_CODE_PREFIX = "FAT";

/** `ISSUED` é histórico imutável — correção pós-emissão é evolução futura. */
export type BillingStatus = "DRAFT" | "ISSUED" | "CANCELLED";

/**
 * Aviso obrigatório em qualquer apresentação impressa do Faturamento.
 * O documento é comercial/operacional: não emite Nota Fiscal, não gera
 * DANFE/XML e não substitui a obrigação fiscal.
 */
export const BILLING_NON_FISCAL_NOTICE =
  "Documento comercial/operacional — não é Nota Fiscal.";

export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  DRAFT: "Rascunho",
  ISSUED: "Emitido",
  CANCELLED: "Cancelado",
};

export const BILLING_STATUSES: readonly BillingStatus[] = ["DRAFT", "ISSUED", "CANCELLED"];

/** Estado de faturamento de uma Expedição CONFIRMED — sempre derivado. */
export type ShipmentBillingStatus = "PENDING" | "DRAFT" | "ISSUED";

export const SHIPMENT_BILLING_STATUS_LABELS: Record<ShipmentBillingStatus, string> = {
  PENDING: "Pendente",
  DRAFT: "Em preparação",
  ISSUED: "Faturada",
};

/**
 * Estado de faturamento DERIVADO do Pedido — nunca persistido e nunca
 * misturado ao `CustomerOrder.status`, que continua representando só o
 * fluxo operacional/logístico.
 */
export type CustomerOrderBillingStatus = "NOT_READY" | "PENDING" | "PARTIALLY_BILLED" | "BILLED";

export const CUSTOMER_ORDER_BILLING_STATUS_LABELS: Record<CustomerOrderBillingStatus, string> = {
  NOT_READY: "Sem expedição confirmada",
  PENDING: "Aguardando faturamento",
  PARTIALLY_BILLED: "Parcialmente faturado",
  BILLED: "Faturado",
};

export interface BillingLineDTO {
  id: string;
  shipmentLineId: string;
  customerOrderLineId: string;
  productId: string;
  productCode: string;
  productName: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  lotId: string | null;
  lotCode: string | null;
  businessLotNumber: string | null;
  /** Idêntica à `ShipmentLine.quantity` — nunca editável. */
  quantity: string;
  unitCode: string;
  /** Opcional — o MVP não possui preço comercial confiável no Pedido. BRL quando informado. */
  unitPrice: string | null;
  /** `quantity × unitPrice`; `null` quando a linha não tem preço. Nunca persistido. */
  lineTotal: string | null;
  position: number;
}

export interface BillingDTO {
  id: string;
  code: string;
  customerOrderId: string;
  customerOrderCode: string;
  shipmentId: string;
  shipmentCode: string;
  shipmentDate: string | null;
  customerId: string;
  customerCode: string | null;
  customerName: string | null;
  customerTradeName: string | null;
  customerCnpj: string | null;
  status: BillingStatus;
  externalReference: string | null;
  notes: string | null;
  lines: BillingLineDTO[];
  totalQuantity: string;
  /** Só existe quando TODAS as linhas têm preço — nunca somar parcialmente. */
  totalAmount: string | null;
  /** `false` quando alguma linha está sem preço; a UI mostra "Valores incompletos". */
  hasCompletePricing: boolean;
  issuedAt: string | null;
  issuedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
}

export interface BillingListResponse {
  billings: BillingDTO[];
  page: number;
  pageSize: number;
  total: number;
}

/** Expedição CONFIRMED sem faturamento emitido — base do futuro relatório R-16. */
export interface AwaitingBillingRowDTO {
  shipmentId: string;
  shipmentCode: string;
  shipmentDate: string | null;
  customerOrderId: string;
  customerOrderCode: string;
  customerName: string | null;
  totalQuantity: string;
  billingStatus: ShipmentBillingStatus;
  /** Preenchidos quando já existe um Billing DRAFT para esta Expedição. */
  billingId: string | null;
  billingCode: string | null;
}

export interface AwaitingBillingListResponse {
  rows: AwaitingBillingRowDTO[];
}

export interface CreateBillingInput {
  shipmentId: string;
}

export interface UpdateBillingLineInput {
  billingLineId: string;
  /** `>= 0`; string vazia/ausente limpa o preço. */
  unitPrice?: string;
}

export interface UpdateBillingInput {
  externalReference?: string;
  notes?: string;
  lines?: UpdateBillingLineInput[];
}

export interface CancelBillingInput {
  reason: string;
}
