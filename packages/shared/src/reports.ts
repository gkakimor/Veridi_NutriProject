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
import type { PricingModelConfig } from "./pricing-model.js";
import type { QuotePriceSource, QuoteStatus } from "./projects.js";
import type { BillingStatus, CustomerOrderBillingStatus } from "./billings.js";
import type { CustomerOrderStatus } from "./customer-orders.js";
import type { InternalConsumptionDTO } from "./internal-consumption.js";
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
  /**
   * Distância em DIAS CIVIS até a validade, no fuso comercial: `0` é "vence
   * hoje" (o lote ainda vale o dia inteiro) e negativo é vencido, que a UI
   * apresenta como "Vencido há X dias". Nunca é a diferença até o relógio.
   */
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
  /**
   * Documento de origem, quando derivável pelos vínculos 1:1 existentes. No
   * estorno de consumo interno, o ECI- e o CI- que ele anula:
   * `ECI-000001 (estorno de CI-000123)`.
   */
  documentCode: string | null;
  /**
   * `STOCK_COUNT`: ajuste de Inventário Físico ou de Contagem rápida — o documento `INV-`.
   * `INTERNAL_CONSUMPTION`: o CI- da baixa; `INTERNAL_CONSUMPTION_REVERSAL`: o ECI-
   * (INTERNAL-CONSUMPTION-REVERSAL-01). Os dois não têm tela própria: sem link.
   */
  documentKind:
    | "RECEIPT"
    | "PRODUCTION_ORDER"
    | "SHIPMENT"
    | "PROJECT_SAMPLE"
    | "STOCK_COUNT"
    | "INTERNAL_CONSUMPTION"
    | "INTERNAL_CONSUMPTION_REVERSAL"
    | null;
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
  productId: string;
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
    productId: string;
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
  /**
   * Base do cálculo. Sem ela a coluna de custo total não diz de QUANTO ela é,
   * e a coluna de equivalente por 1.000 ao lado passa a parecer a base.
   */
  referenceOutputQuantity: string | null;
  referenceOutputUomCode: string | null;
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
  /** Custo do cálculo por unidade (CMV da faixa), congelado na ativação. */
  costPerUnit: string | null;
  /**
   * Custo p/ preço por unidade — o que FORMOU preço, markup e contribuição
   * (§84), congelado na ativação. No Modelo padrão é o custo do cálculo, e a
   * faixa ativada antes do campo lê o do cálculo. Fora do padrão, `null` é
   * base incompleta ou não congelada: nunca cai para o custo do cálculo
   * (PRICING-MODEL-VIEW-REPORTS-01).
   */
  pricingCostPerUnit: string | null;
  /**
   * Qualidade do custo p/ preço, congelada na ativação. Modelo padrão sem o
   * campo lê a do cálculo; Modelo flexível sem o campo é `null` — não congelada.
   */
  pricingCostQuality: IndustrialCostQuality | null;
  /** Modelo de Precificação da versão — copiado na aplicação, imutável depois da ativação. */
  pricingModel: PricingModelConfig;
  commissionPercent: string;
  unitPrice: string | null;
  contributionMarginPercent: string | null;
  markupPercent: string | null;
  contributionPerUnit: string | null;
  activatedAt: string | null;
}

/* ─────────────── R-20 Orçamento × Precificação ─────────────── */

/**
 * Auditoria comercial: qual proposta nasceu de precificação estruturada e
 * qual foi preço de exceção. Contém custo e margem — é documento INTERNO,
 * nunca o orçamento do cliente.
 */
/**
 * O que o R-20 escreve no lugar do Modelo da linha enviada: o envio não o
 * congela, e o relatório não o deduz do vínculo.
 */
export const MODELO_NAO_CONGELADO_NO_ENVIO = "Não congelado no envio";

export interface QuotePricingAuditRowDTO {
  /**
   * Identidade da linha do relatório: uma por linha de orçamento. A versão
   * com vários produtos repete `quoteVersionId` em cada uma
   * (R20-UX-CLEANUP-WAVE-01).
   */
  quoteLineId: string;
  quoteVersionId: string;
  quoteLabel: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  customerName: string | null;
  productCode: string | null;
  status: QuoteStatus;
  quotedQuantity: string | null;
  uomCode: string | null;
  unitPrice: string | null;
  total: string | null;
  priceSource: QuotePriceSource;
  pricingLabel: string | null;
  tierQuantity: string | null;
  calculationCode: string | null;
  /** Qualidade do custo do cálculo — a que a linha enviada congela. */
  costQuality: IndustrialCostQuality | null;
  /** Custo do cálculo por unidade (CMV da faixa) — o que a linha enviada congela. */
  industrialCostPerUnit: string | null;
  /**
   * Custo p/ preço por unidade da faixa vinculada. Só na linha viva
   * (rascunho), lido da faixa ativa, que é imutável. A linha enviada não
   * congela esse custo: `null`, com `pricingModelNotFrozen` dizendo por quê.
   */
  pricingCostPerUnit: string | null;
  /** Modelo da precificação vinculada — só na linha viva, pela mesma regra. */
  pricingModel: PricingModelConfig | null;
  /**
   * Linha enviada com proveniência de precificação: o envio congelou custo do
   * cálculo e margem, mas não o Modelo nem o custo p/ preço. O relatório não
   * os deduz do vínculo — fica dito que não foram congelados.
   */
  pricingModelNotFrozen: boolean;
  contributionMarginPercent: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
}

/* ─────────────── R-21 Uso e consumo ─────────────── */

/**
 * Relatório gerencial do consumo interno (INTERNAL-CONSUMPTION-REPORT-01,
 * Fatia 3 de Uso e consumo).
 *
 * Tudo sai dos SNAPSHOTS gravados em cada `CI-`: o custo do dia do consumo,
 * nunca o de hoje. Uma compra posterior não reescreve a despesa que já
 * aconteceu, e o relatório histórico não recalcula nada.
 *
 * A linha é o próprio `InternalConsumptionDTO` — o mesmo mapeamento do
 * histórico operacional, sem segunda leitura do registro.
 *
 * LÍQUIDO DOS ESTORNOS (INTERNAL-CONSUMPTION-REVERSAL-01, decisão R21-a do
 * PO): o estorno abate o consumo NA DATA DO CI. Indicadores e agrupamentos
 * usam quantidade e custo líquidos; o CI estornado por inteiro continua
 * listado, marcado, mas não conta em Consumos, Sem custo nem Itens distintos.
 * O período de um relatório passado muda quando chega um estorno depois — a
 * cronologia continua no extrato de movimentações.
 */
export interface InternalConsumptionReportSummaryDTO {
  /** Consumos do recorte inteiro, não da página — sem os estornados por inteiro. */
  consumptionCount: number;
  /** Consumos com custo conhecido — os únicos que entram no valor. */
  knownCostCount: number;
  /** Consumos sem custo (`totalCost` nulo). Nunca somados como zero. */
  missingCostCount: number;
  /**
   * Soma dos custos CONHECIDOS, líquida dos estornos. `null` quando nenhum
   * consumo que conta tem custo — ausência não vira R$ 0,00. `"0"` só quando
   * os custos conhecidos somam zero de verdade.
   */
  knownCostTotal: string | null;
  distinctItemCount: number;
  /** Consumos do recorte com pelo menos um estorno, parcial ou total. */
  reversedConsumptionCount: number;
}

/** Resumo por Item — uma linha por item e unidade gravada no consumo. */
export interface InternalConsumptionReportItemGroupDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  /** A unidade do snapshot; quantidade só soma dentro da mesma unidade. */
  uomCode: string;
  consumptionCount: number;
  /** Quantidade líquida dos estornos. */
  quantity: string;
  /** Soma dos custos conhecidos do item, líquida; `null` quando nenhum tem custo. */
  knownCostTotal: string | null;
  missingCostCount: number;
}

/**
 * Resumo por Destino/uso. O destino é texto livre: o agrupamento é pelo texto
 * gravado, exatamente como foi escrito — "Escritório" e "escritório" são duas
 * linhas até existir o Centro de Custo (INTERNAL-CONSUMPTION-COST-CENTER-01).
 */
export interface InternalConsumptionReportPurposeGroupDTO {
  /** `null` = consumo registrado sem destino. */
  purpose: string | null;
  consumptionCount: number;
  knownCostTotal: string | null;
  missingCostCount: number;
}

export interface InternalConsumptionReportDTO extends ReportPageDTO<InternalConsumptionDTO> {
  summary: InternalConsumptionReportSummaryDTO;
  /** Do recorte inteiro, maior valor conhecido primeiro. */
  byItem: InternalConsumptionReportItemGroupDTO[];
  byPurpose: InternalConsumptionReportPurposeGroupDTO[];
}

/**
 * Opções dos filtros de Destino/uso e Usuário, tiradas dos próprios
 * consumos: só destino que já foi escrito e só quem já registrou.
 */
export interface InternalConsumptionReportFilterOptionsDTO {
  purposes: string[];
  users: { id: string; name: string }[];
}
