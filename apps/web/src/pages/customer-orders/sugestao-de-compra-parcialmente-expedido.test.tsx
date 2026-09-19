import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CustomerOrderDTO, CustomerOrderStatus, PurchaseSuggestionRowDTO } from "@veridi/shared";

/**
 * A Sugestão de Compra acompanha o Pedido operacional — VERIDI-AUDIT-QUICK-FIXES-01, D5.
 *
 * Depois da primeira expedição o Pedido fica PARTIALLY_SHIPPED e continua
 * operacional: a OP do saldo pode ter falta, e o "Ver sugestão de compra" da
 * OP traz a pessoa para cá. A seção só existia em IN_FULFILLMENT, e a tela
 * chegava sem a funcionalidade. Pedido finalizado (SHIPPED) segue sem ela.
 */

vi.mock("../../lib/customer-orders-api", () => ({
  applyFulfillmentPlan: vi.fn(),
  cancelCustomerOrder: vi.fn(),
  confirmCustomerOrder: vi.fn(),
  createCustomerOrder: vi.fn(),
  createRemainderProductionOrder: vi.fn(),
  generatePurchaseDrafts: vi.fn(),
  getCustomerOrder: vi.fn(),
  getFulfillmentPlan: vi.fn(),
  getPlanPurchaseSourcing: vi.fn(),
  getPurchaseSuggestion: vi.fn(),
  updateCustomerOrder: vi.fn(),
}));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/products-api", () => ({ listProducts: vi.fn(), getProduct: vi.fn() }));
vi.mock("../../lib/suppliers-api", () => ({ listSuppliers: vi.fn() }));
vi.mock("../../lib/items-api", () => ({ listItems: vi.fn(), getItem: vi.fn() }));
vi.mock("../../lib/supplier-items-api", () => ({ listSupplierItems: vi.fn() }));
vi.mock("../../lib/shipments-api", () => ({
  createShipmentDraft: vi.fn(),
  getReservationStatus: vi.fn(),
  reallocateReservationLine: vi.fn(),
  reserveAvailable: vi.fn(),
}));

import {
  getCustomerOrder,
  getFulfillmentPlan,
  getPlanPurchaseSourcing,
  getPurchaseSuggestion,
} from "../../lib/customer-orders-api";
import { listCustomers } from "../../lib/customers-api";
import { listProducts } from "../../lib/products-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { listItems } from "../../lib/items-api";
import { listSupplierItems } from "../../lib/supplier-items-api";
import { getReservationStatus } from "../../lib/shipments-api";
import { CustomerOrderPage } from "./CustomerOrderPage";

/** 1.000 pedidos, 600 já expedidos, 400 numa OP de saldo aberta. */
function pedido(status: CustomerOrderStatus): CustomerOrderDTO {
  const expedido = status === "SHIPPED" ? "1000" : "600";
  return {
    id: "co-1",
    code: "PED-000001",
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "Cliente Teste",
    customerTradeName: "Cliente Teste",
    customerCnpj: null,
    customerAddress: {
      street: "Rua das Palmeiras",
      number: "120",
      complement: null,
      district: "Centro",
      zipCode: "13010-000",
      city: "Campinas",
      state: "SP",
    },
    orderDate: "2026-09-01T12:00:00.000Z",
    requestedDeliveryDate: null,
    status,
    notes: null,
    lines: [
      {
        id: "col-1",
        productId: "prod-1",
        productCode: "PROD-000215",
        productName: "Produto Teste",
        unitCode: "un",
        orderedQuantity: "1000",
        shippedQuantity: expedido,
        outstandingQuantity: status === "SHIPPED" ? "0" : "400",
        billedQuantity: "0",
        unbilledShippedQuantity: expedido,
        reservedRemaining: "0",
        pendingProductionQuantity: "0",
        agreedPrice: null,
      },
    ],
    commercialOrigin: null,
    reservation: null,
    generatedProductionOrders: [],
    linkedPurchaseOrders: [],
    shipments: [],
    billings: [],
    billingStatus: "PENDING",
    confirmedAt: null,
    confirmedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-09-01T12:00:00.000Z",
  } as unknown as CustomerOrderDTO;
}

const faltaDaOpDeSaldo: PurchaseSuggestionRowDTO = {
  itemId: "item-1",
  itemCode: "MP-000167",
  itemName: "Taurina",
  unitCode: "kg",
  remainingRequired: "400",
  ownReserved: "0",
  globalReserved: "0",
  available: "0",
  onOrder: "0",
  operationalShortage: "400",
  draftPurchaseQuantity: "0",
  suggestedAdditionalPurchase: "400",
  newSuggestedPurchase: "400",
  supplierCandidates: [],
  recommendedSupplierItemId: null,
};

function abrirPedido() {
  render(
    <MemoryRouter initialEntries={["/comercial/pedidos/co-1"]}>
      <Routes>
        <Route path="/comercial/pedidos/:id" element={<CustomerOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCustomers).mockResolvedValue({ customers: [] } as never);
  vi.mocked(listProducts).mockResolvedValue({ products: [] } as never);
  vi.mocked(listSuppliers).mockResolvedValue({ suppliers: [] } as never);
  vi.mocked(listItems).mockResolvedValue({ items: [] } as never);
  vi.mocked(listSupplierItems).mockResolvedValue({ supplierItems: [] } as never);
  vi.mocked(getPlanPurchaseSourcing).mockResolvedValue({ rows: [] } as never);
  vi.mocked(getFulfillmentPlan).mockResolvedValue(null as never);
  vi.mocked(getReservationStatus).mockResolvedValue({ customerOrderId: "co-1", lines: [] } as never);
  vi.mocked(getPurchaseSuggestion).mockResolvedValue({
    customerOrderId: "co-1",
    rows: [faltaDaOpDeSaldo],
    customerSuppliedRows: [],
    pendingProductionOrders: [],
  } as never);
});

describe("D5 — Sugestão de Compra no Pedido parcialmente expedido", () => {
  it("PARTIALLY_SHIPPED mostra a sugestão e a ação de gerar OC", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(pedido("PARTIALLY_SHIPPED"));

    abrirPedido();

    expect(await screen.findByRole("heading", { name: "Sugestão de Compra" })).toBeTruthy();
    await waitFor(() => expect(getPurchaseSuggestion).toHaveBeenCalledWith("co-1"));
    await waitFor(() =>
      expect(
        Array.from(document.querySelectorAll("tr")).some((tr) => (tr.textContent ?? "").includes("MP-000167")),
      ).toBe(true),
    );
    expect(screen.getByRole("button", { name: "Gerar OCs em rascunho" })).toBeTruthy();
  });

  it("SHIPPED (finalizado) não oferece a sugestão nem a consulta", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(pedido("SHIPPED"));

    abrirPedido();

    await screen.findByRole("heading", { level: 1, name: /PED-000001/ });
    expect(screen.queryByRole("heading", { name: "Sugestão de Compra" })).toBeNull();
    expect(getPurchaseSuggestion).not.toHaveBeenCalled();
  });
});
