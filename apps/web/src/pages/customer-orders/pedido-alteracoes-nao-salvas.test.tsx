import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { CustomerOrderDTO } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-01 no Pedido do Cliente.
 *
 * O Pedido é página, não modal: sair dele é trocar de endereço, e quem faz
 * isso é o menu, a trilha, um link ou o Voltar do navegador. O que se protege
 * aqui é a assinatura do documento não inventar pendência — decimal
 * reescrito, ausência contra vazio, a unidade que só chega depois do servidor
 * — nem perder uma: cabeçalho e linha pesam igual.
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
vi.mock("../../lib/shipments-api", () => ({
  createShipmentDraft: vi.fn(),
  getReservationStatus: vi.fn(),
  reallocateReservationLine: vi.fn(),
  reserveAvailable: vi.fn(),
}));

import {
  createCustomerOrder,
  getCustomerOrder,
  getFulfillmentPlan,
  updateCustomerOrder,
} from "../../lib/customer-orders-api";
import { listCustomers } from "../../lib/customers-api";
import { listProducts } from "../../lib/products-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { getReservationStatus } from "../../lib/shipments-api";
import { CustomerOrderPage } from "./CustomerOrderPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

const CLIENTE = {
  id: "cli-a",
  code: "CLI-000001",
  legalName: "Alfa Suplementos Ltda",
  tradeName: "Alfa",
};

const PRODUTO = {
  id: "prod-a",
  code: "PROD-000101",
  name: "Whey Alfa 900g",
  customerId: CLIENTE.id,
  finishedProductItem: { id: "pa-a", code: "PA-000101", name: "Whey Alfa 900g" },
};

function pedido(overrides: Partial<CustomerOrderDTO> = {}): CustomerOrderDTO {
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
    orderDate: "2026-09-01T12:00:00.000Z",
    requestedDeliveryDate: null,
    status: "DRAFT",
    notes: null,
    lines: [
      {
        id: "col-1",
        productId: PRODUTO.id,
        productCode: PRODUTO.code,
        productName: PRODUTO.name,
        unitCode: "un",
        orderedQuantity: "10.000000",
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

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <nav id="sidebar">
        <Link to="/estoque">Estoque</Link>
      </nav>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

function montar(entradas: string[], indice?: number) {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/comercial/pedidos/novo" element={<CustomerOrderPage />} />
        <Route path="/comercial/pedidos/:id" element={<CustomerOrderPage />} />
        <Route path="/estoque" element={<h1>Posição de Estoque</h1>} />
      </Route>,
    ),
    { initialEntries: entradas, ...(indice === undefined ? {} : { initialIndex: indice }) },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function abrirNovo() {
  montar(["/comercial/pedidos/novo"]);
  await screen.findByRole("heading", { name: "Novo pedido" });
}

async function abrirGravado(dto = pedido()) {
  vi.mocked(getCustomerOrder).mockResolvedValue(dto);
  montar(["/comercial/pedidos/co-1"]);
  await screen.findByRole("heading", { name: "PED-000001" });
  await waitFor(() => expect(quantidade()).toHaveValue("10.000000"));
}

const pergunta = () => screen.queryByRole("alertdialog");
const menuEstoque = () => screen.getByRole("link", { name: "Estoque" });
const observacoes = () => screen.getByLabelText("Notas internas");
const quantidade = () =>
  screen.getByRole("textbox", { name: `Quantidade de ${PRODUTO.code}` }) as HTMLInputElement;

/** Sem cliente o pedido nem é criado: o salvamento para antes de chamar a API. */
async function escolherCliente() {
  const user = userEvent.setup();
  await user.click(document.getElementById("co-customer") as HTMLInputElement);
  await user.click(await screen.findByText(CLIENTE.tradeName));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCustomers).mockResolvedValue({ customers: [CLIENTE], total: 1 } as never);
  vi.mocked(listProducts).mockResolvedValue({ products: [PRODUTO], total: 1 } as never);
  vi.mocked(listSuppliers).mockResolvedValue({ suppliers: [] } as never);
  vi.mocked(getFulfillmentPlan).mockResolvedValue(null as never);
  vi.mocked(getReservationStatus).mockResolvedValue(null as never);
});

describe("Pedido novo — guarda de alterações não salvas", () => {
  it("aberto e não tocado, sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrirNovo();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("alterar o cabeçalho pergunta antes de sair", async () => {
    const user = userEvent.setup();
    await abrirNovo();

    fireEvent.change(observacoes(), { target: { value: "Entrega em duas etapas" } });
    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas neste pedido/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Posição de Estoque" })).toBeNull();
  });

  it("Continuar editando mantém a tela e o que foi digitado", async () => {
    const user = userEvent.setup();
    await abrirNovo();

    fireEvent.change(observacoes(), { target: { value: "Entrega em duas etapas" } });
    await user.click(menuEstoque());
    await user.click(await screen.findByRole("button", { name: "Continuar editando" }));

    await waitFor(() => expect(pergunta()).toBeNull());
    expect(observacoes()).toHaveValue("Entrega em duas etapas");
    expect(screen.getByRole("heading", { name: "Novo pedido" })).toBeInTheDocument();
  });

  it("Sair sem salvar vai exatamente para o destino pedido", async () => {
    const user = userEvent.setup();
    await abrirNovo();

    fireEvent.change(observacoes(), { target: { value: "Entrega em duas etapas" } });
    await user.click(menuEstoque());
    await user.click(await screen.findByRole("button", { name: "Sair sem salvar" }));

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
  });

  it("salvar limpa a pendência antes de trocar de endereço", async () => {
    const user = userEvent.setup();
    vi.mocked(createCustomerOrder).mockResolvedValue(pedido());
    vi.mocked(getCustomerOrder).mockResolvedValue(pedido());
    await abrirNovo();

    await escolherCliente();
    fireEvent.change(observacoes(), { target: { value: "Entrega em duas etapas" } });
    await user.click(screen.getByRole("button", { name: /Salvar rascunho/ }));

    await waitFor(() => expect(createCustomerOrder).toHaveBeenCalledTimes(1));
    /*
     * Criar troca o endereço (`/novo` → `/:id`) dentro da MESMA função que
     * salvou, antes de qualquer renderização: sem limpar a referência ali, a
     * guarda perguntaria se a pessoa quer descartar o que acabou de gravar.
     */
    expect(pergunta()).toBeNull();
    await screen.findByRole("heading", { name: "PED-000001" });
  });
});

describe("Pedido gravado — guarda de alterações não salvas", () => {
  it("carregado e não tocado, sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrirGravado();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("alterar a quantidade de uma linha pergunta", async () => {
    const user = userEvent.setup();
    await abrirGravado();

    fireEvent.change(quantidade(), { target: { value: "12" } });
    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Posição de Estoque" })).toBeNull();
  });

  it("reescrever o MESMO decimal não é alteração", async () => {
    const user = userEvent.setup();
    await abrirGravado();

    fireEvent.change(quantidade(), { target: { value: "10,0" } });
    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("salvar limpa a pendência", async () => {
    const user = userEvent.setup();
    vi.mocked(updateCustomerOrder).mockResolvedValue(pedido({ notes: "Conferir com o cliente" }));
    await abrirGravado();

    fireEvent.change(observacoes(), { target: { value: "Conferir com o cliente" } });
    await user.click(screen.getByRole("button", { name: /Salvar rascunho/ }));
    await waitFor(() => expect(updateCustomerOrder).toHaveBeenCalledTimes(1));

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("voltar pelo navegador com alteração pendente também pergunta", async () => {
    const user = userEvent.setup();
    vi.mocked(getCustomerOrder).mockResolvedValue(pedido());
    const router = montar(["/estoque", "/comercial/pedidos/co-1"], 1);
    await screen.findByRole("heading", { name: "PED-000001" });

    fireEvent.change(observacoes(), { target: { value: "Entrega em duas etapas" } });
    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
  });

  it("o aviso do navegador acompanha a pendência", async () => {
    await abrirGravado();

    expect(avisaAoFechar()).toBe(false);

    fireEvent.change(observacoes(), { target: { value: "Entrega em duas etapas" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(true));

    fireEvent.change(observacoes(), { target: { value: "" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(false));
  });
});

/** O aviso nativo de F5 / fechar aba só existe quando alguém o registra. */
function avisaAoFechar(): boolean {
  const evento = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(evento);
  return evento.defaultPrevented;
}
