import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./app/AppShell";
import { AuthProvider, useAuth } from "./app/AuthProvider";
import { LoginPage } from "./pages/LoginPage";
import { UsersPage } from "./pages/admin/UsersPage";
import { ControlledDocumentsPage } from "./pages/admin/ControlledDocumentsPage";
import { RecipeSheetPage } from "./pages/production-orders/RecipeSheetPage";
import { navItems } from "./app/navigation";
import { DashboardPage } from "./pages/DashboardPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { ItemsPage } from "./pages/items/ItemsPage";
import { ItemCreatePage } from "./pages/items/ItemCreatePage";
import { SuppliersPage } from "./pages/suppliers/SuppliersPage";
import { SupplierCreatePage } from "./pages/suppliers/SupplierCreatePage";
import { CustomersPage } from "./pages/customers/CustomersPage";
import { CustomerCreatePage } from "./pages/customers/CustomerCreatePage";
import { consultationRoutes } from "./pages/customer-consultation/routes";
import { ProductsPage } from "./pages/products/ProductsPage";
import { ProductCreatePage } from "./pages/products/ProductCreatePage";
import { PurchaseOrdersPage } from "./pages/purchase-orders/PurchaseOrdersPage";
import { PurchaseOrderPage } from "./pages/purchase-orders/PurchaseOrderPage";
import { ReceiptsPage } from "./pages/receiving/ReceiptsPage";
import { ReceivePurchaseOrderPage } from "./pages/receiving/ReceivePurchaseOrderPage";
import { ReceiveCustomerMaterialPage } from "./pages/receiving/ReceiveCustomerMaterialPage";
import { ReceiptDetailPage } from "./pages/receiving/ReceiptDetailPage";
import { LotsPage } from "./pages/lots/LotsPage";
import { LotDetailPage } from "./pages/lots/LotDetailPage";
import { LotScanPage } from "./pages/lots/LotScanPage";
import { LotLabelPrintPage } from "./pages/lots/LotLabelPrintPage";
import { SampleLabelPrintPage } from "./pages/samples/SampleLabelPrintPage";
import { ReportPrintPage } from "./pages/print/ReportPrintPage";
import { IndustrialCostPrintPage } from "./pages/print/IndustrialCostPrintPage";
import { IndustrialCostPage } from "./pages/industrial-costs/IndustrialCostPage";
import { ProductCmvPage } from "./pages/product-cmv/ProductCmvPage";
import { CostCalculationPage } from "./pages/industrial-costs/CostCalculationPage";
import { CmvPrintPage } from "./pages/print/CmvPrintPage";
import { PricingListPage } from "./pages/pricing/PricingListPage";
import { PricingPage } from "./pages/pricing/PricingPage";
import { PricingPrintPage } from "./pages/print/PricingPrintPage";
import {
  IndustrialCostByProductReportPage,
  PricingByProductReportPage,
  QuotePricingAuditReportPage,
} from "./pages/reports/CostReports";
import { CostCalculationPrintPage } from "./pages/print/CostCalculationPrintPage";
import { ProductionCostPrintPage } from "./pages/print/ProductionCostPrintPage";
import { IndustrialResourceDetailPage } from "./pages/industrial-resources/IndustrialResourceDetailPage";
import { IndustrialResourcesPage } from "./pages/industrial-resources/IndustrialResourcesPage";
import { IndustrialResourceCreatePage } from "./pages/industrial-resources/IndustrialResourceCreatePage";
import {
  OrderOperationPrintPage,
  ProductionTraceabilityPrintPage,
} from "./pages/print/DocumentReportPrints";
import {
  InventoryCountSheetPage,
  InventoryPositionSheetPage,
  ProductionPickingSheetPage,
  QualityPendingSheetPage,
  ShipmentPickingSheetPage,
} from "./pages/print/OperationalSheets";
import { SamplesPage } from "./pages/samples/SamplesPage";
import { SupplierItemsPage } from "./pages/supplier-items/SupplierItemsPage";
import { SampleDetailPage } from "./pages/samples/SampleDetailPage";
import { InventoryOverviewPage } from "./pages/inventory/InventoryOverviewPage";
import { InventoryItemDetailPage } from "./pages/inventory/InventoryItemDetailPage";
import { InventoryMovementsPage } from "./pages/inventory/InventoryMovementsPage";
import { StockCountPage } from "./pages/inventory/StockCountPage";
import { CustomerMaterialsPage } from "./pages/inventory/CustomerMaterialsPage";
import { CoaQueuePage } from "./pages/quality/CoaQueuePage";
import { ProjectsPage } from "./pages/projects/ProjectsPage";
import { ProjectDetailPage } from "./pages/projects/ProjectDetailPage";
import { FormulationsPage } from "./pages/formulations/FormulationsPage";
import { FormulationTemplatesPage } from "./pages/formulation-templates/FormulationTemplatesPage";
import { FormulationTemplateDetailPage } from "./pages/formulation-templates/FormulationTemplateDetailPage";
import { CostTemplatesPage } from "./pages/cost-templates/CostTemplatesPage";
import { CostTemplateDetailPage } from "./pages/cost-templates/CostTemplateDetailPage";
import { PricingPoliciesPage } from "./pages/cost-templates/PricingPoliciesPage";
import { PricingPolicyDetailPage } from "./pages/cost-templates/PricingPolicyDetailPage";
import { FormulationDetailPage } from "./pages/formulations/FormulationDetailPage";
import { FormulationVersionPage } from "./pages/formulations/FormulationVersionPage";
import { ProductionOrdersPage } from "./pages/production-orders/ProductionOrdersPage";
import { ProductionOrderPage } from "./pages/production-orders/ProductionOrderPage";
import { PickingConsumptionPage } from "./pages/production-orders/PickingConsumptionPage";
import { FinishedGoodsPage } from "./pages/finished-goods/FinishedGoodsPage";
import { CustomerOrdersPage } from "./pages/customer-orders/CustomerOrdersPage";
import { CustomerOrderPage } from "./pages/customer-orders/CustomerOrderPage";
import { ShipmentsPage } from "./pages/shipments/ShipmentsPage";
import { ShipmentPage } from "./pages/shipments/ShipmentPage";
import { BillingsPage } from "./pages/billings/BillingsPage";
import { BillingPage } from "./pages/billings/BillingPage";
import {
  BillingPrintPage,
  CustomerOrderPrintPage,
  LotTraceabilityPrintPage,
  ProductionOrderPrintPage,
  QuotePrintPage,
  RecipeSheetPrintPage,
  PurchaseOrderPrintPage,
  ReceiptPrintPage,
  ShipmentPrintPage,
} from "./pages/print/PrintPages";
import { ReportsHubPage } from "./pages/reports/ReportsHubPage";
import {
  ExpiryReportPage,
  InventoryPositionReportPage,
  MovementsReportPage,
} from "./pages/reports/InventoryReports";
import {
  ConsumptionReportPage,
  PlannedActualReportPage,
  ProductionTraceabilityReportPage,
  RequirementsReportPage,
} from "./pages/reports/ProductionReports";
import {
  LatePurchaseOrdersReportPage,
  OnOrderReportPage,
  PurchaseOrdersReportPage,
  ReceiptsReportPage,
} from "./pages/reports/PurchasingReports";
import {
  CustomerOrdersReportPage,
  FulfillmentReportPage,
  OrderOperationReportPage,
} from "./pages/reports/CommercialReports";
import {
  AwaitingBillingReportPage,
  BillingPeriodReportPage,
  OrderDeliveredBilledReportPage,
} from "./pages/reports/BillingReports";

/**
 * Sem sessão o app inteiro é a tela de Login — inclusive as rotas de
 * impressão, que também consomem a API autenticada.
 */
function AuthenticatedApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="login">
        <p>Carregando…</p>
      </div>
    );
  }
  if (!user) return <LoginPage />;

  return (
    <BrowserRouter>
      <Routes>
        {/* Rotas de impressão: fora do AppShell — sem topbar/sidebar. */}
        <Route path="/estoque/lotes/:id/etiqueta" element={<LotLabelPrintPage />} />
        <Route path="/comercial/amostras/:id/etiqueta" element={<SampleLabelPrintPage />} />
        {/* Folhas operacionais (FO-xx): documento de papel, fora do AppShell. */}
        {/* Relatórios: a impressão nasce em rota dedicada, nunca da tela. */}
        <Route path="/print/relatorios/R-06" element={<ProductionTraceabilityPrintPage />} />
        <Route path="/print/relatorios/R-14" element={<OrderOperationPrintPage />} />
        <Route path="/print/relatorios/:reportCode" element={<ReportPrintPage />} />
        <Route path="/print/estrutura-custos/:id" element={<IndustrialCostPrintPage />} />
        <Route path="/print/calculo-custo/:id" element={<CostCalculationPrintPage />} />
        <Route path="/print/cmv/:productId" element={<CmvPrintPage />} />
        <Route path="/print/custo-producao/:id" element={<ProductionCostPrintPage />} />
        <Route path="/print/precificacao/:id" element={<PricingPrintPage />} />
        <Route path="/print/contagem-fisica" element={<InventoryCountSheetPage />} />
        <Route path="/print/posicao-estoque" element={<InventoryPositionSheetPage />} />
        <Route path="/print/qualidade-pendencias" element={<QualityPendingSheetPage />} />
        <Route path="/print/producao-picking/:id" element={<ProductionPickingSheetPage />} />
        <Route path="/print/expedicao-separacao/:id" element={<ShipmentPickingSheetPage />} />
        <Route path="/estoque/lotes/:id/rastreabilidade/imprimir" element={<LotTraceabilityPrintPage />} />
        <Route path="/comercial/pedidos/:id/imprimir" element={<CustomerOrderPrintPage />} />
        <Route path="/comercial/orcamentos/:id/imprimir" element={<QuotePrintPage />} />
        <Route path="/compras/ordens/:id/imprimir" element={<PurchaseOrderPrintPage />} />
        <Route path="/compras/recebimentos/:id/imprimir" element={<ReceiptPrintPage />} />
        <Route path="/producao/ordens/:id/imprimir" element={<ProductionOrderPrintPage />} />
        <Route
          path="/producao/ordens/:id/receita/imprimir"
          element={<RecipeSheetPrintPage />}
        />
        <Route path="/comercial/expedicoes/:id/imprimir" element={<ShipmentPrintPage />} />
        <Route path="/comercial/faturamento/:id/imprimir" element={<BillingPrintPage />} />

        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="/cadastros/itens" element={<ItemsPage />} />
          <Route path="/cadastros/itens/novo" element={<ItemCreatePage />} />
          <Route path="/cadastros/fornecedores" element={<SuppliersPage />} />
          {/* Rota antes da listagem não é necessária: `/novo` é estático e o
              router casa segmento estático antes de dinâmico. Fica junto da
              lista para quem lê o arquivo achar as duas de uma vez. */}
          <Route path="/cadastros/fornecedores/novo" element={<SupplierCreatePage />} />
          <Route path="/cadastros/clientes" element={<CustomersPage />} />
          <Route path="/cadastros/clientes/novo" element={<CustomerCreatePage />} />
          <Route path="/cadastros/produtos" element={<ProductsPage />} />
          <Route path="/cadastros/produtos/novo" element={<ProductCreatePage />} />

          {/*
            CONSULTA DO CLIENTE — leitura sob o contexto do Cliente.

            A árvore vive em `pages/customer-consultation/routes` porque o
            teste de navegação monta exatamente ela. As rotas operacionais
            acima continuam exatamente como estavam.
          */}
          {consultationRoutes}
          <Route path="/produtos/:productId/custos" element={<IndustrialCostPage />} />
          <Route path="/produtos/:productId/cmv" element={<ProductCmvPage />} />
          <Route path="/calculos-custo/:id" element={<CostCalculationPage />} />
          <Route path="/compras/ordens" element={<PurchaseOrdersPage />} />
          <Route path="/compras/ordens/nova" element={<PurchaseOrderPage />} />
          <Route path="/compras/ordens/:id" element={<PurchaseOrderPage />} />
          <Route path="/compras/recebimentos" element={<ReceiptsPage />} />
          <Route path="/compras/recebimentos/novo" element={<ReceivePurchaseOrderPage />} />
          <Route
            path="/compras/recebimentos/material-do-cliente"
            element={<ReceiveCustomerMaterialPage />}
          />
          <Route path="/compras/recebimentos/:id" element={<ReceiptDetailPage />} />
          <Route path="/estoque" element={<InventoryOverviewPage />} />
          <Route path="/estoque/movimentacoes" element={<InventoryMovementsPage />} />
          <Route path="/estoque/inventario" element={<StockCountPage />} />
          <Route
            path="/estoque/materiais-de-clientes"
            element={<CustomerMaterialsPage />}
          />
          <Route path="/estoque/lotes" element={<LotsPage />} />
          <Route path="/estoque/lotes/escanear" element={<LotScanPage />} />
          <Route path="/estoque/lotes/:id" element={<LotDetailPage />} />
          <Route path="/estoque/:itemId" element={<InventoryItemDetailPage />} />
          <Route path="/qualidade/documentos" element={<CoaQueuePage />} />
          <Route path="/producao/formulacoes" element={<FormulationsPage />} />
          <Route
            path="/producao/templates-formulacao"
            element={<FormulationTemplatesPage />}
          />
          <Route
            path="/producao/templates-formulacao/:templateId"
            element={<FormulationTemplateDetailPage />}
          />
          <Route path="/producao/formulacoes/:productId" element={<FormulationDetailPage />} />
          <Route
            path="/producao/formulacoes/:productId/versoes/:versionId"
            element={<FormulationVersionPage />}
          />
          <Route path="/producao/ordens" element={<ProductionOrdersPage />} />
          <Route path="/producao/ordens/nova" element={<ProductionOrderPage />} />
          <Route path="/producao/ordens/:id" element={<ProductionOrderPage />} />
          <Route path="/producao/ordens/:id/receita" element={<RecipeSheetPage />} />
          <Route path="/producao/picking" element={<PickingConsumptionPage />} />
          <Route path="/administracao/usuarios" element={<UsersPage />} />
          <Route
            path="/administracao/documentos"
            element={<ControlledDocumentsPage />}
          />
          <Route path="/producao/produto-acabado" element={<FinishedGoodsPage />} />
          <Route path="/comercial/projetos" element={<ProjectsPage />} />
          <Route path="/comercial/projetos/:id" element={<ProjectDetailPage />} />
          <Route path="/compras/item-fornecedor" element={<SupplierItemsPage />} />
          <Route path="/comercial/amostras" element={<SamplesPage />} />
          <Route path="/comercial/amostras/:id" element={<SampleDetailPage />} />
          <Route path="/comercial/pedidos" element={<CustomerOrdersPage />} />
          <Route path="/comercial/pedidos/novo" element={<CustomerOrderPage />} />
          <Route path="/comercial/pedidos/:id" element={<CustomerOrderPage />} />
          <Route path="/comercial/expedicoes" element={<ShipmentsPage />} />
          <Route path="/comercial/expedicoes/:id" element={<ShipmentPage />} />
          <Route path="/comercial/faturamento" element={<BillingsPage />} />
          <Route path="/comercial/faturamento/:id" element={<BillingPage />} />

          {/* Gestão → Relatórios (R-01…R-17), todos somente leitura. */}
          <Route
            path="/gestao/recursos-industriais"
            element={<IndustrialResourcesPage />}
          />
          {/* `/novo` antes de `:id`: segmento estático ganha do dinâmico no
              router, mas deixar na ordem certa poupa a próxima pessoa de
              conferir isso. */}
          <Route
            path="/gestao/recursos-industriais/novo"
            element={<IndustrialResourceCreatePage />}
          />
          <Route
            path="/gestao/recursos-industriais/:id"
            element={<IndustrialResourceDetailPage />}
          />
          <Route path="/gestao/templates-estrutura" element={<CostTemplatesPage />} />
          <Route
            path="/gestao/templates-estrutura/:templateId"
            element={<CostTemplateDetailPage />}
          />
          <Route path="/gestao/politicas-precificacao" element={<PricingPoliciesPage />} />
          <Route
            path="/gestao/politicas-precificacao/:policyId"
            element={<PricingPolicyDetailPage />}
          />
          <Route path="/gestao/precificacao" element={<PricingListPage />} />
          <Route path="/gestao/precificacao/:pricingId" element={<PricingPage />} />
          <Route path="/relatorios" element={<ReportsHubPage />} />
          <Route
            path="/relatorios/custos/industrial-por-produto"
            element={<IndustrialCostByProductReportPage />}
          />
          <Route
            path="/relatorios/custos/precificacao-por-produto"
            element={<PricingByProductReportPage />}
          />
          <Route
            path="/relatorios/comercial/orcamento-precificacao"
            element={<QuotePricingAuditReportPage />}
          />
          <Route path="/relatorios/estoque/posicao" element={<InventoryPositionReportPage />} />
          <Route path="/relatorios/estoque/vencimentos" element={<ExpiryReportPage />} />
          <Route path="/relatorios/estoque/movimentacoes" element={<MovementsReportPage />} />
          <Route path="/relatorios/producao/necessidades" element={<RequirementsReportPage />} />
          <Route path="/relatorios/producao/planejado-realizado" element={<PlannedActualReportPage />} />
          <Route path="/relatorios/producao/rastreabilidade" element={<ProductionTraceabilityReportPage />} />
          <Route path="/relatorios/producao/consumo" element={<ConsumptionReportPage />} />
          <Route path="/relatorios/compras/ordens" element={<PurchaseOrdersReportPage />} />
          <Route path="/relatorios/compras/recebimentos" element={<ReceiptsReportPage />} />
          <Route path="/relatorios/compras/em-compra" element={<OnOrderReportPage />} />
          <Route path="/relatorios/compras/atrasadas" element={<LatePurchaseOrdersReportPage />} />
          <Route path="/relatorios/comercial/pedidos" element={<CustomerOrdersReportPage />} />
          <Route path="/relatorios/comercial/atendimento" element={<FulfillmentReportPage />} />
          <Route path="/relatorios/comercial/pedido-operacao" element={<OrderOperationReportPage />} />
          <Route path="/relatorios/faturamento/periodo" element={<BillingPeriodReportPage />} />
          <Route path="/relatorios/faturamento/pendentes" element={<AwaitingBillingReportPage />} />
          <Route
            path="/relatorios/faturamento/pedido-entregue-faturado"
            element={<OrderDeliveredBilledReportPage />}
          />

          {navItems
            .filter((item) => !item.implemented)
            .map((item) => (
              <Route
                key={item.path}
                path={item.path}
                element={<PlaceholderPage title={item.label} />}
              />
            ))}

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}
