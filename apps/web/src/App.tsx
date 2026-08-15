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

export function App() {
  return (
    <BrowserRouter>
      <Routes>
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
          <Route path="/estoque/lotes" element={<LotsPage />} />
          <Route path="/estoque/lotes/:id" element={<LotDetailPage />} />

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
