import type {
  AwaitingBillingReportRowDTO,
  BillingPeriodRowDTO,
  ConsumptionRowDTO,
  CustomerOrderReportRowDTO,
  ExpiryRowDTO,
  FulfillmentRowDTO,
  InventoryPositionRowDTO,
  LatePurchaseOrderRowDTO,
  MovementReportRowDTO,
  OnOrderRowDTO,
  OrderDeliveredBilledRowDTO,
  PlannedActualRowDTO,
  ProductionRequirementRowDTO,
  PurchaseOrderReportRowDTO,
  ReceiptReportRowDTO,
} from "@veridi/shared";
import { COA_STATUS_LABELS, SUPPLY_RESPONSIBILITY_LABELS } from "@veridi/shared";
import {
  COST_SOURCE_LABELS,
  CUSTOMER_ORDER_BILLING_STATUS_LABELS,
  CUSTOMER_ORDER_STATUS_LABELS,
  INVENTORY_MOVEMENT_TYPE_LABELS,
  ITEM_TYPE_LABELS,
  LOT_STATUS_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_STATUS_LABELS,
} from "@veridi/shared";
import { csvCode, csvDate, csvDateTime, csvDecimal, csvMoney, csvText } from "../../lib/csv.js";
import { ALL_ROWS } from "../../lib/pagination.js";
import {
  getExpiryReport,
  getInventoryPosition,
  getMovementsReport,
} from "../reports/inventory-reports.service.js";
import {
  getConsumptionReport,
  getPlannedActualReport,
  getRequirementsReport,
} from "../reports/production-reports.service.js";
import {
  getLatePurchaseOrdersReport,
  getOnOrderReport,
  getPurchaseOrdersReport,
  getReceiptsReport,
} from "../reports/purchasing-reports.service.js";
import {
  getCustomerOrdersReport,
  getFulfillmentReport,
  getOrderDeliveredBilledReport,
} from "../reports/commercial-reports.service.js";
import {
  getAwaitingBillingReport,
  getBillingPeriodReport,
} from "../reports/billing-reports.service.js";
import type {
  AwaitingBillingQuery,
  BillingPeriodQuery,
  ConsumptionQuery,
  CustomerOrdersQuery,
  ExpiryQuery,
  FulfillmentQuery,
  InventoryPositionQuery,
  MovementsQuery,
  OnOrderQuery,
  PlannedActualQuery,
  PurchaseOrdersQuery,
  ReceiptsQuery,
  RequirementsQuery,
} from "../reports/reports.schemas.js";
import {
  awaitingBillingQuerySchema,
  billingPeriodQuerySchema,
  consumptionQuerySchema,
  customerOrdersQuerySchema,
  expiryQuerySchema,
  fulfillmentQuerySchema,
  inventoryPositionQuerySchema,
  movementsQuerySchema,
  onOrderQuerySchema,
  plannedActualQuerySchema,
  purchaseOrdersQuerySchema,
  receiptsQuerySchema,
  requirementsQuerySchema,
} from "../reports/reports.schemas.js";
import type {
  IndustrialCostByProductRowDTO,
  PricingByProductRowDTO,
  QuotePricingAuditRowDTO,
} from "@veridi/shared";
import {
  INDUSTRIAL_COST_QUALITY_LABELS,
  PRICE_MODE_LABELS,
  QUOTE_PRICE_SOURCE_LABELS,
  QUOTE_STATUS_LABELS,
} from "@veridi/shared";
import {
  getIndustrialCostByProductReport,
  getPricingByProductReport,
  getQuotePricingAuditReport,
} from "../reports/cost-reports.service.js";
import type {
  IndustrialCostByProductQuery,
  PricingByProductQuery,
  QuotePricingAuditQuery,
} from "../reports/reports.schemas.js";
import {
  industrialCostByProductQuerySchema,
  pricingByProductQuerySchema,
  quotePricingAuditQuerySchema,
} from "../reports/reports.schemas.js";
import type { CsvExportRoute } from "./csv-export.js";
import { defineCsvExport } from "./csv-export.js";

/**
 * CSV dos relatórios R-01…R-17.
 *
 * Nenhuma lógica de relatório é reimplementada: cada exportação chama o
 * MESMO serviço da tela com os MESMOS filtros, pedindo `ALL_ROWS`. O teto de
 * paginação da interface não limita a exportação.
 *
 * R-06 (rastreabilidade por OP) e R-14 (pedido → operação) são consultas de
 * documento único, não listagens tabulares — a saída deles é a impressão.
 */

/** Período aplicado, para compor o nome do arquivo. */
function period<TQuery extends { from?: Date | undefined; to?: Date | undefined }>(query: TQuery) {
  return {
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
  };
}

const r01 = defineCsvExport({
  path: "/reports/inventory/position/export.csv",
  slug: "r01_posicao_estoque",
  schema: inventoryPositionQuerySchema,
  fetch: async (query: InventoryPositionQuery) => (await getInventoryPosition(query, ALL_ROWS)).rows,
  columns: [
    { header: "Item", value: (row: InventoryPositionRowDTO) => csvCode(row.itemCode) },
    { header: "Descrição", value: (row: InventoryPositionRowDTO) => csvText(row.itemName) },
    { header: "Tipo", value: (row: InventoryPositionRowDTO) => ITEM_TYPE_LABELS[row.itemType] },
    { header: "Lote interno", value: (row: InventoryPositionRowDTO) => csvCode(row.lotCode) },
    { header: "Lote do fornecedor", value: (row: InventoryPositionRowDTO) => csvCode(row.supplierLot) },
    { header: "Lote Veridi", value: (row: InventoryPositionRowDTO) => csvCode(row.businessLotNumber) },
    {
      header: "Proprietário",
      value: (row: InventoryPositionRowDTO) =>
        row.ownerType === "CUSTOMER" ? csvText(row.ownerCustomerName ?? "Cliente") : "Veridi",
    },
    { header: "Fornecedor", value: (row: InventoryPositionRowDTO) => csvText(row.supplierName) },
    { header: "Validade", value: (row: InventoryPositionRowDTO) => csvDate(row.expiryDate) },
    { header: "Localização", value: (row: InventoryPositionRowDTO) => csvText(row.location) },
    { header: "On Hand", value: (row: InventoryPositionRowDTO) => csvDecimal(row.onHand) },
    { header: "Reservado", value: (row: InventoryPositionRowDTO) => csvDecimal(row.reserved) },
    { header: "Disponível", value: (row: InventoryPositionRowDTO) => csvDecimal(row.available) },
    { header: "Unidade", value: (row: InventoryPositionRowDTO) => csvText(row.unitCode) },
    {
      header: "Qualidade",
      value: (row: InventoryPositionRowDTO) =>
        row.isExpired ? "Vencido" : row.status ? LOT_STATUS_LABELS[row.status] : "",
    },
    {
      header: "CoA",
      value: (row: InventoryPositionRowDTO) =>
        row.coaStatus ? COA_STATUS_LABELS[row.coaStatus] : "",
    },
  ],
});

const r02 = defineCsvExport({
  path: "/reports/inventory/expiry/export.csv",
  slug: "r02_vencimentos",
  schema: expiryQuerySchema,
  fetch: async (query: ExpiryQuery) => (await getExpiryReport(query, ALL_ROWS)).rows,
  period,
  columns: [
    { header: "Item", value: (row: ExpiryRowDTO) => csvCode(row.itemCode) },
    { header: "Descrição", value: (row: ExpiryRowDTO) => csvText(row.itemName) },
    { header: "Lote interno", value: (row: ExpiryRowDTO) => csvCode(row.lotCode) },
    { header: "Lote Veridi", value: (row: ExpiryRowDTO) => csvCode(row.businessLotNumber) },
    { header: "Origem", value: (row: ExpiryRowDTO) => (row.lotOrigin === "PRODUCTION" ? "Produção" : "Recebimento") },
    { header: "Validade", value: (row: ExpiryRowDTO) => csvDate(row.expiryDate) },
    { header: "Dias até vencer", value: (row: ExpiryRowDTO) => String(row.daysToExpiry) },
    { header: "On Hand", value: (row: ExpiryRowDTO) => csvDecimal(row.onHand) },
    { header: "Reservado", value: (row: ExpiryRowDTO) => csvDecimal(row.reserved) },
    { header: "Disponível", value: (row: ExpiryRowDTO) => csvDecimal(row.available) },
    { header: "Unidade", value: (row: ExpiryRowDTO) => csvText(row.unitCode) },
    { header: "Qualidade", value: (row: ExpiryRowDTO) => (row.isExpired ? "Vencido" : LOT_STATUS_LABELS[row.status]) },
    { header: "Localização", value: (row: ExpiryRowDTO) => csvText(row.location) },
  ],
});

const r03 = defineCsvExport({
  path: "/reports/inventory/movements/export.csv",
  slug: "r03_movimentacoes",
  schema: movementsQuerySchema,
  fetch: async (query: MovementsQuery) => (await getMovementsReport(query, ALL_ROWS)).rows,
  period,
  columns: [
    { header: "Data/Hora", value: (row: MovementReportRowDTO) => csvDateTime(row.occurredAt) },
    { header: "Tipo", value: (row: MovementReportRowDTO) => INVENTORY_MOVEMENT_TYPE_LABELS[row.type] },
    { header: "Item", value: (row: MovementReportRowDTO) => csvCode(row.itemCode) },
    { header: "Descrição", value: (row: MovementReportRowDTO) => csvText(row.itemName) },
    { header: "Lote", value: (row: MovementReportRowDTO) => csvCode(row.lotCode) },
    { header: "Quantidade", value: (row: MovementReportRowDTO) => csvDecimal(row.quantity) },
    { header: "Unidade", value: (row: MovementReportRowDTO) => csvText(row.unitCode) },
    { header: "Documento", value: (row: MovementReportRowDTO) => csvCode(row.documentCode) },
    { header: "Motivo", value: (row: MovementReportRowDTO) => csvText(row.reason) },
    { header: "Usuário", value: (row: MovementReportRowDTO) => csvText(row.createdBy) },
  ],
});

const r04 = defineCsvExport({
  path: "/reports/production/requirements/export.csv",
  slug: "r04_necessidade_material",
  schema: requirementsQuerySchema,
  fetch: async (query: RequirementsQuery) => (await getRequirementsReport(query, ALL_ROWS)).rows,
  columns: [
    { header: "OP", value: (row: ProductionRequirementRowDTO) => csvCode(row.productionOrderCode) },
    { header: "Produto", value: (row: ProductionRequirementRowDTO) => csvCode(row.productCode) },
    { header: "Nome do produto", value: (row: ProductionRequirementRowDTO) => csvText(row.productName) },
    { header: "Status da OP", value: (row: ProductionRequirementRowDTO) => PRODUCTION_ORDER_STATUS_LABELS[row.productionOrderStatus] },
    { header: "Item", value: (row: ProductionRequirementRowDTO) => csvCode(row.itemCode) },
    { header: "Descrição", value: (row: ProductionRequirementRowDTO) => csvText(row.itemName) },
    {
      header: "Fornecimento",
      value: (row: ProductionRequirementRowDTO) =>
        SUPPLY_RESPONSIBILITY_LABELS[row.supplyResponsibility],
    },
    { header: "Cliente", value: (row: ProductionRequirementRowDTO) => csvText(row.customerName) },
    { header: "Necessário", value: (row: ProductionRequirementRowDTO) => csvDecimal(row.requiredQuantity) },
    { header: "Reservado", value: (row: ProductionRequirementRowDTO) => csvDecimal(row.reserved) },
    { header: "Disponível", value: (row: ProductionRequirementRowDTO) => csvDecimal(row.available) },
    { header: "Em compra", value: (row: ProductionRequirementRowDTO) => csvDecimal(row.onOrder) },
    { header: "Falta", value: (row: ProductionRequirementRowDTO) => csvDecimal(row.shortage) },
    { header: "Unidade", value: (row: ProductionRequirementRowDTO) => csvText(row.unitCode) },
  ],
});

const r05 = defineCsvExport({
  path: "/reports/production/planned-actual/export.csv",
  slug: "r05_planejado_realizado",
  schema: plannedActualQuerySchema,
  fetch: async (query: PlannedActualQuery) => (await getPlannedActualReport(query, ALL_ROWS)).rows,
  period,
  columns: [
    { header: "OP", value: (row: PlannedActualRowDTO) => csvCode(row.productionOrderCode) },
    { header: "Produto", value: (row: PlannedActualRowDTO) => csvCode(row.productCode) },
    { header: "Nome do produto", value: (row: PlannedActualRowDTO) => csvText(row.productName) },
    { header: "Formulação", value: (row: PlannedActualRowDTO) => (row.formulationVersionNumber ? `v${row.formulationVersionNumber}` : "") },
    { header: "Planejado", value: (row: PlannedActualRowDTO) => csvDecimal(row.plannedQuantity) },
    { header: "Produzido", value: (row: PlannedActualRowDTO) => csvDecimal(row.producedQuantity) },
    { header: "Variação", value: (row: PlannedActualRowDTO) => csvDecimal(row.variance) },
    { header: "Rendimento (%)", value: (row: PlannedActualRowDTO) => csvDecimal(row.yieldPercent) },
    { header: "Unidade", value: (row: PlannedActualRowDTO) => csvText(row.unitCode) },
    { header: "Início", value: (row: PlannedActualRowDTO) => csvDate(row.startedAt) },
    { header: "Conclusão", value: (row: PlannedActualRowDTO) => csvDate(row.completedAt) },
    { header: "Status", value: (row: PlannedActualRowDTO) => PRODUCTION_ORDER_STATUS_LABELS[row.status] },
    // Custo PARTIAL/NO_COST fica VAZIO e a qualidade explica — nunca um
    // subtotal apresentado como custo completo.
    { header: "Custo material unitário", value: (row: PlannedActualRowDTO) => csvMoney(row.materialUnitCost) },
    { header: "Qualidade do custo", value: (row: PlannedActualRowDTO) => row.costQuality },
  ],
});

const r07 = defineCsvExport({
  path: "/reports/production/consumption/export.csv",
  slug: "r07_consumo",
  schema: consumptionQuerySchema,
  fetch: async (query: ConsumptionQuery) => (await getConsumptionReport(query, ALL_ROWS)).rows,
  period,
  columns: [
    { header: "Data", value: (row: ConsumptionRowDTO) => csvDate(row.consumedAt) },
    { header: "Item", value: (row: ConsumptionRowDTO) => csvCode(row.itemCode) },
    { header: "Descrição", value: (row: ConsumptionRowDTO) => csvText(row.itemName) },
    { header: "Lote", value: (row: ConsumptionRowDTO) => csvCode(row.lotCode) },
    { header: "Produto", value: (row: ConsumptionRowDTO) => csvCode(row.productCode) },
    { header: "OP", value: (row: ConsumptionRowDTO) => csvCode(row.productionOrderCode) },
    { header: "Quantidade consumida", value: (row: ConsumptionRowDTO) => csvDecimal(row.quantity) },
    { header: "Unidade", value: (row: ConsumptionRowDTO) => csvText(row.unitCode) },
    { header: "Custo unitário", value: (row: ConsumptionRowDTO) => csvMoney(row.unitCost) },
    { header: "Origem do custo", value: (row: ConsumptionRowDTO) => COST_SOURCE_LABELS[row.costSource] },
    { header: "Custo do consumo", value: (row: ConsumptionRowDTO) => csvMoney(row.totalCost) },
  ],
});

const r08 = defineCsvExport({
  path: "/reports/purchasing/orders/export.csv",
  slug: "r08_ordens_de_compra",
  schema: purchaseOrdersQuerySchema,
  fetch: async (query: PurchaseOrdersQuery) => (await getPurchaseOrdersReport(query, ALL_ROWS)).rows,
  period,
  columns: [
    { header: "OC", value: (row: PurchaseOrderReportRowDTO) => csvCode(row.code) },
    { header: "Fornecedor", value: (row: PurchaseOrderReportRowDTO) => csvText(row.supplierName) },
    { header: "Origem", value: (row: PurchaseOrderReportRowDTO) => (row.origin === "CUSTOMER_ORDER" ? "Pedido do cliente" : "Manual") },
    { header: "Pedido relacionado", value: (row: PurchaseOrderReportRowDTO) => csvCode(row.customerOrderCode) },
    { header: "Status", value: (row: PurchaseOrderReportRowDTO) => PURCHASE_ORDER_STATUS_LABELS[row.status] },
    { header: "Data", value: (row: PurchaseOrderReportRowDTO) => csvDate(row.orderDate) },
    { header: "Previsão", value: (row: PurchaseOrderReportRowDTO) => csvDate(row.expectedDeliveryDate) },
    { header: "Itens", value: (row: PurchaseOrderReportRowDTO) => String(row.itemCount) },
    { header: "Valor previsto", value: (row: PurchaseOrderReportRowDTO) => csvMoney(row.expectedAmount) },
    { header: "Linhas com preço", value: (row: PurchaseOrderReportRowDTO) => `${row.linesWithPrice}/${row.itemCount}` },
    { header: "Recebimentos", value: (row: PurchaseOrderReportRowDTO) => String(row.receiptCount) },
  ],
});

const r09 = defineCsvExport({
  path: "/reports/purchasing/receipts/export.csv",
  slug: "r09_recebimentos",
  schema: receiptsQuerySchema,
  fetch: async (query: ReceiptsQuery) => (await getReceiptsReport(query, ALL_ROWS)).rows,
  period,
  columns: [
    { header: "Recebimento", value: (row: ReceiptReportRowDTO) => csvCode(row.receiptCode) },
    { header: "Data", value: (row: ReceiptReportRowDTO) => csvDate(row.receivedAt) },
    { header: "OC", value: (row: ReceiptReportRowDTO) => csvCode(row.purchaseOrderCode) },
    { header: "Fornecedor", value: (row: ReceiptReportRowDTO) => csvText(row.supplierName) },
    { header: "Item", value: (row: ReceiptReportRowDTO) => csvCode(row.itemCode) },
    { header: "Descrição", value: (row: ReceiptReportRowDTO) => csvText(row.itemName) },
    { header: "Lote interno", value: (row: ReceiptReportRowDTO) => csvCode(row.lotCode) },
    { header: "Lote do fornecedor", value: (row: ReceiptReportRowDTO) => csvCode(row.supplierLot) },
    { header: "Quantidade", value: (row: ReceiptReportRowDTO) => csvDecimal(row.receivedQuantity) },
    { header: "Unidade", value: (row: ReceiptReportRowDTO) => csvText(row.unitCode) },
    {
      header: "CoA",
      value: (row: ReceiptReportRowDTO) =>
        row.coaStatus ? COA_STATUS_LABELS[row.coaStatus] : "Não exigido",
    },
    { header: "Preço previsto (OC)", value: (row: ReceiptReportRowDTO) => csvMoney(row.orderedUnitPrice) },
    { header: "Custo efetivo", value: (row: ReceiptReportRowDTO) => csvMoney(row.actualUnitCost) },
    { header: "Qualidade do custo", value: (row: ReceiptReportRowDTO) => row.costQuality },
  ],
});

const onOrderColumns = [
  { header: "OC", value: (row: OnOrderRowDTO) => csvCode(row.purchaseOrderCode) },
  { header: "Fornecedor", value: (row: OnOrderRowDTO) => csvText(row.supplierName) },
  { header: "Item", value: (row: OnOrderRowDTO) => csvCode(row.itemCode) },
  { header: "Descrição", value: (row: OnOrderRowDTO) => csvText(row.itemName) },
  { header: "Pedido", value: (row: OnOrderRowDTO) => csvDecimal(row.orderedQuantity) },
  { header: "Recebido", value: (row: OnOrderRowDTO) => csvDecimal(row.receivedQuantity) },
  { header: "Em aberto", value: (row: OnOrderRowDTO) => csvDecimal(row.openQuantity) },
  { header: "Unidade", value: (row: OnOrderRowDTO) => csvText(row.unitCode) },
  { header: "Previsão", value: (row: OnOrderRowDTO) => csvDate(row.expectedDeliveryDate) },
  { header: "Status", value: (row: OnOrderRowDTO) => PURCHASE_ORDER_STATUS_LABELS[row.status] },
  { header: "Pedido do cliente", value: (row: OnOrderRowDTO) => csvCode(row.customerOrderCode) },
];

const r10 = defineCsvExport({
  path: "/reports/purchasing/on-order/export.csv",
  slug: "r10_em_compra",
  schema: onOrderQuerySchema,
  fetch: async (query: OnOrderQuery) => (await getOnOrderReport(query, ALL_ROWS)).rows,
  columns: onOrderColumns,
});

const r11 = defineCsvExport({
  path: "/reports/purchasing/late/export.csv",
  slug: "r11_ocs_atrasadas",
  schema: onOrderQuerySchema,
  fetch: async (query: OnOrderQuery) => (await getLatePurchaseOrdersReport(query, ALL_ROWS)).rows,
  columns: [
    ...onOrderColumns,
    { header: "Dias de atraso", value: (row: LatePurchaseOrderRowDTO) => String(row.daysLate) },
  ],
});

const r12 = defineCsvExport({
  path: "/reports/commercial/orders/export.csv",
  slug: "r12_pedidos",
  schema: customerOrdersQuerySchema,
  fetch: async (query: CustomerOrdersQuery) => (await getCustomerOrdersReport(query, ALL_ROWS)).rows,
  period,
  columns: [
    { header: "Pedido", value: (row: CustomerOrderReportRowDTO) => csvCode(row.code) },
    { header: "Cliente", value: (row: CustomerOrderReportRowDTO) => csvText(row.customerName) },
    { header: "Data", value: (row: CustomerOrderReportRowDTO) => csvDate(row.orderDate) },
    { header: "Entrega solicitada", value: (row: CustomerOrderReportRowDTO) => csvDate(row.requestedDeliveryDate) },
    { header: "Status", value: (row: CustomerOrderReportRowDTO) => CUSTOMER_ORDER_STATUS_LABELS[row.status] },
    { header: "Faturamento", value: (row: CustomerOrderReportRowDTO) => CUSTOMER_ORDER_BILLING_STATUS_LABELS[row.billingStatus] },
    { header: "Linhas", value: (row: CustomerOrderReportRowDTO) => String(row.lineCount) },
    { header: "Produtos", value: (row: CustomerOrderReportRowDTO) => csvText(row.productCodes.join(", ")) },
    { header: "Expedições", value: (row: CustomerOrderReportRowDTO) => String(row.shipmentCount) },
    { header: "Faturamentos", value: (row: CustomerOrderReportRowDTO) => String(row.billingCount) },
  ],
});

const r13 = defineCsvExport({
  path: "/reports/commercial/fulfillment/export.csv",
  slug: "r13_atendimento_pedidos",
  schema: fulfillmentQuerySchema,
  fetch: async (query: FulfillmentQuery) => (await getFulfillmentReport(query, ALL_ROWS)).rows,
  period,
  columns: [
    { header: "Pedido", value: (row: FulfillmentRowDTO) => csvCode(row.customerOrderCode) },
    { header: "Cliente", value: (row: FulfillmentRowDTO) => csvText(row.customerName) },
    { header: "Produto", value: (row: FulfillmentRowDTO) => csvCode(row.productCode) },
    { header: "Nome do produto", value: (row: FulfillmentRowDTO) => csvText(row.productName) },
    { header: "Pedido (qtd)", value: (row: FulfillmentRowDTO) => csvDecimal(row.orderedQuantity) },
    { header: "Reservado", value: (row: FulfillmentRowDTO) => csvDecimal(row.reservedRemaining) },
    { header: "Produzido", value: (row: FulfillmentRowDTO) => csvDecimal(row.producedQuantity) },
    { header: "OPs", value: (row: FulfillmentRowDTO) => String(row.productionOrderCount) },
    { header: "Expedido", value: (row: FulfillmentRowDTO) => csvDecimal(row.shippedQuantity) },
    { header: "Faturado", value: (row: FulfillmentRowDTO) => csvDecimal(row.billedQuantity) },
    { header: "Falta expedir", value: (row: FulfillmentRowDTO) => csvDecimal(row.outstandingQuantity) },
    { header: "Unidade", value: (row: FulfillmentRowDTO) => csvText(row.unitCode) },
    { header: "Status", value: (row: FulfillmentRowDTO) => CUSTOMER_ORDER_STATUS_LABELS[row.status] },
    { header: "Faturamento", value: (row: FulfillmentRowDTO) => CUSTOMER_ORDER_BILLING_STATUS_LABELS[row.billingStatus] },
  ],
});

const r15 = defineCsvExport({
  path: "/reports/billing/period/export.csv",
  slug: "r15_faturamento_periodo",
  schema: billingPeriodQuerySchema,
  fetch: async (query: BillingPeriodQuery) => (await getBillingPeriodReport(query, ALL_ROWS)).rows,
  period,
  columns: [
    { header: "Faturamento", value: (row: BillingPeriodRowDTO) => csvCode(row.code) },
    { header: "Data de emissão", value: (row: BillingPeriodRowDTO) => csvDate(row.issuedAt) },
    { header: "Pedido", value: (row: BillingPeriodRowDTO) => csvCode(row.customerOrderCode) },
    { header: "Expedição", value: (row: BillingPeriodRowDTO) => csvCode(row.shipmentCode) },
    { header: "Cliente", value: (row: BillingPeriodRowDTO) => csvText(row.customerName) },
    { header: "Linhas", value: (row: BillingPeriodRowDTO) => String(row.lineCount) },
    // Documento sem preço completo fica com valor VAZIO.
    { header: "Valor", value: (row: BillingPeriodRowDTO) => csvMoney(row.totalAmount) },
    { header: "Precificação", value: (row: BillingPeriodRowDTO) => (row.hasCompletePricing ? "Completa" : "Incompleta") },
    { header: "Referência externa", value: (row: BillingPeriodRowDTO) => csvText(row.externalReference) },
  ],
});

const r16 = defineCsvExport({
  path: "/reports/billing/awaiting/export.csv",
  slug: "r16_aguardando_faturamento",
  schema: awaitingBillingQuerySchema,
  fetch: async (query: AwaitingBillingQuery) => (await getAwaitingBillingReport(query, ALL_ROWS)).rows,
  columns: [
    { header: "Expedição", value: (row: AwaitingBillingReportRowDTO) => csvCode(row.shipmentCode) },
    { header: "Confirmada em", value: (row: AwaitingBillingReportRowDTO) => csvDate(row.confirmedAt) },
    { header: "Pedido", value: (row: AwaitingBillingReportRowDTO) => csvCode(row.customerOrderCode) },
    { header: "Cliente", value: (row: AwaitingBillingReportRowDTO) => csvText(row.customerName) },
    { header: "Produtos", value: (row: AwaitingBillingReportRowDTO) => csvText(row.productCodes.join(", ")) },
    { header: "Situação", value: (row: AwaitingBillingReportRowDTO) => (row.situation === "DRAFT" ? "Em preparação" : "Pendente") },
    { header: "Faturamento em preparação", value: (row: AwaitingBillingReportRowDTO) => csvCode(row.billingCode) },
    { header: "Dias aguardando", value: (row: AwaitingBillingReportRowDTO) => String(row.daysWaiting) },
  ],
});

const r17 = defineCsvExport({
  path: "/reports/billing/order-delivered-billed/export.csv",
  slug: "r17_pedido_entregue_faturado",
  schema: fulfillmentQuerySchema,
  fetch: async (query: FulfillmentQuery) => (await getOrderDeliveredBilledReport(query, ALL_ROWS)).rows,
  period,
  columns: [
    { header: "Pedido", value: (row: OrderDeliveredBilledRowDTO) => csvCode(row.customerOrderCode) },
    { header: "Cliente", value: (row: OrderDeliveredBilledRowDTO) => csvText(row.customerName) },
    { header: "Produto", value: (row: OrderDeliveredBilledRowDTO) => csvCode(row.productCode) },
    { header: "Nome do produto", value: (row: OrderDeliveredBilledRowDTO) => csvText(row.productName) },
    { header: "Pedido (qtd)", value: (row: OrderDeliveredBilledRowDTO) => csvDecimal(row.orderedQuantity) },
    { header: "Expedido", value: (row: OrderDeliveredBilledRowDTO) => csvDecimal(row.shippedQuantity) },
    { header: "Faturado", value: (row: OrderDeliveredBilledRowDTO) => csvDecimal(row.billedQuantity) },
    { header: "Expedido sem faturar", value: (row: OrderDeliveredBilledRowDTO) => csvDecimal(row.unbilledShippedQuantity) },
    { header: "Falta entregar", value: (row: OrderDeliveredBilledRowDTO) => csvDecimal(row.outstandingDeliveryQuantity) },
    { header: "Unidade", value: (row: OrderDeliveredBilledRowDTO) => csvText(row.unitCode) },
    { header: "Status", value: (row: OrderDeliveredBilledRowDTO) => CUSTOMER_ORDER_STATUS_LABELS[row.status] },
    { header: "Faturamento", value: (row: OrderDeliveredBilledRowDTO) => CUSTOMER_ORDER_BILLING_STATUS_LABELS[row.billingStatus] },
  ],
});

const r18 = defineCsvExport({
  path: "/reports/costs/industrial-by-product/export.csv",
  slug: "r18_custo_industrial_por_produto",
  schema: industrialCostByProductQuerySchema,
  fetch: async (query: IndustrialCostByProductQuery) =>
    (await getIndustrialCostByProductReport(query, ALL_ROWS)).rows,
  columns: [
    { header: "Produto", value: (row: IndustrialCostByProductRowDTO) => csvCode(row.productCode) },
    { header: "Nome", value: (row: IndustrialCostByProductRowDTO) => csvText(row.productName) },
    { header: "Cliente", value: (row: IndustrialCostByProductRowDTO) => csvText(row.customerName) },
    {
      header: "Estrutura ativa",
      value: (row: IndustrialCostByProductRowDTO) => csvText(row.activeCostVersionLabel),
    },
    {
      header: "Último cálculo",
      value: (row: IndustrialCostByProductRowDTO) => csvCode(row.calculationCode),
    },
    {
      header: "Data de referência",
      value: (row: IndustrialCostByProductRowDTO) => csvDate(row.costReferenceDate),
    },
    {
      header: "Calculado em",
      value: (row: IndustrialCostByProductRowDTO) => csvDateTime(row.calculatedAt),
    },
    {
      header: "Qualidade",
      value: (row: IndustrialCostByProductRowDTO) =>
        row.quality ? INDUSTRIAL_COST_QUALITY_LABELS[row.quality] : "",
    },
    // Parcial deixa o total vazio: subtotal conhecido vai na coluna própria.
    {
      header: "Custo industrial total",
      value: (row: IndustrialCostByProductRowDTO) => csvMoney(row.totalIndustrialCost),
    },
    {
      header: "Subtotal conhecido",
      value: (row: IndustrialCostByProductRowDTO) => csvMoney(row.knownSubtotal),
    },
    {
      header: "Custo/unidade",
      value: (row: IndustrialCostByProductRowDTO) => csvDecimal(row.costPerUnit),
    },
    {
      header: "Custo/1.000",
      value: (row: IndustrialCostByProductRowDTO) => csvMoney(row.costPer1000),
    },
  ],
});

const r19 = defineCsvExport({
  path: "/reports/costs/pricing-by-product/export.csv",
  slug: "r19_precificacao_por_produto",
  schema: pricingByProductQuerySchema,
  fetch: async (query: PricingByProductQuery) =>
    (await getPricingByProductReport(query, ALL_ROWS)).rows,
  columns: [
    { header: "Produto", value: (row: PricingByProductRowDTO) => csvCode(row.productCode) },
    { header: "Nome", value: (row: PricingByProductRowDTO) => csvText(row.productName) },
    { header: "Cliente", value: (row: PricingByProductRowDTO) => csvText(row.customerName) },
    { header: "Precificação", value: (row: PricingByProductRowDTO) => csvCode(row.pricingLabel) },
    { header: "Quantidade", value: (row: PricingByProductRowDTO) => csvDecimal(row.quantity) },
    { header: "Unidade", value: (row: PricingByProductRowDTO) => csvText(row.uomCode) },
    { header: "Modo de preço", value: (row: PricingByProductRowDTO) => PRICE_MODE_LABELS[row.priceMode] },
    { header: "Cálculo de custo", value: (row: PricingByProductRowDTO) => csvCode(row.calculationCode) },
    { header: "Data do custo", value: (row: PricingByProductRowDTO) => csvDate(row.costReferenceDate) },
    {
      header: "Qualidade do custo",
      value: (row: PricingByProductRowDTO) => INDUSTRIAL_COST_QUALITY_LABELS[row.costQuality],
    },
    { header: "Custo/unidade", value: (row: PricingByProductRowDTO) => csvDecimal(row.costPerUnit) },
    { header: "Comissão (%)", value: (row: PricingByProductRowDTO) => csvDecimal(row.commissionPercent) },
    { header: "Preço", value: (row: PricingByProductRowDTO) => csvDecimal(row.unitPrice) },
    {
      header: "Margem de contribuição (%)",
      value: (row: PricingByProductRowDTO) => csvDecimal(row.contributionMarginPercent),
    },
    { header: "Markup (%)", value: (row: PricingByProductRowDTO) => csvDecimal(row.markupPercent) },
    {
      header: "Contribuição/unidade",
      value: (row: PricingByProductRowDTO) => csvDecimal(row.contributionPerUnit),
    },
    { header: "Ativada em", value: (row: PricingByProductRowDTO) => csvDateTime(row.activatedAt) },
  ],
});

const r20 = defineCsvExport({
  path: "/reports/commercial/quote-pricing/export.csv",
  slug: "r20_orcamento_precificacao",
  schema: quotePricingAuditQuerySchema,
  fetch: async (query: QuotePricingAuditQuery) =>
    (await getQuotePricingAuditReport(query, ALL_ROWS)).rows,
  columns: [
    { header: "Orçamento", value: (row: QuotePricingAuditRowDTO) => csvCode(row.quoteLabel) },
    { header: "Projeto", value: (row: QuotePricingAuditRowDTO) => csvCode(row.projectCode) },
    { header: "Nome do projeto", value: (row: QuotePricingAuditRowDTO) => csvText(row.projectName) },
    { header: "Cliente", value: (row: QuotePricingAuditRowDTO) => csvText(row.customerName) },
    { header: "Produto", value: (row: QuotePricingAuditRowDTO) => csvCode(row.productCode) },
    { header: "Status", value: (row: QuotePricingAuditRowDTO) => QUOTE_STATUS_LABELS[row.status] },
    { header: "Quantidade", value: (row: QuotePricingAuditRowDTO) => csvDecimal(row.quotedQuantity) },
    { header: "Unidade", value: (row: QuotePricingAuditRowDTO) => csvText(row.uomCode) },
    { header: "Preço unitário", value: (row: QuotePricingAuditRowDTO) => csvMoney(row.unitPrice) },
    { header: "Total", value: (row: QuotePricingAuditRowDTO) => csvMoney(row.total) },
    {
      header: "Origem do preço",
      value: (row: QuotePricingAuditRowDTO) => QUOTE_PRICE_SOURCE_LABELS[row.priceSource],
    },
    { header: "Precificação", value: (row: QuotePricingAuditRowDTO) => csvCode(row.pricingLabel) },
    { header: "Faixa", value: (row: QuotePricingAuditRowDTO) => csvDecimal(row.tierQuantity) },
    { header: "Cálculo", value: (row: QuotePricingAuditRowDTO) => csvCode(row.calculationCode) },
    {
      header: "Qualidade do custo",
      value: (row: QuotePricingAuditRowDTO) =>
        row.costQuality ? INDUSTRIAL_COST_QUALITY_LABELS[row.costQuality] : "",
    },
    {
      header: "Custo industrial/un",
      value: (row: QuotePricingAuditRowDTO) => csvDecimal(row.industrialCostPerUnit),
    },
    {
      header: "Margem de contribuição (%)",
      value: (row: QuotePricingAuditRowDTO) => csvDecimal(row.contributionMarginPercent),
    },
    { header: "Enviado em", value: (row: QuotePricingAuditRowDTO) => csvDateTime(row.sentAt) },
    { header: "Aceito em", value: (row: QuotePricingAuditRowDTO) => csvDateTime(row.acceptedAt) },
  ],
});

export const reportCsvExports: CsvExportRoute[] = [
  r01,
  r02,
  r03,
  r04,
  r05,
  r07,
  r08,
  r09,
  r10,
  r11,
  r12,
  r13,
  r15,
  r16,
  r17,
  r18,
  r19,
  r20,
];
