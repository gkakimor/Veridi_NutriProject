import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CustomerOrderDTO } from "@veridi/shared";

/**
 * ORDER-CUSTOMER-PRODUCT-01 — o catálogo do Pedido é o do cliente do Pedido.
 *
 * O que existia: a tela pedia `listProducts` sem `customerId` e oferecia o
 * catálogo inteiro. Quem montava um Pedido do Cliente A podia escolher
 * produto do Cliente B, salvar, confirmar — e só descobria o problema muito
 * depois, ao gerar a Ordem de Produção.
 *
 * O que estes testes fixam:
 *
 * 1. **Ordem obrigatória.** Sem cliente não há produto a oferecer, e a tela
 *    diz isso em vez de deixar um campo mudo.
 * 2. **O filtro é do SERVIDOR.** `listProducts` recebe `customerId`; nada é
 *    filtrado no navegador, porque o navegador só enxerga a página carregada.
 * 3. **Trocar de cliente troca o catálogo** — e a resposta atrasada do
 *    cliente anterior não aparece no seletor do novo.
 * 4. **Com produto no pedido, o cliente trava.** Nem apagar linhas em
 *    cascata, nem manter a mistura.
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

import { getCustomerOrder, getFulfillmentPlan } from "../../lib/customer-orders-api";
import { listCustomers } from "../../lib/customers-api";
import { listProducts } from "../../lib/products-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { getReservationStatus } from "../../lib/shipments-api";
import { CustomerOrderPage } from "./CustomerOrderPage";

const CLIENTE_A = { id: "cli-a", code: "CLI-000001", legalName: "Alfa Suplementos Ltda", tradeName: "Alfa" };
const CLIENTE_B = { id: "cli-b", code: "CLI-000002", legalName: "Beta Nutrição Ltda", tradeName: "Beta" };

const PRODUTO_A = {
  id: "prod-a",
  code: "PROD-000101",
  name: "Whey Alfa 900g",
  customerId: CLIENTE_A.id,
  finishedProductItem: { id: "pa-a", code: "PA-000101", name: "Whey Alfa 900g" },
};
const PRODUTO_B = {
  id: "prod-b",
  code: "PROD-000202",
  name: "Creatina Beta 300g",
  customerId: CLIENTE_B.id,
  finishedProductItem: { id: "pa-b", code: "PA-000202", name: "Creatina Beta 300g" },
};

/** O catálogo como o SERVIDOR o devolve: só o do cliente pedido. */
function catalogoPorCliente(customerId?: string) {
  const todos = [PRODUTO_A, PRODUTO_B];
  const doCliente = customerId ? todos.filter((p) => p.customerId === customerId) : todos;
  return { products: doCliente, total: doCliente.length, page: 1, pageSize: 50 };
}

function pedidoRascunho(overrides: Partial<CustomerOrderDTO> = {}): CustomerOrderDTO {
  return {
    id: "co-1",
    code: "PED-000001",
    customerId: CLIENTE_A.id,
    customerCode: null,
    customerName: null,
    customerTradeName: null,
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
        productId: PRODUTO_A.id,
        productCode: PRODUTO_A.code,
        productName: PRODUTO_A.name,
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

function renderNovoPedido() {
  render(
    <MemoryRouter initialEntries={["/comercial/pedidos/novo"]}>
      <Routes>
        <Route path="/comercial/pedidos/novo" element={<CustomerOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderPedidoExistente() {
  render(
    <MemoryRouter initialEntries={["/comercial/pedidos/co-1"]}>
      <Routes>
        <Route path="/comercial/pedidos/:id" element={<CustomerOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function campoCliente(): HTMLInputElement {
  return document.getElementById("co-customer") as HTMLInputElement;
}

function campoProduto(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[id^="pedido-produto-"]')!;
}

async function escolherCliente(cliente: { legalName: string; tradeName: string }) {
  const user = userEvent.setup();
  await user.click(campoCliente());
  await user.click(await screen.findByText(cliente.tradeName));
}

/** Últimos parâmetros com que a tela pediu o catálogo ao servidor. */
function ultimaBuscaDeProdutos(): Record<string, unknown> | undefined {
  const calls = vi.mocked(listProducts).mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCustomers).mockResolvedValue({
    customers: [CLIENTE_A, CLIENTE_B],
    total: 2,
  } as never);
  vi.mocked(listProducts).mockImplementation(
    async (params) => catalogoPorCliente(params?.customerId) as never,
  );
  vi.mocked(listSuppliers).mockResolvedValue({ suppliers: [] } as never);
  vi.mocked(getFulfillmentPlan).mockResolvedValue(null as never);
  vi.mocked(getReservationStatus).mockResolvedValue({ lines: [] } as never);
  vi.mocked(getCustomerOrder).mockResolvedValue(pedidoRascunho());
});

describe("Pedido do Cliente — o produto vem do cliente do pedido", () => {
  it("A. sem cliente não há produto a escolher, e a tela diz por quê", async () => {
    renderNovoPedido();

    // Nenhum catálogo é pedido enquanto não há cliente: a tela não busca
    // "todos os produtos" para depois filtrar.
    await waitFor(() => expect(vi.mocked(listCustomers)).toHaveBeenCalled());
    expect(vi.mocked(listProducts)).not.toHaveBeenCalled();

    expect(
      screen.getByText(/Selecione o cliente primeiro — o sistema mostra apenas os produtos vinculados a ele/i),
    ).toBeTruthy();
    const adicionar = screen.getByRole("button", { name: "+ Adicionar produto" }) as HTMLButtonElement;
    expect(adicionar.disabled).toBe(true);

    // Com uma linha aberta e o cliente removido, o campo de produto existe e
    // está desabilitado — com a instrução no lugar do texto de busca.
    const user = userEvent.setup();
    await escolherCliente(CLIENTE_A);
    await user.click(screen.getByRole("button", { name: "+ Adicionar produto" }));
    expect(campoProduto().disabled).toBe(false);

    await user.click(screen.getByRole("button", { name: "Limpar seleção" }));
    await waitFor(() => expect(campoProduto().disabled).toBe(true));
    expect(campoProduto().placeholder).toBe("Selecione o cliente primeiro.");
  });

  it("B/C. escolhido o cliente A, o catálogo pedido é o de A — e o produto de B não aparece", async () => {
    const user = userEvent.setup();
    renderNovoPedido();
    await escolherCliente(CLIENTE_A);

    // O filtro é do servidor, com os mesmos critérios operacionais.
    await waitFor(() =>
      expect(ultimaBuscaDeProdutos()).toMatchObject({
        customerId: CLIENTE_A.id,
        active: true,
        lifecycle: "APPROVED",
      }),
    );

    await user.click(screen.getByRole("button", { name: "+ Adicionar produto" }));
    await user.click(campoProduto());

    expect(await screen.findByText(PRODUTO_A.name)).toBeTruthy();
    expect(screen.queryByText(PRODUTO_B.name)).toBeNull();
  });

  it("C2. buscar pelo nome do produto de outro cliente não o traz — a busca leva o customerId", async () => {
    const user = userEvent.setup();
    renderNovoPedido();
    await escolherCliente(CLIENTE_A);
    await user.click(screen.getByRole("button", { name: "+ Adicionar produto" }));

    await user.click(campoProduto());
    await user.type(campoProduto(), "Creatina");

    await waitFor(() =>
      expect(ultimaBuscaDeProdutos()).toMatchObject({
        customerId: CLIENTE_A.id,
        search: "Creatina",
      }),
    );
    expect(screen.queryByText(PRODUTO_B.name)).toBeNull();
  });

  it("D. trocar de cliente sem linhas refaz a busca com o cliente novo", async () => {
    const user = userEvent.setup();
    renderNovoPedido();
    await escolherCliente(CLIENTE_A);
    await waitFor(() => expect(ultimaBuscaDeProdutos()).toMatchObject({ customerId: CLIENTE_A.id }));

    await user.click(screen.getByRole("button", { name: "Limpar seleção" }));
    await escolherCliente(CLIENTE_B);

    await waitFor(() => expect(ultimaBuscaDeProdutos()).toMatchObject({ customerId: CLIENTE_B.id }));

    await user.click(screen.getByRole("button", { name: "+ Adicionar produto" }));
    await user.click(campoProduto());
    expect(await screen.findByText(PRODUTO_B.name)).toBeTruthy();
    expect(screen.queryByText(PRODUTO_A.name)).toBeNull();
  });

  it("D2. resposta atrasada do cliente anterior não entra no seletor do cliente novo", async () => {
    const user = userEvent.setup();
    let responderA: (() => void) | null = null;
    vi.mocked(listProducts).mockImplementation(async (params) => {
      if (params?.customerId === CLIENTE_A.id) {
        // A resposta de A fica pendurada e só chega DEPOIS da troca.
        return new Promise((resolve) => {
          responderA = () => resolve(catalogoPorCliente(CLIENTE_A.id) as never);
        });
      }
      return catalogoPorCliente(params?.customerId) as never;
    });

    renderNovoPedido();
    await escolherCliente(CLIENTE_A);
    await waitFor(() => expect(responderA).not.toBeNull());

    await user.click(screen.getByRole("button", { name: "Limpar seleção" }));
    await escolherCliente(CLIENTE_B);
    await waitFor(() => expect(ultimaBuscaDeProdutos()).toMatchObject({ customerId: CLIENTE_B.id }));

    responderA!();

    await user.click(screen.getByRole("button", { name: "+ Adicionar produto" }));
    await user.click(campoProduto());
    expect(await screen.findByText(PRODUTO_B.name)).toBeTruthy();
    expect(screen.queryByText(PRODUTO_A.name)).toBeNull();
  });

  it("E. com produto no pedido, o cliente trava — sem apagar linha nenhuma", async () => {
    renderPedidoExistente();

    await waitFor(() => expect(campoCliente()).toBeTruthy());
    expect(campoCliente().disabled).toBe(true);
    expect(
      screen.getByText(/Remova os produtos do pedido antes de alterar o cliente/i),
    ).toBeTruthy();

    // A linha continua na tela: bloquear a troca não é apagar o trabalho.
    expect(screen.getByDisplayValue("10")).toBeTruthy();
  });

  it("E2. removida a linha, o cliente volta a ser editável", async () => {
    const user = userEvent.setup();
    renderPedidoExistente();

    await waitFor(() => expect(campoCliente().disabled).toBe(true));
    await user.click(screen.getByRole("button", { name: "Remover linha" }));

    await waitFor(() => expect(campoCliente().disabled).toBe(false));
    expect(screen.queryByText(/Remova os produtos do pedido antes de alterar o cliente/i)).toBeNull();
  });

  it("F. cliente sem produtos: estado vazio que explica, sem oferecer o de outro cliente", async () => {
    const user = userEvent.setup();
    vi.mocked(listProducts).mockResolvedValue({
      products: [],
      total: 0,
      page: 1,
      pageSize: 50,
    } as never);

    renderNovoPedido();
    await escolherCliente(CLIENTE_A);
    await user.click(screen.getByRole("button", { name: "+ Adicionar produto" }));
    await user.click(campoProduto());

    expect(
      await screen.findByText("Este cliente ainda não possui produtos disponíveis para pedido."),
    ).toBeTruthy();
    expect(screen.queryByText(PRODUTO_B.name)).toBeNull();
  });

  it("pedido herdado com produto de outro cliente abre, avisa e mostra a linha", async () => {
    const inconsistente = pedidoRascunho();
    inconsistente.lines[0]!.productId = PRODUTO_B.id;
    inconsistente.lines[0]!.productCode = PRODUTO_B.code;
    inconsistente.lines[0]!.productName = PRODUTO_B.name;
    inconsistente.lines[0]!.productCustomerMismatch = true;
    vi.mocked(getCustomerOrder).mockResolvedValue(inconsistente);

    renderPedidoExistente();

    expect(
      await screen.findByText(/pertence a outro cliente/i, { selector: ".form-alert" }),
    ).toBeTruthy();
    expect(screen.getByText(/não pode ser confirmado/i)).toBeTruthy();
    // O produto continua legível mesmo fora do catálogo do cliente.
    await waitFor(() =>
      expect(campoProduto().placeholder).toBe(`${PRODUTO_B.code} · ${PRODUTO_B.name}`),
    );
  });
});
