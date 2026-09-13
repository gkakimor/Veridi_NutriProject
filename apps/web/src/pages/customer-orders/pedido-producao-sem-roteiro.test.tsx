import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CustomerOrderDTO } from "@veridi/shared";

/**
 * Pedido — a produção que ainda não tem roteiro (PRODUCTION-ROUTE-ASSIGNMENT-01).
 *
 * O Pedido segue: nada bloqueia. A tabela de ordens diz, a quem acompanha o
 * atendimento, que a produção está pendente de roteiro — e quem resolve é a
 * Produção, na própria ordem.
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

function op(code: string, routePending: boolean) {
  return {
    id: code.toLowerCase(),
    code,
    productId: "prod-1",
    productCode: "PROD-000215",
    productName: "Cafeína PT 60 caps",
    customerOrderLineId: "col-1",
    plannedQuantity: "500",
    producedQuantity: "0",
    outputUnitCode: "un",
    status: "DRAFT",
    routePending,
  };
}

function pedido(ordens: ReturnType<typeof op>[]): CustomerOrderDTO {
  return {
    id: "co-1",
    code: "PED-000001",
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "Vida Saudável Ltda",
    customerTradeName: "Vida Saudável",
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
    status: "IN_FULFILLMENT",
    notes: null,
    lines: [
      {
        id: "col-1",
        productId: "prod-1",
        productCode: "PROD-000215",
        productName: "Cafeína PT 60 caps",
        unitCode: "un",
        orderedQuantity: "1000",
        shippedQuantity: "0",
        outstandingQuantity: "1000",
        billedQuantity: "0",
        unbilledShippedQuantity: "0",
        reservedRemaining: "0",
        pendingProductionQuantity: "0",
        agreedPrice: null,
      },
    ],
    commercialOrigin: null,
    reservation: null,
    generatedProductionOrders: ordens,
    linkedPurchaseOrders: [],
    shipments: [],
    billings: [],
    billingStatus: "NOT_BILLED",
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

function renderPedido() {
  render(
    <MemoryRouter initialEntries={["/comercial/pedidos/co-1"]}>
      <Routes>
        <Route path="/comercial/pedidos/:id" element={<CustomerOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const secaoDeOrdens = () =>
  screen.getByRole("heading", { name: "Ordens de produção" }).closest("section") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCustomers).mockResolvedValue({ customers: [] } as never);
  vi.mocked(listProducts).mockResolvedValue({ products: [] } as never);
  vi.mocked(listSuppliers).mockResolvedValue({ suppliers: [] } as never);
  vi.mocked(listItems).mockResolvedValue({ items: [] } as never);
  vi.mocked(listSupplierItems).mockResolvedValue({ supplierItems: [] } as never);
  vi.mocked(getPlanPurchaseSourcing).mockResolvedValue({ rows: [] } as never);
  vi.mocked(getFulfillmentPlan).mockResolvedValue(null as never);
  vi.mocked(getPurchaseSuggestion).mockResolvedValue({
    customerOrderId: "co-1",
    rows: [],
    customerSuppliedRows: [],
    pendingProductionOrders: [],
  } as never);
  vi.mocked(getReservationStatus).mockResolvedValue({ customerOrderId: "co-1", lines: [] } as never);
});

describe("Pedido — ordens de produção sem roteiro", () => {
  it("avisa \"Produção pendente de roteiro.\" e marca a ordem, sem bloquear nada", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(pedido([op("OP-000010", true), op("OP-000011", false)]));
    renderPedido();

    expect(await screen.findByText("Produção pendente de roteiro.")).toBeInTheDocument();
    const secao = secaoDeOrdens();
    const pendente = within(secao).getByRole("link", { name: /OP-000010/ }).closest("tr") as HTMLElement;
    const pronta = within(secao).getByRole("link", { name: /OP-000011/ }).closest("tr") as HTMLElement;
    expect(within(pendente).getByText("Sem roteiro")).toBeInTheDocument();
    expect(within(pronta).queryByText("Sem roteiro")).toBeNull();
  });

  it("todas com roteiro: nenhum aviso", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(pedido([op("OP-000012", false)]));
    renderPedido();

    await screen.findByRole("heading", { name: "Ordens de produção" });
    expect(within(secaoDeOrdens()).getByRole("link", { name: /OP-000012/ })).toBeInTheDocument();
    expect(screen.queryByText("Produção pendente de roteiro.")).toBeNull();
  });
});
