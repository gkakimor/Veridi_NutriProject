import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Outlet, Route, RouterProvider, createMemoryRouter, createRoutesFromElements } from "react-router-dom";
import type { CustomerOrderDTO, CustomerOrderStatus } from "@veridi/shared";

/**
 * Prazo e observações depois do plano — VERIDI-AUDIT-QUICK-FIXES-01, D6.
 *
 * O servidor aceita alterar previsão de entrega e observações do Pedido
 * CONFIRMADO; aplicado o plano (em atendimento, parcialmente expedido,
 * expedido), o Pedido está em execução e é somente leitura — recusa o prazo
 * E a observação (`order_locked`). A tela seguia com os dois campos abertos,
 * o aviso "use Salvar prazo e observações" e o botão, que só colhia a recusa.
 *
 * A tela passa a dizer a regra do servidor: campos travados, sem botão e sem
 * pendência de alteração. No confirmado nada muda.
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
vi.mock("../../lib/delivery-schedule-api", () => ({
  getDeliverySchedule: () => new Promise(() => undefined),
  createDeliverySchedule: vi.fn(),
  cancelDeliverySchedule: vi.fn(),
  rescheduleDelivery: vi.fn(),
  prepareShipmentForDelivery: vi.fn(),
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
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import { CustomerOrderPage } from "./CustomerOrderPage";

function pedido(status: CustomerOrderStatus): CustomerOrderDTO {
  return {
    id: "co-1",
    code: "PED-000001",
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "Cliente Teste",
    customerTradeName: "Cliente Teste",
    customerCnpj: null,
    customerAddress: {
      street: null,
      number: null,
      complement: null,
      district: null,
      zipCode: null,
      city: null,
      state: null,
    },
    orderDate: "2026-09-01T12:00:00.000Z",
    requestedDeliveryDate: "2026-10-15T00:00:00.000Z",
    status,
    notes: "Entregar pela manhã",
    lines: [
      {
        id: "col-1",
        productId: "prod-1",
        productCode: "PROD-000101",
        productName: "Whey 900g",
        unitCode: "un",
        orderedQuantity: "10",
        shippedQuantity: "0",
        outstandingQuantity: "10",
        billedQuantity: "0",
        unbilledShippedQuantity: "0",
        pendingProductionQuantity: "0",
        agreedPrice: null,
        productCustomerMismatch: false,
      },
    ],
    commercialOrigin: null,
    reservation: null,
    generatedProductionOrders: [],
    linkedPurchaseOrders: [],
    shipments: [],
    billings: [],
    billingStatus: "NOT_READY",
    confirmedAt: "2026-09-01T12:00:00.000Z",
    confirmedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-09-01T12:00:00.000Z",
  } as unknown as CustomerOrderDTO;
}

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

async function abrir(status: CustomerOrderStatus) {
  vi.mocked(getCustomerOrder).mockResolvedValue(pedido(status));
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/comercial/pedidos/:id" element={<CustomerOrderPage />} />
      </Route>,
    ),
    { initialEntries: ["/comercial/pedidos/co-1"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1, name: /PED-000001/ });
}

const campoPrazo = () => screen.getByLabelText("Entrega prevista") as HTMLInputElement;
const campoNotas = () => screen.getByLabelText("Notas internas") as HTMLTextAreaElement;
const botaoSalvarPrazo = () => screen.queryByRole("button", { name: "Salvar prazo e observações" });

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
    rows: [],
    customerSuppliedRows: [],
    pendingProductionOrders: [],
  } as never);
});

describe("D6 — a tela segue a regra do servidor para prazo e observações", () => {
  it.each(["IN_FULFILLMENT", "PARTIALLY_SHIPPED", "SHIPPED"] as const)(
    "%s: prazo e observações travados, sem 'Salvar prazo e observações'",
    async (status) => {
      await abrir(status);

      expect(botaoSalvarPrazo(), `${status}: botão de salvar`).toBeNull();
      expect(campoPrazo().disabled, `${status}: campo Entrega prevista`).toBe(true);
      expect(campoNotas().disabled, `${status}: campo Notas internas`).toBe(true);
      // O dado continua à vista, só não é editável.
      expect(campoPrazo().value).toBe("2026-10-15");
      expect(campoNotas().value).toBe("Entregar pela manhã");
      expect(screen.queryByText(/não grava sozinho/), `${status}: aviso de onde salvar`).toBeNull();
    },
  );

  it("CONFIRMED: prazo e observações continuam editáveis, com o botão", async () => {
    await abrir("CONFIRMED");

    expect(botaoSalvarPrazo()).not.toBeNull();
    expect(campoPrazo().disabled).toBe(false);
    expect(campoNotas().disabled).toBe(false);
  });
});
