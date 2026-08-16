import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./app/AppShell";
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
import { ReceiptDetailPage } from "./pages/receiving/ReceiptDetailPage";
import { LotsPage } from "./pages/lots/LotsPage";
import { LotDetailPage } from "./pages/lots/LotDetailPage";
import { LotScanPage } from "./pages/lots/LotScanPage";
import { LotLabelPrintPage } from "./pages/lots/LotLabelPrintPage";
import { InventoryOverviewPage } from "./pages/inventory/InventoryOverviewPage";
import { InventoryItemDetailPage } from "./pages/inventory/InventoryItemDetailPage";
import { InventoryMovementsPage } from "./pages/inventory/InventoryMovementsPage";
import { StockCountPage } from "./pages/inventory/StockCountPage";
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

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Rota de impressão: fora do AppShell — sem topbar/sidebar. */}
        <Route path="/estoque/lotes/:id/etiqueta" element={<LotLabelPrintPage />} />

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
          <Route path="/compras/recebimentos/:id" element={<ReceiptDetailPage />} />
          <Route path="/estoque" element={<InventoryOverviewPage />} />
          <Route path="/estoque/movimentacoes" element={<InventoryMovementsPage />} />
          <Route path="/estoque/inventario" element={<StockCountPage />} />
          <Route path="/estoque/lotes" element={<LotsPage />} />
          <Route path="/estoque/lotes/escanear" element={<LotScanPage />} />
          <Route path="/estoque/lotes/:id" element={<LotDetailPage />} />
          <Route path="/estoque/:itemId" element={<InventoryItemDetailPage />} />
          <Route path="/producao/formulacoes" element={<FormulationsPage />} />
          <Route path="/producao/formulacoes/:productId" element={<FormulationDetailPage />} />
          <Route
            path="/producao/formulacoes/:productId/versoes/:versionId"
            element={<FormulationVersionPage />}
          />
          <Route path="/producao/ordens" element={<ProductionOrdersPage />} />
          <Route path="/producao/ordens/nova" element={<ProductionOrderPage />} />
          <Route path="/producao/ordens/:id" element={<ProductionOrderPage />} />
          <Route path="/producao/picking" element={<PickingConsumptionPage />} />
          <Route path="/producao/produto-acabado" element={<FinishedGoodsPage />} />
          <Route path="/comercial/pedidos" element={<CustomerOrdersPage />} />
          <Route path="/comercial/pedidos/novo" element={<CustomerOrderPage />} />
          <Route path="/comercial/pedidos/:id" element={<CustomerOrderPage />} />
          <Route path="/comercial/expedicoes" element={<ShipmentsPage />} />
          <Route path="/comercial/expedicoes/:id" element={<ShipmentPage />} />
          <Route path="/comercial/faturamento" element={<BillingsPage />} />
          <Route path="/comercial/faturamento/:id" element={<BillingPage />} />

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
