/**
 * Contratos dos Relatórios (capacidade 31).
 *
 * Todo relatório é **read model**: deriva das entidades operacionais que já
 * são fonte de verdade (Item, Lot, InventoryMovement, OP, Consumo,
 * Apontamento, OC, Recebimento, Pedido, Expedição, Faturamento, Fundação de
 * Custos). Nenhuma tabela de relatório, nenhum agregado persistido, nenhum
 * campo criado só para alimentar tela.
 *
 * Quantidade nunca é somada entre unidades incompatíveis: cada linha carrega
 * a própria unidade, e totais só existem quando semanticamente válidos.
 */

import type { CostQuality, CostSource } from "./costs.js";
import type { IndustrialCostQuality } from "./industrial-cost-calculation.js";
import type { PriceMode } from "./pricing.js";
import type { BillingStatus, CustomerOrderBillingStatus } from "./billings.js";
import type { CustomerOrderStatus } from "./customer-orders.js";
import type { InventoryMovementSourceType, InventoryMovementType } from "./inventory.js";
import type { ItemType } from "./items.js";
import type { InventoryOwnerType, SupplyResponsibility } from "./ownership.js";
import type { CoaStatus } from "./lots.js";
import type { LotOrigin, LotStatus } from "./lots.js";
import type { ProductionOrderStatus } from "./production-orders.js";
import type { PurchaseOrderOrigin, PurchaseOrderStatus } from "./purchase-orders.js";

/** Envelope padrão de relatório paginado — `total` é o resultado FILTRADO completo. */
export interface ReportPageDTO<TRow> {
  rows: TRow[];
  page: number;
  pageSize: number;
  /** Total de linhas do filtro aplicado, não da página — base da futura exportação. */
  total: number;
}

export const REPORT_DEFAULT_PAGE_SIZE = 25;

/* ─────────────── R-01 Posição de Estoque ─────────────── */

export interface InventoryPositionRowDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  unitCode: string;
  /** `null` para item sem controle de lote — uma linha no nível do Item. */
  lotId: string | null;
  lotCode: string | null;
  lotOrigin: LotOrigin | null;
  supplierLot: string | null;
  businessLotNumber: string | null;
  supplierName: string | null;
  /** Proprietário do lote — estoque físico nunca é apresentado como "disponível Veridi" sem distinguir dono. */
  ownerType: InventoryOwnerType;
  ownerCustomerId: string | null;
  ownerCustomerName: string | null;
  /** Situação documental do laudo — "não exigido" quando o lote não pede CoA. */
  coaStatus: CoaStatus | null;
  expiryDate: string | null;
  location: string | null;
  onHand: string;
  reserved: string;
  available: string;
  status: LotStatus | null;
  isExpired: boolean;
}

/* ─────────────── R-02 Vencimentos ─────────────── */

export interface ExpiryRowDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  lotId: string;
  lotCode: string;
  lotOrigin: LotOrigin;
  businessLotNumber: string | null;
  supplierLot: string | null;
  expiryDate: string;
  /** Negativo quando já vencido — a UI apresenta como "Vencido há X dias". */
  daysToExpiry: number;
  onHand: string;
  reserved: string;
  available: string;
  status: LotStatus;
  isExpired: boolean;
  location: string | null;
}

/* ─────────────── R-03 Movimentações ─────────────── */

export interface MovementReportRowDTO {
  /** Proprietário do lote movimentado — `VERIDI` quando não há lote. */
  ownerType: InventoryOwnerType;
  ownerCustomerName: string | null;
  id: string;
  occurredAt: string;
  type: InventoryMovementType;
  itemId: string;
  itemCode: string;
  itemName: string;
  lotId: string | null;
  lotCode: string | null;
  quantity: string;
  unitCode: string;
  sourceType: InventoryMovementSourceType;
  /** Documento de origem, quando derivável pelos vínculos 1:1 existentes. */
  documentCode: string | null;
  documentKind: "RECEIPT" | "PRODUCTION_ORDER" | "SHIPMENT" | "PROJECT_SAMPLE" | null;
  documentId: string | null;
  reason: string | null;
  createdBy: string | null;
}

/* ─────────────── R-04 Necessidade / Falta para OP ─────────────── */

export interface ProductionRequirementRowDTO {
  productionOrderId: string;
  productionOrderCode: string;
  productionOrderStatus: ProductionOrderStatus;
  productId: string;
  productCode: string;
  productName: string;
  requirementId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  /** Quem deve fornecer: falta de material do cliente nunca vira necessidade de compra. */
  supplyResponsibility: SupplyResponsibility;
  /** Cliente esperado quando `supplyResponsibility = CUSTOMER`. */
  customerName: string | null;
  requiredQuantity: string;
  reserved: string;
  /** Disponível PARA ESTA OP — soma de volta a própria reserva, nunca gera falta falsa. */
  available: string;
  onOrder: string;
  shortage: string;
  unitCode: string;
}

/* ─────────────── R-05 Planejado x Realizado ─────────────── */

export interface PlannedActualRowDTO {
  productionOrderId: string;
  productionOrderCode: string;
  productId: string;
  productCode: string;
  productName: string;
  formulationVersionNumber: number | null;
  plannedQuantity: string;
  producedQuantity: string;
  /** `produzido - planejado`, com sinal. */
  variance: string;
  /** `produzido / planejado * 100`; `null` quando planejado é 0. */
  yieldPercent: string | null;
  unitCode: string;
  startedAt: string | null;
  completedAt: string | null;
  status: ProductionOrderStatus;
  /** `null` quando a qualidade do custo é PARTIAL/NO_COST — nunca custo parcial como completo. */
  materialUnitCost: string | null;
  costQuality: CostQuality;
}

/* ─────────────── R-06 Rastreabilidade por OP ─────────────── */

export interface TraceabilityConsumedRowDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  lotId: string | null;
  lotCode: string | null;
  supplierLot: string | null;
  supplierName: string | null;
  quantity: string;
  unitCode: string;
}

export interface TraceabilityProducedRowDTO {
  lotId: string;
  lotCode: string;
  businessLotNumber: string | null;
  quantity: string;
  unitCode: string;
  status: LotStatus;
  isExpired: boolean;
  expiryDate: string | null;
}

export interface ProductionTraceabilityDTO {
  productionOrderId: string;
  productionOrderCode: string;
  productId: string;
  productCode: string;
  productName: string;
  status: ProductionOrderStatus;
  plannedQuantity: string;
  producedQuantity: string;
  unitCode: string;
  completedAt: string | null;
  /** Somente ProductionConsumption — nunca reserva/FEFO/requirement. */
  consumed: TraceabilityConsumedRowDTO[];
  /** Somente ProductionOutput. */
  produced: TraceabilityProducedRowDTO[];
}

/* ─────────────── R-07 Consumo por período ─────────────── */

export interface ConsumptionRowDTO {
  id: string;
  consumedAt: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  lotId: string | null;
  lotCode: string | null;
  productId: string;
  productCode: string;
  productName: string;
  productionOrderId: string;
  productionOrderCode: string;
  quantity: string;
  unitCode: string;
  /** `null` quando o custo do lote consumido é desconhecido. */
  unitCost: string | null;
  costSource: CostSource;
  /** `quantidade × custo unitário`, `null` quando o custo não existe. */
  totalCost: string | null;
}

/* ─────────────── R-08 Ordens de Compra ─────────────── */

export interface PurchaseOrderReportRowDTO {
  purchaseOrderId: string;
  code: string;
  supplierId: string;
  supplierName: string;
  origin: PurchaseOrderOrigin;
  customerOrderId: string | null;
  customerOrderCode: string | null;
  status: PurchaseOrderStatus;
  orderDate: string;
  expectedDeliveryDate: string | null;
  itemCount: number;
  /** Só quando TODAS as linhas têm preço — soma parcial nunca vira total. */
  expectedAmount: string | null;
  linesWithPrice: number;
  receiptCount: number;
}

/* ─────────────── R-09 Recebimentos ─────────────── */

export interface ReceiptReportRowDTO {
  receiptLineId: string;
  receiptId: string;
  receiptCode: string;
  receivedAt: string;
  /** `null` em recebimento de material do cliente — não existe OC nem fornecedor. */
  purchaseOrderId: string | null;
  purchaseOrderCode: string | null;
  supplierId: string | null;
  supplierName: string | null;
  /** Dono do material recebido — `CUSTOMER` traz o cliente proprietário. */
  ownerType: InventoryOwnerType;
  ownerCustomerName: string | null;
  /** Situação documental do lote recebido; `null` quando a linha não gerou lote. */
  coaStatus: CoaStatus | null;
  itemId: string;
  itemCode: string;
  itemName: string;
  lotId: string | null;
  lotCode: string | null;
  supplierLot: string | null;
  receivedQuantity: string;
  unitCode: string;
  /** Preço previsto na OC — expectativa comercial, nunca custo real. */
  orderedUnitPrice: string | null;
  /** Custo efetivo de aquisição informado no recebimento. */
  actualUnitCost: string | null;
  costQuality: CostQuality;
}

/* ─────────────── R-10 Em Compra ─────────────── */

export interface OnOrderRowDTO {
  purchaseOrderId: string;
  purchaseOrderCode: string;
  purchaseOrderLineId: string;
  supplierId: string;
  supplierName: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  orderedQuantity: string;
  receivedQuantity: string;
  openQuantity: string;
  unitCode: string;
  expectedDeliveryDate: string | null;
  status: PurchaseOrderStatus;
  customerOrderId: string | null;
  customerOrderCode: string | null;
}

/* ─────────────── R-11 OCs atrasadas ─────────────── */

export interface LatePurchaseOrderRowDTO extends OnOrderRowDTO {
  /** Dias corridos desde a previsão de entrega — sempre positivo aqui. */
  daysLate: number;
}

/* ─────────────── R-12 Pedidos do Cliente ─────────────── */

export interface CustomerOrderReportRowDTO {
  customerOrderId: string;
  code: string;
  customerId: string;
  customerName: string;
  orderDate: string;
  requestedDeliveryDate: string | null;
  status: CustomerOrderStatus;
  billingStatus: CustomerOrderBillingStatus;
  lineCount: number;
  /** Códigos dos produtos — nunca uma soma de quantidades de UOMs distintas. */
  productCodes: string[];
  shipmentCount: number;
  billingCount: number;
}

/* ─────────────── R-13 Atendimento dos Pedidos ─────────────── */

export interface FulfillmentRowDTO {
  customerOrderId: string;
  customerOrderCode: string;
  customerOrderLineId: string;
  customerId: string;
  customerName: string;
  productId: string;
  productCode: string;
  productName: string;
  orderedQuantity: string;
  reservedRemaining: string;
  /** Soma dos ProductionOutput das OPs ligadas a esta linha do Pedido. */
  producedQuantity: string;
  productionOrderCount: number;
  shippedQuantity: string;
  billedQuantity: string;
  outstandingQuantity: string;
  unitCode: string;
  status: CustomerOrderStatus;
  billingStatus: CustomerOrderBillingStatus;
}

/* ─────────────── R-14 Pedido → Operação ─────────────── */

export interface OrderOperationReservationDTO {
  reservationLineId: string;
  productId: string;
  productCode: string;
  productName: string;
  lotId: string | null;
  lotCode: string | null;
  reservedQuantity: string;
  shippedQuantity: string;
  remainingQuantity: string;
  unitCode: string;
  releasedAt: string | null;
}

export interface OrderOperationProductionDTO {
  productionOrderId: string;
  code: string;
  productCode: string;
  productName: string;
  plannedQuantity: string;
  producedQuantity: string;
  unitCode: string;
  status: ProductionOrderStatus;
}

export interface OrderOperationPurchaseDTO {
  purchaseOrderId: string;
  code: string;
  supplierName: string;
  status: PurchaseOrderStatus;
  itemCount: number;
  expectedDeliveryDate: string | null;
}

export interface OrderOperationShipmentLineDTO {
  productCode: string;
  lotCode: string | null;
  quantity: string;
  unitCode: string;
}

export interface OrderOperationShipmentDTO {
  shipmentId: string;
  code: string;
  status: string;
  confirmedAt: string | null;
  lines: OrderOperationShipmentLineDTO[];
}

export interface OrderOperationBillingDTO {
  billingId: string;
  code: string;
  shipmentId: string;
  shipmentCode: string | null;
  status: BillingStatus;
  issuedAt: string | null;
  lineCount: number;
  /** Só quando o documento tem precificação completa. */
  totalAmount: string | null;
}

export interface OrderOperationDTO {
  customerOrderId: string;
  code: string;
  customerId: string;
  customerName: string;
  status: CustomerOrderStatus;
  orderDate: string;
  requestedDeliveryDate: string | null;
  lines: {
    customerOrderLineId: string;
    productCode: string;
    productName: string;
    orderedQuantity: string;
    unitCode: string;
  }[];
  reservations: OrderOperationReservationDTO[];
  productionOrders: OrderOperationProductionDTO[];
  purchaseOrders: OrderOperationPurchaseDTO[];
  shipments: OrderOperationShipmentDTO[];
  billings: OrderOperationBillingDTO[];
}

/* ─────────────── R-15 Faturamento por período ─────────────── */

export interface BillingPeriodRowDTO {
  billingId: string;
  code: string;
  issuedAt: string;
  customerOrderId: string;
  customerOrderCode: string | null;
  shipmentId: string;
  shipmentCode: string | null;
  customerId: string;
  customerName: string | null;
  lineCount: number;
  /** Só quando `hasCompletePricing`; caso contrário `null`. */
  totalAmount: string | null;
  hasCompletePricing: boolean;
  externalReference: string | null;
}

export interface BillingPeriodSummaryDTO {
  billingCount: number;
  billingsWithCompletePricing: number;
  /** Só existe quando TODOS os documentos do período têm preço completo. */
  totalAmount: string | null;
}

/* ─────────────── R-16 Aguardando faturamento ─────────────── */

export interface AwaitingBillingReportRowDTO {
  shipmentId: string;
  shipmentCode: string;
  confirmedAt: string | null;
  customerOrderId: string;
  customerOrderCode: string;
  customerId: string;
  customerName: string;
  lineCount: number;
  productCodes: string[];
  /** `PENDING` (nenhum documento) ou `DRAFT` (faturamento em preparação). */
  situation: "PENDING" | "DRAFT";
  billingId: string | null;
  billingCode: string | null;
  daysWaiting: number;
}

/* ─────────────── R-17 Pedido x Entregue x Faturado ─────────────── */

export interface OrderDeliveredBilledRowDTO {
  customerOrderId: string;
  customerOrderCode: string;
  customerOrderLineId: string;
  customerId: string;
  customerName: string;
  productId: string;
  productCode: string;
  productName: string;
  orderedQuantity: string;
  /** Somente Expedições CONFIRMED. */
  shippedQuantity: string;
  /** Somente Faturamentos ISSUED — DRAFT nunca conta. */
  billedQuantity: string;
  unbilledShippedQuantity: string;
  outstandingDeliveryQuantity: string;
  unitCode: string;
  status: CustomerOrderStatus;
  billingStatus: CustomerOrderBillingStatus;
}

/* ─────────────── R-18 Custo industrial por produto ─────────────── */

/**
 * Último cálculo SALVO por produto. Nada é recalculado em massa ao abrir o
 * relatório, e produto sem cálculo salvo mostra "—": ausência é informação.
 */
export interface IndustrialCostByProductRowDTO {
  productId: string;
  productCode: string;
  productName: string;
  customerName: string | null;
  activeCostVersionLabel: string | null;
  calculationId: string | null;
  calculationCode: string | null;
  costReferenceDate: string | null;
  calculatedAt: string | null;
  quality: IndustrialCostQuality | null;
  /** `null` em cálculo parcial — o subtotal conhecido vai separado. */
  totalIndustrialCost: string | null;
  knownSubtotal: string | null;
  costPerUnit: string | null;
  costPer1000: string | null;
}

/* ─────────────── R-19 Precificação por Produto ─────────────── */

/**
 * Uma linha por FAIXA de uma precificação ATIVA. Nada é recalculado: o
 * relatório lê os snapshots congelados na ativação, que são o preço que a
 * empresa realmente pratica.
 */
export interface PricingByProductRowDTO {
  pricingVersionId: string;
  pricingLabel: string;
  productId: string;
  productCode: string;
  productName: string;
  customerName: string | null;
  calculationCode: string;
  costReferenceDate: string;
  costQuality: IndustrialCostQuality;
  quantity: string;
  uomCode: string;
  priceMode: PriceMode;
  costPerUnit: string | null;
  commissionPercent: string;
  unitPrice: string | null;
  contributionMarginPercent: string | null;
  markupPercent: string | null;
  contributionPerUnit: string | null;
  activatedAt: string | null;
}
