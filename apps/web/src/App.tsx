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
import { SuppliersPage } from "./pages/suppliers/SuppliersPage";
import { CustomersPage } from "./pages/customers/CustomersPage";
import { ProductsPage } from "./pages/products/ProductsPage";
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
import { InventoryOverviewPage } from "./pages/inventory/InventoryOverviewPage";
import { InventoryItemDetailPage } from "./pages/inventory/InventoryItemDetailPage";
import { InventoryMovementsPage } from "./pages/inventory/InventoryMovementsPage";
import { StockCountPage } from "./pages/inventory/StockCountPage";
import { CustomerMaterialsPage } from "./pages/inventory/CustomerMaterialsPage";
import { CoaQueuePage } from "./pages/quality/CoaQueuePage";
import { ProjectsPage } from "./pages/projects/ProjectsPage";
import { ProjectDetailPage } from "./pages/projects/ProjectDetailPage";
import { FormulationsPage } from "./pages/formulations/FormulationsPage";
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
          <Route path="/cadastros/fornecedores" element={<SuppliersPage />} />
          <Route path="/cadastros/clientes" element={<CustomersPage />} />
          <Route path="/cadastros/produtos" element={<ProductsPage />} />
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
          <Route path="/comercial/pedidos" element={<CustomerOrdersPage />} />
          <Route path="/comercial/pedidos/novo" element={<CustomerOrderPage />} />
          <Route path="/comercial/pedidos/:id" element={<CustomerOrderPage />} />
          <Route path="/comercial/expedicoes" element={<ShipmentsPage />} />
          <Route path="/comercial/expedicoes/:id" element={<ShipmentPage />} />
          <Route path="/comercial/faturamento" element={<BillingsPage />} />
          <Route path="/comercial/faturamento/:id" element={<BillingPage />} />

          {/* Gestão → Relatórios (R-01…R-17), todos somente leitura. */}
          <Route path="/relatorios" element={<ReportsHubPage />} />
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
