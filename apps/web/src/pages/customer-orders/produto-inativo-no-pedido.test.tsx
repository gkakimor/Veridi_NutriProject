import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CustomerOrderDTO } from "@veridi/shared";

/**
 * Produto e item de produto acabado inativos no Pedido — PRODUCT-INACTIVE-COMMERCIAL-GATE-01, §108.
 *
 * A linha gravada continua, marcada com a situação REAL que o servidor manda
 * (`productActive`, `finishedItemActive`). No rascunho, o aviso diz antes do
 * clique que confirmar vai ser recusado — e diz qual dos dois está inativo, sem
 * cascata: PA inativo nunca vira "produto inativo" nem "sem produto acabado".
 * Pedido confirmado segue o atendimento: marca, sem aviso.
 */

vi.mock("../../lib/customer-orders-api", () => ({
  applyFulfillmentPlan: vi.fn(),
  cancelCustomerOrder: vi.fn(),
  confirmCustomerOrder: vi.fn(),
  createCustomerOrder: vi.fn(),
  createRemainderProductionOrder: vi.fn(),
  generatePurchaseDrafts: vi.fn(),
  getCustomerOrder: vi.fn(),
  // Seções do pedido confirmado que não são o assunto: nunca respondem.
  getFulfillmentPlan: () => new Promise(() => undefined),
  getPlanPurchaseSourcing: () => new Promise(() => undefined),
  getPurchaseSuggestion: () => new Promise(() => undefined),
  updateCustomerOrder: vi.fn(),
}));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/products-api", () => ({
  // O catálogo de ativos do cliente não traz o produto inativado da linha.
  listProducts: () => Promise.resolve({ products: [], total: 0 }),
  getProduct: vi.fn(),
}));
vi.mock("../../lib/suppliers-api", () => ({ listSuppliers: () => Promise.resolve({ suppliers: [] }) }));
vi.mock("../../lib/shipments-api", () => ({
  createShipmentDraft: vi.fn(),
  getReservationStatus: () => new Promise(() => undefined),
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

import { getCustomerOrder } from "../../lib/customer-orders-api";
import { listCustomers } from "../../lib/customers-api";
import { CustomerOrderPage } from "./CustomerOrderPage";

const CLIENTE = {
  id: "cli-a",
  code: "CLI-000001",
  legalName: "Alfa Suplementos Ltda",
  tradeName: "Alfa",
  active: true,
  blocked: false,
  status: "ACTIVE",
};

function linha(situacao: { productActive: boolean; finishedItemActive: boolean | null }) {
  return {
    id: "col-1",
    productId: "prod-a",
    productCode: "PROD-000101",
    productName: "Whey Alfa 900g",
    finishedItemId: "item-pa",
    finishedItemCode: "PA-000101",
    finishedItemName: "Whey Alfa 900g",
    unitCode: "un",
    orderedQuantity: "10",
    shippedQuantity: "0",
    outstandingQuantity: "10",
    billedQuantity: "0",
    unbilledShippedQuantity: "0",
    pendingProductionQuantity: "0",
    sourceQuoteLineId: null,
    agreedPrice: null,
    productCustomerMismatch: false,
    ...situacao,
  };
}

function pedido(
  situacao: { productActive: boolean; finishedItemActive: boolean | null },
  overrides: Partial<CustomerOrderDTO> = {},
): CustomerOrderDTO {
  return {
    id: "co-1",
    code: "PED-000001",
    customerId: CLIENTE.id,
    customerCode: CLIENTE.code,
    customerName: CLIENTE.legalName,
    customerTradeName: CLIENTE.tradeName,
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
    customerStatus: "ACTIVE",
    orderDate: "2026-09-01T12:00:00.000Z",
    requestedDeliveryDate: null,
    status: "DRAFT",
    notes: null,
    lines: [linha(situacao)],
    commercialOrigin: null,
    reservation: null,
    generatedProductionOrders: [],
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
    ...overrides,
  } as unknown as CustomerOrderDTO;
}

function abrir() {
  render(
    <MemoryRouter initialEntries={["/comercial/pedidos/co-1"]}>
      <Routes>
        <Route path="/comercial/pedidos/:id" element={<CustomerOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const aberto = () => screen.findByRole("heading", { level: 1, name: "PED-000001" });
const aviso = () =>
  screen
    .queryByText(/^(Produto inativo|Item de produto acabado inativo|Produto e item de produto acabado inativos)$/, {
      selector: ".pendency-panel__title",
    })
    ?.closest(".pendency-panel") ?? null;
const marcas = (texto: string) =>
  screen.queryAllByText(texto, { selector: ".badge.badge--inactive" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCustomers).mockResolvedValue({ customers: [CLIENTE], total: 1 } as never);
});

describe("Pedido — produto ou PA inativado depois que a linha entrou", () => {
  it("rascunho com produto inativo: a linha é marcada, o aviso diz que confirmar é recusado, e o botão segue", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(pedido({ productActive: false, finishedItemActive: true }));
    abrir();
    await aberto();

    const painel = aviso();
    expect(painel).not.toBeNull();
    expect(painel).toHaveAttribute("role", "status");
    expect(within(painel as HTMLElement).getByText("Produto inativo")).toBeInTheDocument();
    expect(painel).toHaveTextContent(
      "não é possível confirmar o pedido enquanto o produto estiver inativo.",
    );
    expect(marcas("Inativo")).toHaveLength(1);
    expect(marcas("Item de produto acabado inativo")).toHaveLength(0);
    // Aviso não é autoridade: quem recusa é o servidor.
    expect(screen.getByRole("button", { name: "Confirmar pedido" })).toBeInTheDocument();

    // A opção do campo diz a situação, em vez de parecer um produto qualquer.
    const user = userEvent.setup();
    await user.click(document.querySelector<HTMLInputElement>('[id^="pedido-produto-"]')!);
    const opcao = await screen.findByRole("option", { name: /PROD-000101/ });
    expect(within(opcao).getByText("Inativo")).toBeInTheDocument();
  });

  it("rascunho com PA inativo: aviso e marca próprios do item, nunca 'produto inativo'", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(pedido({ productActive: true, finishedItemActive: false }));
    abrir();
    await aberto();

    const painel = aviso();
    expect(within(painel as HTMLElement).getByText("Item de produto acabado inativo")).toBeInTheDocument();
    expect(painel).toHaveTextContent("PA-000101 Whey Alfa 900g (de PROD-000101)");
    expect(painel).toHaveTextContent("não é possível confirmar o pedido até reativá-lo");
    expect(painel).not.toHaveTextContent("enquanto o produto estiver inativo");
    expect(marcas("Item de produto acabado inativo")).toHaveLength(1);
    expect(marcas("Inativo")).toHaveLength(0);
  });

  it("pedido CONFIRMADO com produto inativo: marca real na linha, sem aviso — o atendimento segue", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(
      pedido(
        { productActive: false, finishedItemActive: true },
        { status: "CONFIRMED", confirmedAt: "2026-09-02T12:00:00.000Z", confirmedBy: "Comercial" },
      ),
    );
    abrir();
    await aberto();

    expect(aviso()).toBeNull();
    expect(marcas("Inativo")).toHaveLength(1);
  });

  it("produto e PA ativos: nenhum aviso nem marca", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(pedido({ productActive: true, finishedItemActive: true }));
    abrir();
    await aberto();

    expect(aviso()).toBeNull();
    expect(marcas("Inativo")).toHaveLength(0);
    expect(marcas("Item de produto acabado inativo")).toHaveLength(0);
  });
});
