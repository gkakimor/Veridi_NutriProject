import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CustomerOrderDTO, CustomerStatus } from "@veridi/shared";

/**
 * Aviso de cliente bloqueado ou inativo no Pedido — CUSTOMER-STATUS-HARDENING-01, §95.
 *
 * O rascunho nasceu com o cliente ATIVO; depois o cliente mudou de situação.
 * A confirmação vai ser recusada pelo servidor, e a tela diz isso antes do
 * clique. Pedido confirmado segue o atendimento, que a situação não
 * interrompe — sem aviso. Trocado no campo por outro cliente (o seletor só
 * oferece ativos), o aviso sai.
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

/** O cliente do pedido: fora da lista de ativos, porque mudou de situação. */
const CLIENTE_DO_PEDIDO = { id: "cli-a", code: "CLI-000001", legalName: "Alfa Suplementos Ltda", tradeName: "Alfa" };
/** Outro cliente, ativo — o único tipo que o seletor oferece. */
const OUTRO_ATIVO = {
  id: "cli-b",
  code: "CLI-000002",
  legalName: "Beta Nutrição Ltda",
  tradeName: "Beta",
  active: true,
  blocked: false,
  status: "ACTIVE",
};

const FRASE_BLOQUEADO =
  "Este cliente está bloqueado. O pedido pode ser consultado, mas não é possível confirmá-lo até a regularização.";
const FRASE_INATIVO =
  "Este cliente está inativo. O pedido permanece disponível para consulta, mas não pode avançar no fluxo comercial enquanto o cadastro não for reativado.";

const LINHA = {
  id: "col-1",
  productId: "prod-a",
  productCode: "PROD-000101",
  productName: "Whey Alfa 900g",
  unitCode: "un",
  orderedQuantity: "10",
  shippedQuantity: "0",
  outstandingQuantity: "10",
  billedQuantity: "0",
  unbilledShippedQuantity: "0",
  pendingProductionQuantity: "0",
  agreedPrice: null,
  productCustomerMismatch: false,
};

function pedido(customerStatus: CustomerStatus, overrides: Partial<CustomerOrderDTO> = {}): CustomerOrderDTO {
  return {
    id: "co-1",
    code: "PED-000001",
    customerId: CLIENTE_DO_PEDIDO.id,
    customerCode: CLIENTE_DO_PEDIDO.code,
    customerName: CLIENTE_DO_PEDIDO.legalName,
    customerTradeName: CLIENTE_DO_PEDIDO.tradeName,
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
    customerStatus,
    orderDate: "2026-09-01T12:00:00.000Z",
    requestedDeliveryDate: null,
    status: "DRAFT",
    notes: null,
    lines: [LINHA],
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
const aviso = () => screen.queryByText(/^Cliente (bloqueado|inativo)$/)?.closest(".pendency-panel") ?? null;
const campoCliente = () => document.getElementById("co-customer") as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCustomers).mockResolvedValue({ customers: [OUTRO_ATIVO], total: 1 } as never);
});

describe("Pedido — aviso da situação atual do cliente", () => {
  it("rascunho com cliente BLOQUEADO: avisa, e a confirmação continua oferecida — quem recusa é o servidor", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(pedido("BLOCKED"));
    abrir();
    await aberto();

    const painel = aviso();
    expect(painel).not.toBeNull();
    expect(painel).toHaveAttribute("role", "status");
    expect(painel).toHaveTextContent("Cliente bloqueado");
    expect(painel).toHaveTextContent(FRASE_BLOQUEADO);
    expect(
      within(painel as HTMLElement).getByRole("link", { name: "Ver situação e histórico do cliente" }),
    ).toHaveAttribute("href", "/consultas/clientes/cli-a/resumo");
    expect(screen.getByRole("button", { name: "Confirmar pedido" })).toBeInTheDocument();
  });

  it("rascunho com cliente INATIVO: avisa com a frase do inativo", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(pedido("INACTIVE"));
    abrir();
    await aberto();

    expect(aviso()).toHaveTextContent("Cliente inativo");
    expect(aviso()).toHaveTextContent(FRASE_INATIVO);
  });

  it("rascunho com cliente ATIVO: nenhum aviso", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(pedido("ACTIVE"));
    abrir();
    await aberto();

    expect(aviso()).toBeNull();
  });

  it("pedido CONFIRMADO com cliente bloqueado: sem aviso — o atendimento segue", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(
      pedido("BLOCKED", {
        status: "CONFIRMED",
        confirmedAt: "2026-09-02T12:00:00.000Z",
        confirmedBy: "Comercial",
      }),
    );
    abrir();
    await aberto();

    expect(aviso()).toBeNull();
  });

  it("rascunho sem produtos: a opção do cliente diz 'bloqueado', e trocar por um ativo tira o aviso", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(pedido("BLOCKED", { lines: [] }));
    abrir();
    await aberto();
    expect(aviso()).toHaveTextContent("Cliente bloqueado");

    const user = userEvent.setup();
    await user.click(campoCliente());
    const opcaoAtual = await screen.findByRole("option", { name: /CLI-000001/ });
    // A situação da opção é a atual, não "inativo" por exclusão.
    expect(within(opcaoAtual).getByText("bloqueado")).toBeInTheDocument();

    await user.click(await screen.findByRole("option", { name: /CLI-000002/ }));
    await waitFor(() => expect(aviso()).toBeNull());
  });
});
