import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { CustomerListResponse, CustomerOrderDTO, CustomerOrderListResponse } from "@veridi/shared";
import type { BulkSelection, BulkSelectionOptions } from "../../components/BulkSelection";

/**
 * Pedidos — piloto da seleção em massa (BULK-SELECTION-FOUNDATION-01).
 *
 * A listagem tem 300 pedidos no filtro e mostra 20. O que se prova aqui é a
 * foundation ligada à tela de verdade: o cabeçalho marca 20, o CTA fala 300,
 * "todos os filtrados" não busca id nenhum, a exceção desconta um, a página
 * preserva e o filtro limpa — com o recorte que a tela manda para a consulta.
 */

const espiao = vi.hoisted(() => ({ atual: null as unknown }));

vi.mock("../../components/BulkSelection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../components/BulkSelection")>();
  return {
    ...real,
    useBulkSelection: <F extends object>(opcoes: BulkSelectionOptions<F>) => {
      const selecao = real.useBulkSelection(opcoes);
      espiao.atual = selecao;
      return selecao;
    },
  };
});
vi.mock("../../lib/customer-orders-api", () => ({ listCustomerOrders: vi.fn() }));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));

import { listCustomerOrders } from "../../lib/customer-orders-api";
import { listCustomers } from "../../lib/customers-api";
import { clearStoredFilters } from "../../lib/stored-filters";
import { CustomerOrdersPage } from "./CustomerOrdersPage";

const EM_ABERTO = ["DRAFT", "CONFIRMED", "IN_FULFILLMENT", "PARTIALLY_SHIPPED"];
const TOTAL = 300;

const CLIENTES = {
  customers: [{ id: "cli-1", code: "CLI-000001", legalName: "NutriViva Ltda", tradeName: "NutriViva", cnpj: null }],
  page: 1,
  pageSize: 20,
  total: 1,
} as unknown as CustomerListResponse;

function pedido(n: number): CustomerOrderDTO {
  return {
    id: `co-${n}`,
    code: `PED-${String(n).padStart(6, "0")}`,
    customerId: "cli-1",
    customerName: "NutriViva",
    orderDate: "2026-09-10T12:00:00.000Z",
    requestedDeliveryDate: null,
    status: "CONFIRMED",
    billingStatus: "NOT_BILLED",
    lines: [],
    reservation: null,
    generatedProductionOrders: [],
  } as unknown as CustomerOrderDTO;
}

function paginaDe(numero: number): CustomerOrderDTO[] {
  return Array.from({ length: 20 }, (_, indice) => pedido((numero - 1) * 20 + indice + 1));
}

type Consulta = NonNullable<Parameters<typeof listCustomerOrders>[0]>;
const chamadas = () => vi.mocked(listCustomerOrders).mock.calls.map(([params]) => params as Consulta);
const selecao = () => espiao.atual as BulkSelection<Record<string, unknown>>;

const cabecalho = () =>
  screen.getByLabelText("Selecionar todos os registros desta página") as HTMLInputElement;
const caixa = (n: number) =>
  screen.getByLabelText(`Selecionar pedido PED-${String(n).padStart(6, "0")}`) as HTMLInputElement;
const barra = () => screen.queryByRole("group", { name: "Seleção em massa" });
const contagem = () => barra()?.querySelector(".bulk-bar__count")?.textContent ?? null;

function Endereco() {
  const local = useLocation();
  return <output data-testid="endereco">{`${local.pathname}${local.search}`}</output>;
}

async function abrir(url = "/comercial/pedidos", primeiro = 1) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <CustomerOrdersPage />
      <Endereco />
    </MemoryRouter>,
  );
  await waitFor(() => expect(caixa(primeiro)).not.toBeDisabled());
}

async function todosOsFiltrados() {
  fireEvent.click(cabecalho());
  fireEvent.click(screen.getByRole("button", { name: `Selecionar todos os ${TOTAL} resultados filtrados` }));
  await waitFor(() => expect(contagem()).toBe(`${TOTAL} selecionados`));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  clearStoredFilters("u-1", "customer-orders");
  espiao.atual = null;
  vi.mocked(listCustomerOrders).mockReset();
  vi.mocked(listCustomerOrders).mockImplementation(
    async (params) =>
      ({
        customerOrders: paginaDe(params?.page ?? 1),
        page: params?.page ?? 1,
        pageSize: 20,
        total: TOTAL,
      }) as unknown as CustomerOrderListResponse,
  );
  vi.mocked(listCustomers).mockReset();
  vi.mocked(listCustomers).mockResolvedValue(CLIENTES);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("página × todos os filtrados", () => {
  it("o cabeçalho marca os 20 da página — o filtro tem 300 e eles continuam fora", async () => {
    await abrir();
    fireEvent.click(cabecalho());

    expect(contagem()).toBe("20 selecionados");
    for (let n = 1; n <= 20; n += 1) expect(caixa(n).checked).toBe(true);
    expect(selecao().descriptor).toEqual({
      mode: "ids",
      ids: Array.from({ length: 20 }, (_, indice) => `co-${indice + 1}`),
    });
  });

  it("o CTA fala 300 e só existe com a página inteira marcada", async () => {
    await abrir();
    const cta = () => screen.queryByRole("button", { name: "Selecionar todos os 300 resultados filtrados" });
    fireEvent.click(caixa(1));
    expect(cta()).toBeNull();

    fireEvent.click(cabecalho());
    expect(cta()).not.toBeNull();
    fireEvent.click(caixa(4));
    expect(cta()).toBeNull();
  });

  it("todos os filtrados = 300, sem buscar id nenhum no navegador", async () => {
    await abrir();
    const antes = chamadas().length;
    await todosOsFiltrados();

    expect(barra()?.querySelector(".bulk-bar__scope")?.textContent).toBe(
      "Todos os 300 resultados filtrados estão selecionados.",
    );
    expect(chamadas()).toHaveLength(antes);
    for (const consulta of chamadas()) expect(consulta.pageSize).toBe(20);
    expect(selecao().descriptor).toEqual({ mode: "filtered", filters: { status: EM_ABERTO }, excludedIds: [] });
  });

  it("desmarcar um pedido: 299, e a exceção leva o id estável", async () => {
    await abrir();
    await todosOsFiltrados();
    fireEvent.click(caixa(3));

    expect(contagem()).toBe("299 selecionados");
    expect(selecao().descriptor).toEqual({
      mode: "filtered",
      filters: { status: EM_ABERTO },
      excludedIds: ["co-3"],
    });
  });
});

describe("paginação", () => {
  it("em todos os filtrados, a página 2 chega marcada e a volta mantém a exceção", async () => {
    await abrir();
    await todosOsFiltrados();
    fireEvent.click(caixa(3));

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(caixa(21)).not.toBeDisabled());
    expect(caixa(21).checked).toBe(true);
    expect(cabecalho().checked).toBe(true);
    expect(contagem()).toBe("299 selecionados");

    fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
    await waitFor(() => expect(caixa(1)).not.toBeDisabled());
    expect(caixa(3).checked).toBe(false);
    expect(caixa(4).checked).toBe(true);
    expect(cabecalho().indeterminate).toBe(true);
  });

  it("seleção por id atravessa página e volta restaurada", async () => {
    await abrir();
    fireEvent.click(caixa(2));
    fireEvent.click(caixa(7));

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(caixa(21)).not.toBeDisabled());
    fireEvent.click(caixa(25));
    expect(contagem()).toBe("3 selecionados");

    fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
    await waitFor(() => expect(caixa(1)).not.toBeDisabled());
    expect(caixa(2).checked).toBe(true);
    expect(caixa(7).checked).toBe(true);
    expect(selecao().descriptor).toEqual({ mode: "ids", ids: ["co-2", "co-7", "co-25"] });
  });
});

describe("filtro muda → 0", () => {
  it("trocar o status limpa todos os filtrados", async () => {
    await abrir();
    await todosOsFiltrados();

    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "CONFIRMED" } });
    await waitFor(() => expect(barra()).toBeNull());
    expect(selecao().descriptor).toBeNull();
    await waitFor(() => expect(chamadas().at(-1)?.status).toEqual(["CONFIRMED"]));
    await waitFor(() => expect(caixa(1)).not.toBeDisabled());
    expect(caixa(1).checked).toBe(false);
  });

  it("buscar também limpa (depois do debounce que aplica o filtro)", async () => {
    await abrir();
    fireEvent.click(caixa(1));
    expect(contagem()).toBe("1 selecionado");

    fireEvent.change(screen.getByLabelText("Buscar pedidos"), { target: { value: "PED-0001" } });
    await waitFor(() => expect(chamadas().at(-1)?.search).toBe("PED-0001"));
    expect(barra()).toBeNull();
  });

  it("tirar o cliente do link também limpa", async () => {
    await abrir("/comercial/pedidos?customerId=cli-1");
    fireEvent.click(cabecalho());
    expect(contagem()).toBe("20 selecionados");

    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Cliente" }));
    await waitFor(() => expect(barra()).toBeNull());
  });

  it("o descritor carrega o recorte da tela — status, cliente e busca", async () => {
    await abrir("/comercial/pedidos?customerId=cli-1&search=PED&status=PARTIALLY_SHIPPED");
    await todosOsFiltrados();
    expect(selecao().descriptor).toEqual({
      mode: "filtered",
      filters: { customerId: "cli-1", search: "PED", status: ["PARTIALLY_SHIPPED"] },
      excludedIds: [],
    });
    // O recorte do descritor é o da consulta que a tela fez.
    expect(chamadas().at(-1)).toMatchObject({ customerId: "cli-1", search: "PED", status: ["PARTIALLY_SHIPPED"] });
  });
});

describe("a tabela continua sendo a de Pedidos", () => {
  it("a caixa não abre o pedido; a linha continua abrindo", async () => {
    await abrir();
    fireEvent.click(caixa(1));
    expect(screen.getByTestId("endereco").textContent).toBe("/comercial/pedidos");

    fireEvent.click(screen.getByText("PED-000001"));
    expect(screen.getByTestId("endereco").textContent).toBe("/comercial/pedidos/co-1");
  });

  it("seleção não vai para a URL nem para a sessão", async () => {
    await abrir("/comercial/pedidos?status=todos");
    await todosOsFiltrados();
    fireEvent.click(caixa(3));

    expect(screen.getByTestId("endereco").textContent).toBe("/comercial/pedidos?status=todos");
    const guardado = Object.keys(sessionStorage)
      .map((chave) => `${chave}=${sessionStorage.getItem(chave)}`)
      .join("\n");
    expect(guardado).not.toMatch(/co-3|filtered|excluded|selec/i);
  });

  it("lista vazia: a coluna de seleção entra no colSpan e o cabeçalho fica inerte", async () => {
    vi.mocked(listCustomerOrders).mockResolvedValue({
      customerOrders: [],
      page: 1,
      pageSize: 20,
      total: 0,
    } as unknown as CustomerOrderListResponse);
    const { container } = render(
      <MemoryRouter initialEntries={["/comercial/pedidos"]}>
        <CustomerOrdersPage />
      </MemoryRouter>,
    );
    const vazio = await waitFor(() => {
      const celula = container.querySelector("td.table__empty") as HTMLTableCellElement | null;
      expect(celula).not.toBeNull();
      return celula as HTMLTableCellElement;
    });
    expect(vazio.colSpan).toBe(container.querySelectorAll("thead th").length);
    expect(cabecalho()).toBeDisabled();
  });
});
