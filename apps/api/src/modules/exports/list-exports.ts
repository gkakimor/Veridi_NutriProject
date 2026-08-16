import type {
  BillingDTO,
  CustomerDTO,
  CustomerMaterialRowDTO,
  CustomerOrderDTO,
  FinishedGoodRowDTO,
  FormulationSummaryDTO,
  InventoryItemSummaryDTO,
  InventoryMovementDTO,
  ItemDTO,
  LotDTO,
  ProductDTO,
  ProjectDTO,
  ProjectSampleDTO,
  ProductionOrderDTO,
  PurchaseOrderDTO,
  ReceiptDTO,
  ReceiptLineDTO,
  ShipmentDTO,
  SupplierDTO,
} from "@veridi/shared";
import {
  BILLING_STATUS_LABELS,
  DOSAGE_FORM_LABELS,
  ITEM_FAMILY_LABELS,
  PACKAGING_SUBTYPE_LABELS,
  PRESENTATION_TYPE_LABELS,
  TARGET_AGE_GROUP_LABELS,
  formatZipCode,
  CUSTOMER_ORDER_STATUS_LABELS,
  INVENTORY_MOVEMENT_TYPE_LABELS,
  ITEM_TYPE_LABELS,
  COA_STATUS_LABELS,
  PROJECT_CANCEL_REASON_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_SAMPLE_STATUS_LABELS,
  LOT_STATUS_LABELS,
  PRODUCTION_ORDER_STATUS_LABELS,
  PURCHASE_ORDER_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
} from "@veridi/shared";
import { csvBoolean, csvCode, csvDate, csvDateTime, csvDecimal, csvMoney, csvText } from "../../lib/csv.js";
import { ALL_ROWS } from "../../lib/pagination.js";
import { listCustomers } from "../customers/customers.service.js";
import { listSuppliers } from "../suppliers/suppliers.service.js";
import { listItems } from "../items/items.service.js";
import { listProducts } from "../products/products.service.js";
import { listProjects } from "../projects/projects.service.js";
import { listSamples } from "../samples/samples.service.js";
import { listPurchaseOrders } from "../purchase-orders/purchase-orders.service.js";
import { listReceipts } from "../receiving/receiving.service.js";
import { listInventory, listInventoryMovements } from "../inventory/inventory.service.js";
import { listCustomerMaterials } from "../inventory/customer-materials.service.js";
import { listLots } from "../lots/lots.service.js";
import { listFormulations } from "../formulations/formulations.service.js";
import { listProductionOrders } from "../production-orders/production-orders.service.js";
import { listFinishedGoods } from "../finished-goods/finished-goods.service.js";
import { listCustomerOrders } from "../customer-orders/customer-orders.service.js";
import { listShipments } from "../shipments/shipments.service.js";
import { listBillings } from "../billings/billings.service.js";
import { listCustomersQuerySchema } from "../customers/customers.schemas.js";
import { listSuppliersQuerySchema } from "../suppliers/suppliers.schemas.js";
import { listItemsQuerySchema } from "../items/items.schemas.js";
import { listProductsQuerySchema } from "../products/products.schemas.js";
import { listProjectsQuerySchema } from "../projects/projects.schemas.js";
import { listSamplesQuerySchema } from "../samples/samples.schemas.js";
import { listPurchaseOrdersQuerySchema } from "../purchase-orders/purchase-orders.schemas.js";
import { listReceiptsQuerySchema } from "../receiving/receiving.schemas.js";
import {
  listCustomerMaterialsQuerySchema,
  listInventoryQuerySchema,
  listInventoryMovementsQuerySchema,
} from "../inventory/inventory.schemas.js";
import { listLotsQuerySchema } from "../lots/lots.schemas.js";
import { listFormulationsQuerySchema } from "../formulations/formulations.schemas.js";
import { listProductionOrdersQuerySchema } from "../production-orders/production-orders.schemas.js";
import { listFinishedGoodsQuerySchema } from "../finished-goods/finished-goods.schemas.js";
import { listCustomerOrdersQuerySchema } from "../customer-orders/customer-orders.schemas.js";
import { listShipmentsQuerySchema } from "../shipments/shipments.schemas.js";
import { listBillingsQuerySchema } from "../billings/billings.schemas.js";
import type { ListCustomersQuery } from "../customers/customers.schemas.js";
import type { ListSuppliersQuery } from "../suppliers/suppliers.schemas.js";
import type { ListItemsQuery } from "../items/items.schemas.js";
import type { ListProductsQuery } from "../products/products.schemas.js";
import type { ListProjectsQuery } from "../projects/projects.schemas.js";
import type { ListSamplesQuery } from "../samples/samples.schemas.js";
import type { ListPurchaseOrdersQuery } from "../purchase-orders/purchase-orders.schemas.js";
import type { ListReceiptsQuery } from "../receiving/receiving.schemas.js";
import type {
  ListCustomerMaterialsQuery,
  ListInventoryQuery,
  ListInventoryMovementsQuery,
} from "../inventory/inventory.schemas.js";
import type { ListLotsQuery } from "../lots/lots.schemas.js";
import type { ListFormulationsQuery } from "../formulations/formulations.schemas.js";
import type { ListProductionOrdersQuery } from "../production-orders/production-orders.schemas.js";
import type { ListFinishedGoodsQuery } from "../finished-goods/finished-goods.schemas.js";
import type { ListCustomerOrdersQuery } from "../customer-orders/customer-orders.schemas.js";
import type { ListShipmentsQuery } from "../shipments/shipments.schemas.js";
import type { ListBillingsQuery } from "../billings/billings.schemas.js";
import type { CsvExportRoute } from "./csv-export.js";
import { defineCsvExport } from "./csv-export.js";

/**
 * Exportações CSV das listagens.
 *
 * Cada uma usa o MESMO schema de filtros e o MESMO serviço da tela, pedindo
 * `ALL_ROWS`: o CSV traz o resultado filtrado inteiro, independente da
 * página aberta na interface. Nunca há uma segunda interpretação do filtro.
 */

const customersExport = defineCsvExport({
  path: "/customers/export.csv",
  slug: "clientes",
  schema: listCustomersQuerySchema,
  fetch: async (query: ListCustomersQuery) => (await listCustomers(query, ALL_ROWS)).customers,
  columns: [
    { header: "Código", value: (row: CustomerDTO) => csvCode(row.code) },
    { header: "Razão social", value: (row: CustomerDTO) => csvText(row.legalName) },
    { header: "Nome fantasia", value: (row: CustomerDTO) => csvText(row.tradeName) },
    { header: "CNPJ", value: (row: CustomerDTO) => csvCode(row.cnpj) },
    { header: "E-mail", value: (row: CustomerDTO) => csvText(row.email) },
    { header: "Telefone", value: (row: CustomerDTO) => csvCode(row.phone) },
    // CEP exportado formatado; o valor guardado continua só com dígitos.
    { header: "CEP", value: (row: CustomerDTO) => csvCode(formatZipCode(row.zipCode)) },
    { header: "Logradouro", value: (row: CustomerDTO) => csvText(row.street) },
    { header: "Número", value: (row: CustomerDTO) => csvCode(row.number) },
    { header: "Complemento", value: (row: CustomerDTO) => csvText(row.complement) },
    { header: "Bairro", value: (row: CustomerDTO) => csvText(row.district) },
    { header: "Cidade", value: (row: CustomerDTO) => csvText(row.city) },
    { header: "UF", value: (row: CustomerDTO) => csvText(row.state) },
    { header: "Ativo", value: (row: CustomerDTO) => csvBoolean(row.active) },
  ],
});

const suppliersExport = defineCsvExport({
  path: "/suppliers/export.csv",
  slug: "fornecedores",
  schema: listSuppliersQuerySchema,
  fetch: async (query: ListSuppliersQuery) => (await listSuppliers(query, ALL_ROWS)).suppliers,
  columns: [
    { header: "Código", value: (row: SupplierDTO) => csvCode(row.code) },
    { header: "Razão social", value: (row: SupplierDTO) => csvText(row.legalName) },
    { header: "Nome fantasia", value: (row: SupplierDTO) => csvText(row.tradeName) },
    { header: "CNPJ", value: (row: SupplierDTO) => csvCode(row.cnpj) },
    { header: "E-mail", value: (row: SupplierDTO) => csvText(row.email) },
    { header: "Telefone", value: (row: SupplierDTO) => csvCode(row.phone) },
    { header: "Ativo", value: (row: SupplierDTO) => csvBoolean(row.active) },
  ],
});

const itemsExport = defineCsvExport({
  path: "/items/export.csv",
  slug: "itens",
  schema: listItemsQuerySchema,
  fetch: async (query: ListItemsQuery) => (await listItems(query, ALL_ROWS)).items,
  columns: [
    { header: "Código", value: (row: ItemDTO) => csvCode(row.code) },
    { header: "Nome", value: (row: ItemDTO) => csvText(row.name) },
    { header: "Tipo", value: (row: ItemDTO) => ITEM_TYPE_LABELS[row.type] },
    { header: "Unidade", value: (row: ItemDTO) => csvText(row.unitCode) },
    // Rótulos amigáveis, nunca o enum cru.
    { header: "Família", value: (row: ItemDTO) => (row.family ? ITEM_FAMILY_LABELS[row.family] : "") },
    { header: "Fonte", value: (row: ItemDTO) => csvText(row.sourceName) },
    { header: "Nutriente declarado", value: (row: ItemDTO) => csvText(row.declaredNutrient) },
    // Pureza desconhecida fica VAZIA — nunca 100.
    { header: "Pureza padrão (%)", value: (row: ItemDTO) => csvDecimal(row.defaultPurityPercent) },
    {
      header: "Subtipo de embalagem",
      value: (row: ItemDTO) => (row.packagingSubtype ? PACKAGING_SUBTYPE_LABELS[row.packagingSubtype] : ""),
    },
    { header: "Controla lote", value: (row: ItemDTO) => csvBoolean(row.controlsLot) },
    { header: "Controla validade", value: (row: ItemDTO) => csvBoolean(row.controlsExpiry) },
    { header: "Exige liberação da Qualidade", value: (row: ItemDTO) => csvBoolean(row.requiresQualityRelease) },
    { header: "Exige CoA", value: (row: ItemDTO) => csvBoolean(row.requiresCoa) },
    { header: "Código de barras", value: (row: ItemDTO) => csvCode(row.externalBarcode) },
    { header: "Ativo", value: (row: ItemDTO) => csvBoolean(row.active) },
  ],
});

const productsExport = defineCsvExport({
  path: "/products/export.csv",
  slug: "produtos",
  schema: listProductsQuerySchema,
  fetch: async (query: ListProductsQuery) => (await listProducts(query, ALL_ROWS)).products,
  columns: [
    { header: "Código", value: (row: ProductDTO) => csvCode(row.code) },
    { header: "Nome", value: (row: ProductDTO) => csvText(row.name) },
    { header: "Cliente", value: (row: ProductDTO) => csvText(row.customer ? row.customer.legalName : null) },
    { header: "Item de produto acabado", value: (row: ProductDTO) => csvCode(row.finishedProductItem ? row.finishedProductItem.code : null) },
    {
      header: "Forma farmacêutica",
      value: (row: ProductDTO) => (row.dosageForm ? DOSAGE_FORM_LABELS[row.dosageForm] : ""),
    },
    {
      header: "Apresentação",
      value: (row: ProductDTO) =>
        row.presentationType ? PRESENTATION_TYPE_LABELS[row.presentationType] : "",
    },
    { header: "Cápsulas por dose", value: (row: ProductDTO) => csvDecimal(row.capsulesPerDose) },
    { header: "Dose", value: (row: ProductDTO) => csvDecimal(row.doseAmount) },
    { header: "Unidade da dose", value: (row: ProductDTO) => csvText(row.doseUomCode) },
    { header: "Doses por embalagem", value: (row: ProductDTO) => csvDecimal(row.dosesPerPackage) },
    { header: "Unidades por caixa", value: (row: ProductDTO) => csvDecimal(row.unitsPerShippingBox) },
    {
      header: "Público-alvo",
      value: (row: ProductDTO) => (row.targetAgeGroup ? TARGET_AGE_GROUP_LABELS[row.targetAgeGroup] : ""),
    },
    { header: "Vida útil (meses)", value: (row: ProductDTO) => csvDecimal(row.shelfLifeMonths) },
    { header: "Lote mínimo", value: (row: ProductDTO) => csvDecimal(row.minimumBatchQuantity) },
    { header: "Formulação ativa", value: (row: ProductDTO) => csvText(row.activeFormulationVersionLabel) },
    { header: "Código externo", value: (row: ProductDTO) => csvCode(row.externalCode) },
    { header: "Ativo", value: (row: ProductDTO) => csvBoolean(row.active) },
  ],
});

const purchaseOrdersExport = defineCsvExport({
  path: "/purchase-orders/export.csv",
  slug: "ordens_de_compra",
  schema: listPurchaseOrdersQuerySchema,
  fetch: async (query: ListPurchaseOrdersQuery) => (await listPurchaseOrders(query, ALL_ROWS)).purchaseOrders,
  columns: [
    { header: "OC", value: (row: PurchaseOrderDTO) => csvCode(row.code) },
    { header: "Fornecedor", value: (row: PurchaseOrderDTO) => csvText(row.supplierName) },
    { header: "CNPJ do fornecedor", value: (row: PurchaseOrderDTO) => csvCode(row.supplierCnpj) },
    { header: "Status", value: (row: PurchaseOrderDTO) => PURCHASE_ORDER_STATUS_LABELS[row.status] },
    { header: "Origem", value: (row: PurchaseOrderDTO) => (row.origin === "CUSTOMER_ORDER" ? "Pedido do cliente" : "Manual") },
    { header: "Pedido relacionado", value: (row: PurchaseOrderDTO) => csvCode(row.customerOrderCode) },
    { header: "Data do pedido", value: (row: PurchaseOrderDTO) => csvDate(row.orderDate) },
    { header: "Previsão de entrega", value: (row: PurchaseOrderDTO) => csvDate(row.expectedDeliveryDate) },
    { header: "Itens", value: (row: PurchaseOrderDTO) => String(row.lines.length) },
    // Valor previsto só existe com preço em todas as linhas — vazio nunca vira 0.
    { header: "Valor previsto", value: (row: PurchaseOrderDTO) => csvMoney(row.orderTotal) },
  ],
});

/** Recebimentos exportam por LINHA: é a granularidade útil (item + lote). */
interface ReceiptLineRow {
  receipt: ReceiptDTO;
  line: ReceiptLineDTO;
}

const receiptsExport = defineCsvExport({
  path: "/receipts/export.csv",
  slug: "recebimentos",
  schema: listReceiptsQuerySchema,
  fetch: async (query: ListReceiptsQuery) => {
    const result = await listReceipts(query, ALL_ROWS);
    return result.receipts.flatMap((receipt) => receipt.lines.map((line) => ({ receipt, line })));
  },
  columns: [
    { header: "Recebimento", value: (row: ReceiptLineRow) => csvCode(row.receipt.code) },
    { header: "Data", value: (row: ReceiptLineRow) => csvDate(row.receipt.receivedAt) },
    { header: "OC", value: (row: ReceiptLineRow) => csvCode(row.receipt.purchaseOrderCode) },
    { header: "Fornecedor", value: (row: ReceiptLineRow) => csvText(row.receipt.supplierName) },
    { header: "Nota fiscal", value: (row: ReceiptLineRow) => csvCode(row.receipt.invoiceNumber) },
    { header: "Item", value: (row: ReceiptLineRow) => csvCode(row.line.itemCode) },
    { header: "Descrição", value: (row: ReceiptLineRow) => csvText(row.line.itemName) },
    { header: "Quantidade recebida", value: (row: ReceiptLineRow) => csvDecimal(row.line.receivedQuantity) },
    { header: "Unidade", value: (row: ReceiptLineRow) => csvText(row.line.unitCode) },
    { header: "Lote interno", value: (row: ReceiptLineRow) => csvCode(row.line.lotCode) },
    { header: "Lote do fornecedor", value: (row: ReceiptLineRow) => csvCode(row.line.supplierLot) },
    { header: "Validade", value: (row: ReceiptLineRow) => csvDate(row.line.expiryDate) },
    { header: "Localização", value: (row: ReceiptLineRow) => csvText(row.line.location) },
    { header: "Preço previsto (OC)", value: (row: ReceiptLineRow) => csvMoney(row.line.purchaseUnitPrice) },
    { header: "Custo efetivo", value: (row: ReceiptLineRow) => csvMoney(row.line.actualUnitCost) },
    // Custo sempre acompanhado da sua origem/qualidade.
    { header: "Origem do custo", value: (row: ReceiptLineRow) => (row.line.actualUnitCost ? "REAL" : "NO_COST") },
  ],
});

const inventoryExport = defineCsvExport({
  path: "/inventory/export.csv",
  slug: "estoque",
  schema: listInventoryQuerySchema,
  fetch: async (query: ListInventoryQuery) => (await listInventory(query, ALL_ROWS)).items,
  columns: [
    { header: "Item", value: (row: InventoryItemSummaryDTO) => csvCode(row.itemCode) },
    { header: "Descrição", value: (row: InventoryItemSummaryDTO) => csvText(row.itemName) },
    { header: "Tipo", value: (row: InventoryItemSummaryDTO) => ITEM_TYPE_LABELS[row.itemType] },
    { header: "Unidade", value: (row: InventoryItemSummaryDTO) => csvText(row.unitCode) },
    { header: "On Hand", value: (row: InventoryItemSummaryDTO) => csvDecimal(row.onHand) },
    { header: "Reservado", value: (row: InventoryItemSummaryDTO) => csvDecimal(row.reserved) },
    { header: "Disponível", value: (row: InventoryItemSummaryDTO) => csvDecimal(row.available) },
    { header: "Em compra", value: (row: InventoryItemSummaryDTO) => csvDecimal(row.onOrder) },
  ],
});

const lotsExport = defineCsvExport({
  path: "/lots/export.csv",
  slug: "lotes",
  schema: listLotsQuerySchema,
  fetch: async (query: ListLotsQuery) => (await listLots(query, ALL_ROWS)).lots,
  columns: [
    { header: "Lote interno", value: (row: LotDTO) => csvCode(row.code) },
    { header: "Origem", value: (row: LotDTO) => (row.origin === "PRODUCTION" ? "Produção" : "Recebimento") },
    { header: "Item", value: (row: LotDTO) => csvCode(row.itemCode) },
    { header: "Descrição", value: (row: LotDTO) => csvText(row.itemName) },
    { header: "Lote do fornecedor", value: (row: LotDTO) => csvCode(row.supplierLot) },
    { header: "Lote Veridi", value: (row: LotDTO) => csvCode(row.businessLotNumber) },
    // Dono do estoque fisico — nunca confundido com Fornecedor.
    {
      header: "Proprietário",
      value: (row: LotDTO) =>
        row.ownerType === "CUSTOMER"
          ? csvText(row.ownerCustomerName ?? "Cliente")
          : "Veridi",
    },
    { header: "Fornecedor", value: (row: LotDTO) => csvText(row.supplierName) },
    { header: "Validade", value: (row: LotDTO) => csvDate(row.expiryDate) },
    { header: "On Hand", value: (row: LotDTO) => csvDecimal(row.onHand) },
    { header: "Reservado", value: (row: LotDTO) => csvDecimal(row.reserved) },
    { header: "Disponível", value: (row: LotDTO) => csvDecimal(row.available) },
    { header: "Unidade", value: (row: LotDTO) => csvText(row.unitCode) },
    { header: "Qualidade", value: (row: LotDTO) => (row.isExpired ? "Vencido" : LOT_STATUS_LABELS[row.status]) },
    { header: "CoA", value: (row: LotDTO) => COA_STATUS_LABELS[row.coaStatus] },
    { header: "Localização", value: (row: LotDTO) => csvText(row.location) },
    { header: "Recebimento", value: (row: LotDTO) => csvCode(row.receiptCode) },
    { header: "OP", value: (row: LotDTO) => csvCode(row.productionOrderCode) },
  ],
});

const projectsExport = defineCsvExport({
  path: "/projects/export.csv",
  slug: "projetos",
  schema: listProjectsQuerySchema,
  fetch: async (query: ListProjectsQuery) => (await listProjects(query, ALL_ROWS)).projects,
  columns: [
    { header: "Código", value: (row: ProjectDTO) => csvCode(row.code) },
    { header: "Código legado", value: (row: ProjectDTO) => csvCode(row.externalCode) },
    { header: "Data de entrada", value: (row: ProjectDTO) => csvDate(row.entryDate) },
    { header: "Cliente", value: (row: ProjectDTO) => csvText(row.customerName) },
    { header: "Projeto", value: (row: ProjectDTO) => csvText(row.name) },
    { header: "Conceito", value: (row: ProjectDTO) => csvText(row.concept) },
    { header: "Canal", value: (row: ProjectDTO) => csvText(row.channel) },
    { header: "Responsável", value: (row: ProjectDTO) => csvText(row.responsibleUserName) },
    { header: "Status", value: (row: ProjectDTO) => PROJECT_STATUS_LABELS[row.status] },
    {
      header: "Motivo do cancelamento",
      value: (row: ProjectDTO) =>
        row.cancelReason ? PROJECT_CANCEL_REASON_LABELS[row.cancelReason] : "",
    },
    { header: "Último orçamento", value: (row: ProjectDTO) => csvCode(row.latestQuoteLabel) },
    { header: "Orçamento aceito", value: (row: ProjectDTO) => csvCode(row.acceptedQuoteLabel) },
    { header: "Produto resultante", value: (row: ProjectDTO) => csvCode(row.productCode) },
  ],
});

const samplesExport = defineCsvExport({
  path: "/project-samples/export.csv",
  slug: "amostras",
  schema: listSamplesQuerySchema,
  fetch: async (query: ListSamplesQuery) => (await listSamples(query, ALL_ROWS)).samples,
  columns: [
    { header: "Amostra", value: (row: ProjectSampleDTO) => csvCode(row.code) },
    { header: "Código legado", value: (row: ProjectSampleDTO) => csvCode(row.externalCode) },
    { header: "Teste", value: (row: ProjectSampleDTO) => csvCode(row.testLabel) },
    { header: "Projeto", value: (row: ProjectSampleDTO) => csvCode(row.projectCode) },
    { header: "Nome do projeto", value: (row: ProjectSampleDTO) => csvText(row.projectName) },
    { header: "Cliente", value: (row: ProjectSampleDTO) => csvText(row.customerName) },
    { header: "Status", value: (row: ProjectSampleDTO) => PROJECT_SAMPLE_STATUS_LABELS[row.status] },
    { header: "Descrição", value: (row: ProjectSampleDTO) => csvText(row.description) },
    { header: "Quantidade produzida", value: (row: ProjectSampleDTO) => csvDecimal(row.outputQuantity) },
    { header: "Unidade", value: (row: ProjectSampleDTO) => csvText(row.outputUomCode) },
    { header: "Consumos", value: (row: ProjectSampleDTO) => String(row.consumptions.length) },
    { header: "Criada em", value: (row: ProjectSampleDTO) => csvDateTime(row.createdAt) },
    { header: "Criada por", value: (row: ProjectSampleDTO) => csvText(row.createdByName) },
    { header: "Produzida em", value: (row: ProjectSampleDTO) => csvDateTime(row.producedAt) },
    { header: "Produzida por", value: (row: ProjectSampleDTO) => csvText(row.producedByName) },
    { header: "Decidida em", value: (row: ProjectSampleDTO) => csvDateTime(row.approvedAt ?? row.rejectedAt) },
    { header: "Decidida por", value: (row: ProjectSampleDTO) => csvText(row.approvedByName ?? row.rejectedByName) },
    { header: "Observação da decisão", value: (row: ProjectSampleDTO) => csvText(row.decisionNotes) },
  ],
});

const customerMaterialsExport = defineCsvExport({
  path: "/inventory/customer-materials/export.csv",
  slug: "materiais-de-clientes",
  schema: listCustomerMaterialsQuerySchema,
  fetch: async (query: ListCustomerMaterialsQuery) =>
    (await listCustomerMaterials(query, ALL_ROWS)).rows,
  columns: [
    { header: "Cliente", value: (row: CustomerMaterialRowDTO) => csvText(row.customerName) },
    { header: "Código do cliente", value: (row: CustomerMaterialRowDTO) => csvCode(row.customerCode) },
    { header: "Item", value: (row: CustomerMaterialRowDTO) => csvCode(row.itemCode) },
    { header: "Descrição", value: (row: CustomerMaterialRowDTO) => csvText(row.itemName) },
    { header: "Lote interno", value: (row: CustomerMaterialRowDTO) => csvCode(row.lotCode) },
    { header: "Lote externo", value: (row: CustomerMaterialRowDTO) => csvCode(row.supplierLot) },
    { header: "Validade", value: (row: CustomerMaterialRowDTO) => csvDate(row.expiryDate) },
    { header: "Localização", value: (row: CustomerMaterialRowDTO) => csvText(row.location) },
    { header: "On Hand", value: (row: CustomerMaterialRowDTO) => csvDecimal(row.onHand) },
    { header: "Reservado", value: (row: CustomerMaterialRowDTO) => csvDecimal(row.reserved) },
    { header: "Disponível", value: (row: CustomerMaterialRowDTO) => csvDecimal(row.available) },
    { header: "Unidade", value: (row: CustomerMaterialRowDTO) => csvText(row.unitCode) },
    {
      header: "Qualidade",
      value: (row: CustomerMaterialRowDTO) =>
        row.isExpired ? "Vencido" : LOT_STATUS_LABELS[row.status],
    },
    { header: "CoA", value: (row: CustomerMaterialRowDTO) => COA_STATUS_LABELS[row.coaStatus] },
  ],
});

const movementsExport = defineCsvExport({
  path: "/inventory-movements/export.csv",
  slug: "movimentacoes",
  schema: listInventoryMovementsQuerySchema,
  fetch: async (query: ListInventoryMovementsQuery) => (await listInventoryMovements(query, ALL_ROWS)).movements,
  columns: [
    { header: "Data/Hora", value: (row: InventoryMovementDTO) => csvDateTime(row.occurredAt) },
    { header: "Tipo", value: (row: InventoryMovementDTO) => INVENTORY_MOVEMENT_TYPE_LABELS[row.type] },
    { header: "Item", value: (row: InventoryMovementDTO) => csvCode(row.itemCode) },
    { header: "Descrição", value: (row: InventoryMovementDTO) => csvText(row.itemName) },
    { header: "Lote", value: (row: InventoryMovementDTO) => csvCode(row.lotCode) },
    { header: "Quantidade", value: (row: InventoryMovementDTO) => csvDecimal(row.quantity) },
    { header: "Unidade", value: (row: InventoryMovementDTO) => csvText(row.unitCode) },
    { header: "Recebimento", value: (row: InventoryMovementDTO) => csvCode(row.receiptCode) },
    { header: "Expedição", value: (row: InventoryMovementDTO) => csvCode(row.shipmentCode) },
    { header: "Motivo", value: (row: InventoryMovementDTO) => csvText(row.reason) },
    { header: "Usuário", value: (row: InventoryMovementDTO) => csvText(row.createdBy) },
  ],
});

const formulationsExport = defineCsvExport({
  path: "/formulations/export.csv",
  slug: "formulacoes",
  schema: listFormulationsQuerySchema,
  fetch: async (query: ListFormulationsQuery) => (await listFormulations(query, ALL_ROWS)).formulations,
  columns: [
    { header: "Produto", value: (row: FormulationSummaryDTO) => csvCode(row.productCode) },
    { header: "Nome", value: (row: FormulationSummaryDTO) => csvText(row.productName) },
    { header: "Cliente", value: (row: FormulationSummaryDTO) => csvText(row.customerName) },
    { header: "Item de produto acabado", value: (row: FormulationSummaryDTO) => csvCode(row.finishedProductItemCode) },
    { header: "Versão ativa", value: (row: FormulationSummaryDTO) => csvText(row.activeVersionLabel) },
    { header: "Possui formulação", value: (row: FormulationSummaryDTO) => csvBoolean(row.hasFormulation) },
    { header: "Atualizada em", value: (row: FormulationSummaryDTO) => csvDate(row.updatedAt) },
  ],
});

const productionOrdersExport = defineCsvExport({
  path: "/production-orders/export.csv",
  slug: "ordens_de_producao",
  schema: listProductionOrdersQuerySchema,
  fetch: async (query: ListProductionOrdersQuery) => (await listProductionOrders(query, ALL_ROWS)).productionOrders,
  columns: [
    { header: "OP", value: (row: ProductionOrderDTO) => csvCode(row.code) },
    { header: "Produto", value: (row: ProductionOrderDTO) => csvCode(row.productCode) },
    { header: "Nome do produto", value: (row: ProductionOrderDTO) => csvText(row.productName) },
    { header: "Formulação", value: (row: ProductionOrderDTO) => csvText(row.formulationVersionLabel) },
    { header: "Status", value: (row: ProductionOrderDTO) => PRODUCTION_ORDER_STATUS_LABELS[row.status] },
    { header: "Planejado", value: (row: ProductionOrderDTO) => csvDecimal(row.plannedQuantity) },
    { header: "Produzido", value: (row: ProductionOrderDTO) => csvDecimal(row.producedQuantity) },
    { header: "Falta produzir", value: (row: ProductionOrderDTO) => csvDecimal(row.remainingQuantity) },
    { header: "Unidade", value: (row: ProductionOrderDTO) => csvText(row.outputUnitCode) },
    { header: "Itens com falta", value: (row: ProductionOrderDTO) => String(row.shortageItemCount) },
    { header: "Pedido do cliente", value: (row: ProductionOrderDTO) => csvCode(row.customerOrderCode) },
    { header: "Início", value: (row: ProductionOrderDTO) => csvDate(row.startedAt) },
    { header: "Conclusão", value: (row: ProductionOrderDTO) => csvDate(row.completedAt) },
  ],
});

const finishedGoodsExport = defineCsvExport({
  path: "/finished-goods/export.csv",
  slug: "produto_acabado",
  schema: listFinishedGoodsQuerySchema,
  fetch: async (query: ListFinishedGoodsQuery) => (await listFinishedGoods(query, ALL_ROWS)).rows,
  columns: [
    { header: "Produto", value: (row: FinishedGoodRowDTO) => csvText(row.productName) },
    { header: "Item PA", value: (row: FinishedGoodRowDTO) => csvCode(row.itemCode) },
    { header: "Lote Veridi", value: (row: FinishedGoodRowDTO) => csvCode(row.businessLotNumber) },
    { header: "Lote interno", value: (row: FinishedGoodRowDTO) => csvCode(row.lotCode) },
    { header: "OP", value: (row: FinishedGoodRowDTO) => csvCode(row.productionOrderCode) },
    { header: "Data de produção", value: (row: FinishedGoodRowDTO) => csvDate(row.producedAt) },
    { header: "Produzido", value: (row: FinishedGoodRowDTO) => csvDecimal(row.producedQuantity) },
    { header: "On Hand", value: (row: FinishedGoodRowDTO) => csvDecimal(row.onHand) },
    { header: "Reservado", value: (row: FinishedGoodRowDTO) => csvDecimal(row.reserved) },
    { header: "Disponível", value: (row: FinishedGoodRowDTO) => csvDecimal(row.available) },
    { header: "Unidade", value: (row: FinishedGoodRowDTO) => csvText(row.unitCode) },
    { header: "Qualidade", value: (row: FinishedGoodRowDTO) => (row.isExpired ? "Vencido" : LOT_STATUS_LABELS[row.status]) },
    { header: "Validade", value: (row: FinishedGoodRowDTO) => csvDate(row.expiryDate) },
    // Custo parcial/desconhecido fica vazio; a qualidade explica o porquê.
    { header: "Custo material unitário", value: (row: FinishedGoodRowDTO) => csvMoney(row.materialUnitCost) },
    { header: "Qualidade do custo", value: (row: FinishedGoodRowDTO) => row.costQuality },
  ],
});

const customerOrdersExport = defineCsvExport({
  path: "/customer-orders/export.csv",
  slug: "pedidos",
  schema: listCustomerOrdersQuerySchema,
  fetch: async (query: ListCustomerOrdersQuery) => (await listCustomerOrders(query, ALL_ROWS)).customerOrders,
  columns: [
    { header: "Pedido", value: (row: CustomerOrderDTO) => csvCode(row.code) },
    { header: "Cliente", value: (row: CustomerOrderDTO) => csvText(row.customerName) },
    { header: "CNPJ do cliente", value: (row: CustomerOrderDTO) => csvCode(row.customerCnpj) },
    { header: "Data", value: (row: CustomerOrderDTO) => csvDate(row.orderDate) },
    { header: "Entrega solicitada", value: (row: CustomerOrderDTO) => csvDate(row.requestedDeliveryDate) },
    { header: "Status", value: (row: CustomerOrderDTO) => CUSTOMER_ORDER_STATUS_LABELS[row.status] },
    { header: "Linhas", value: (row: CustomerOrderDTO) => String(row.lines.length) },
    // Produtos listados, nunca somados entre unidades diferentes.
    { header: "Produtos", value: (row: CustomerOrderDTO) => csvText(row.lines.map((line) => line.productCode).join(", ")) },
    { header: "Expedições", value: (row: CustomerOrderDTO) => String(row.shipments.length) },
    { header: "Faturamentos", value: (row: CustomerOrderDTO) => String(row.billings.length) },
  ],
});

const shipmentsExport = defineCsvExport({
  path: "/shipments/export.csv",
  slug: "expedicoes",
  schema: listShipmentsQuerySchema,
  fetch: async (query: ListShipmentsQuery) => (await listShipments(query, ALL_ROWS)).shipments,
  columns: [
    { header: "Expedição", value: (row: ShipmentDTO) => csvCode(row.code) },
    { header: "Pedido", value: (row: ShipmentDTO) => csvCode(row.customerOrderCode) },
    { header: "Cliente", value: (row: ShipmentDTO) => csvText(row.customerName) },
    { header: "Status", value: (row: ShipmentDTO) => SHIPMENT_STATUS_LABELS[row.status] },
    { header: "Data", value: (row: ShipmentDTO) => csvDate(row.shipmentDate) },
    { header: "Linhas", value: (row: ShipmentDTO) => String(row.lines.length) },
    { header: "Lotes conferidos", value: (row: ShipmentDTO) => `${row.verification.lotsVerified}/${row.verification.lotsRequired}` },
    { header: "Confirmada em", value: (row: ShipmentDTO) => csvDateTime(row.confirmedAt) },
    { header: "Confirmada por", value: (row: ShipmentDTO) => csvText(row.confirmedBy) },
  ],
});

const billingsExport = defineCsvExport({
  path: "/billings/export.csv",
  slug: "faturamento",
  schema: listBillingsQuerySchema,
  fetch: async (query: ListBillingsQuery) => (await listBillings(query, ALL_ROWS)).billings,
  columns: [
    { header: "Faturamento", value: (row: BillingDTO) => csvCode(row.code) },
    { header: "Pedido", value: (row: BillingDTO) => csvCode(row.customerOrderCode) },
    { header: "Expedição", value: (row: BillingDTO) => csvCode(row.shipmentCode) },
    { header: "Cliente", value: (row: BillingDTO) => csvText(row.customerName) },
    { header: "Status", value: (row: BillingDTO) => BILLING_STATUS_LABELS[row.status] },
    { header: "Linhas", value: (row: BillingDTO) => String(row.lines.length) },
    { header: "Quantidade total", value: (row: BillingDTO) => csvDecimal(row.totalQuantity) },
    // Total só com precificação completa; incompleto fica vazio.
    { header: "Valor total", value: (row: BillingDTO) => csvMoney(row.totalAmount) },
    { header: "Precificação", value: (row: BillingDTO) => (row.hasCompletePricing ? "Completa" : "Incompleta") },
    { header: "Referência externa", value: (row: BillingDTO) => csvText(row.externalReference) },
    { header: "Emitido em", value: (row: BillingDTO) => csvDateTime(row.issuedAt) },
  ],
});

export const listCsvExports: CsvExportRoute[] = [
  customersExport,
  suppliersExport,
  itemsExport,
  productsExport,
  purchaseOrdersExport,
  receiptsExport,
  inventoryExport,
  lotsExport,
  projectsExport,
  samplesExport,
  customerMaterialsExport,
  movementsExport,
  formulationsExport,
  productionOrdersExport,
  finishedGoodsExport,
  customerOrdersExport,
  shipmentsExport,
  billingsExport,
];
