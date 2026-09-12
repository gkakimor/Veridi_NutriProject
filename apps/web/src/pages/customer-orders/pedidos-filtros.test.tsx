import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CustomerListResponse, CustomerOrderDTO, CustomerOrderListResponse } from "@veridi/shared";

/**
 * Pedidos — fila operacional sobre a foundation de filtros
 * (FILTER-OPERATIONS-WAVE-03).
 *
 * O que estava no lugar, confirmado no código antes de mexer:
 *
 * 1. **Abria em todos os status.** A fila de trabalho do comercial é o que
 *    ainda está em aberto; decisão de Product Ownership já tomada.
 * 2. **Merge por campo.** `usePersistentFilter` aplicava o `?customerId=` do
 *    link "Pedidos" do Cliente e deixava a busca e o status caírem na
 *    lembrança da sessão — o link do Cliente X podia abrir filtrado também
 *    por uma busca que ninguém via.
 * 3. **Catálogo com teto.** O cliente era um `<select>` com
 *    `listCustomers({ pageSize: 1000 })`.
 */

vi.mock("../../lib/customer-orders-api", () => ({ listCustomerOrders: vi.fn() }));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));

import { listCustomerOrders } from "../../lib/customer-orders-api";
import { listCustomers } from "../../lib/customers-api";
import { clearStoredFilters, filterStorageKey } from "../../lib/stored-filters";
import { CustomerOrdersPage } from "./CustomerOrdersPage";

const EM_ABERTO = ["DRAFT", "CONFIRMED", "IN_FULFILLMENT", "PARTIALLY_SHIPPED"];

const CLIENTES = {
  customers: [
    { id: "cli-1", code: "CLI-000001", legalName: "NutriViva Ltda", tradeName: "NutriViva", cnpj: null },
    { id: "cli-2", code: "CLI-000002", legalName: "Vita Forte SA", tradeName: null, cnpj: null },
  ],
  page: 1,
  pageSize: 20,
  total: 2,
} as unknown as CustomerListResponse;

function resposta(customerOrders: CustomerOrderDTO[] = [], total = customerOrders.length) {
  return { customerOrders, page: 1, pageSize: 20, total } as unknown as CustomerOrderListResponse;
}

type Consulta = NonNullable<Parameters<typeof listCustomerOrders>[0]>;

const chamadas = () => vi.mocked(listCustomerOrders).mock.calls;
const ultimaConsulta = () => chamadas()[chamadas().length - 1]?.[0] as Consulta;

function linkDoCsv(): URL {
  const link = screen.getByRole("link", { name: "Exportar CSV" });
  return new URL(link.getAttribute("href") ?? "", "http://exemplo.invalid");
}

async function abrir(url = "/comercial/pedidos") {
  const resultado = render(
    <MemoryRouter initialEntries={[url]}>
      <CustomerOrdersPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(listCustomerOrders).toHaveBeenCalled());
  return resultado;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  clearStoredFilters("u-1", "customer-orders");
  vi.mocked(listCustomerOrders).mockReset();
  vi.mocked(listCustomerOrders).mockResolvedValue(resposta());
  vi.mocked(listCustomers).mockReset();
  vi.mocked(listCustomers).mockResolvedValue(CLIENTES);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fila padrão: EM ABERTO", () => {
  it("abre em Em aberto — os quatro status que ainda pedem trabalho, numa consulta só", async () => {
    await abrir();
    expect(chamadas()).toHaveLength(1);
    expect(ultimaConsulta().status).toEqual(EM_ABERTO);
    expect(screen.getByLabelText("Filtrar por status")).toHaveValue("em-aberto");
  });

  it("Expedido e Cancelado ficam fora do default", async () => {
    await abrir();
    expect(ultimaConsulta().status).not.toContain("SHIPPED");
    expect(ultimaConsulta().status).not.toContain("CANCELLED");
  });

  it("o default não é chip", async () => {
    await abrir();
    expect(screen.queryByText(/^Filtros \(/)).toBeNull();
  });

  it("nenhum status inventado: Em aberto, Todos e os seis do domínio", async () => {
    await abrir();
    const opcoes = [...screen.getByLabelText("Filtrar por status").querySelectorAll("option")];
    expect(opcoes.map((opcao) => opcao.textContent)).toEqual([
      "Em aberto",
      "Todos os status",
      "Rascunho",
      "Confirmado",
      "Em atendimento",
      "Parcialmente expedido",
      "Expedido",
      "Cancelado",
    ]);
  });

  it("fila vazia oferece o histórico em vez de parecer base vazia", async () => {
    await abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Ver todos" }));
    await waitFor(() => expect(ultimaConsulta().status).toBeUndefined());
  });
});

describe("Todos e status específico", () => {
  it("Todos consulta sem status e vira chip", async () => {
    const { container } = await abrir();
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "todos" } });
    await waitFor(() => expect(ultimaConsulta().status).toBeUndefined());

    const chips = container.querySelector(".filter-chips") as HTMLElement;
    expect(within(chips).getByText("Todos os status")).toBeInTheDocument();
  });

  it("um status específico consulta só ele", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "SHIPPED" } });
    await waitFor(() => expect(ultimaConsulta().status).toEqual(["SHIPPED"]));
  });

  it("a URL fala o status do domínio", async () => {
    await abrir("/comercial/pedidos?status=CANCELLED");
    expect(ultimaConsulta().status).toEqual(["CANCELLED"]);
    expect(screen.getByLabelText("Filtrar por status")).toHaveValue("CANCELLED");
  });

  it("status desconhecido na URL cai em Em aberto em vez de gerar consulta inválida", async () => {
    await abrir("/comercial/pedidos?status=NAO_EXISTE");
    expect(ultimaConsulta().status).toEqual(EM_ABERTO);
  });

  it("remover o chip de status devolve EM ABERTO, não a base inteira", async () => {
    await abrir("/comercial/pedidos?status=todos");
    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Status" }));
    await waitFor(() => expect(ultimaConsulta().status).toEqual(EM_ABERTO));
  });
});

describe("cliente e contexto do link", () => {
  it("`?customerId=` do cadastro do Cliente é filtro real", async () => {
    await abrir("/comercial/pedidos?customerId=cli-1");
    expect(ultimaConsulta()).toMatchObject({ customerId: "cli-1", status: EM_ABERTO });
  });

  it("o chip nomeia o cliente mesmo com a lista VAZIA", async () => {
    const { container } = await abrir("/comercial/pedidos?customerId=cli-2");
    const chips = await waitFor(() => {
      const alvo = container.querySelector(".filter-chips") as HTMLElement | null;
      expect(alvo).not.toBeNull();
      return alvo as HTMLElement;
    });
    await waitFor(() =>
      expect(within(chips).getByText(/CLI-000002 · Vita Forte SA/)).toBeInTheDocument(),
    );
  });

  it("o cliente tem busca no SERVIDOR — nada de catálogo de 1000", async () => {
    await abrir();
    await waitFor(() => expect(listCustomers).toHaveBeenCalled());
    for (const [params] of vi.mocked(listCustomers).mock.calls) {
      expect(params?.pageSize ?? 20).toBeLessThanOrEqual(20);
    }
  });

  it("um id vindo da URL é resolvido por identidade, fora da primeira página", async () => {
    await abrir("/comercial/pedidos?customerId=cli-9");
    await waitFor(() =>
      expect(
        vi.mocked(listCustomers).mock.calls.some(([params]) => params?.ids?.[0] === "cli-9"),
      ).toBe(true),
    );
  });

  it("remover o chip do cliente devolve a fila sem contexto", async () => {
    await abrir("/comercial/pedidos?customerId=cli-1");
    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Cliente" }));
    await waitFor(() => expect(ultimaConsulta().customerId).toBeUndefined());
  });
});

describe("URL não herda a sessão", () => {
  async function deixarResiduoNaSessao() {
    const primeira = await abrir();
    fireEvent.change(screen.getByLabelText("Buscar pedidos"), { target: { value: "RESIDUO" } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ search: "RESIDUO" }));
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "SHIPPED" } });
    await waitFor(() => expect(ultimaConsulta().status).toEqual(["SHIPPED"]));
    primeira.unmount();
    expect(sessionStorage.getItem(filterStorageKey("u-1", "customer-orders", "search"))).toBe(
      '"RESIDUO"',
    );
  }

  it("o link do Cliente X abre SÓ o Cliente X, na fila padrão", async () => {
    await deixarResiduoNaSessao();

    vi.mocked(listCustomerOrders).mockClear();
    await abrir("/comercial/pedidos?customerId=cli-1");

    const consulta = ultimaConsulta();
    expect(consulta.customerId).toBe("cli-1");
    expect(consulta.search).toBeUndefined();
    expect(consulta.status).toEqual(EM_ABERTO);
  });

  it("chegar pelo link não reescreve a lembrança de quem clicou", async () => {
    await deixarResiduoNaSessao();
    const outra = await abrir("/comercial/pedidos?customerId=cli-1");
    outra.unmount();
    expect(sessionStorage.getItem(filterStorageKey("u-1", "customer-orders", "customerId"))).toBeNull();
  });

  it("sem NADA na URL, a sessão continua valendo", async () => {
    await deixarResiduoNaSessao();

    vi.mocked(listCustomerOrders).mockClear();
    await abrir();
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ search: "RESIDUO", status: ["SHIPPED"] }),
    );
  });

  it("`Limpar filtros` limpa tudo — inclusive o cliente do link — e volta à fila", async () => {
    await abrir("/comercial/pedidos?customerId=cli-1&status=todos&search=PED-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0] as HTMLElement);
    await waitFor(() => {
      const consulta = ultimaConsulta();
      expect(consulta.customerId).toBeUndefined();
      expect(consulta.search).toBeUndefined();
      expect(consulta.status).toEqual(EM_ABERTO);
    });
  });
});

describe("busca e paginação", () => {
  it("busca com debounce", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Buscar pedidos"), { target: { value: "PED-000123" } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ search: "PED-000123" }));
  });

  it("total do servidor, paginação explícita e recorte preservado", async () => {
    vi.mocked(listCustomerOrders).mockResolvedValue(resposta([], 250));
    await abrir();

    expect(await screen.findByText("250 pedidos")).toBeInTheDocument();
    expect(screen.getByText("Página 1 de 13")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(ultimaConsulta().page).toBe(2));
    expect(ultimaConsulta().status).toEqual(EM_ABERTO);
    expect(ultimaConsulta().pageSize).toBe(20);
  });

  it("trocar filtro volta para a página 1", async () => {
    vi.mocked(listCustomerOrders).mockResolvedValue(resposta([], 250));
    await abrir("/comercial/pedidos?page=3");
    expect(ultimaConsulta().page).toBe(3);

    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "CONFIRMED" } });
    await waitFor(() => expect(ultimaConsulta().page).toBe(1));
  });
});

describe("CSV — mesma consulta da tela", () => {
  it("a fila padrão exporta Em aberto", async () => {
    await abrir();
    expect(linkDoCsv().searchParams.get("status")).toBe(EM_ABERTO.join(","));
  });

  it("cliente, status e busca chegam iguais; paginação não", async () => {
    await abrir("/comercial/pedidos?customerId=cli-1&status=PARTIALLY_SHIPPED&search=PED-1&page=2");
    const consulta = ultimaConsulta();
    const params = linkDoCsv().searchParams;

    expect(params.get("customerId")).toBe(consulta.customerId ?? null);
    expect(params.get("status")).toBe((consulta.status as string[]).join(","));
    expect(params.get("search")).toBe(consulta.search ?? null);
    expect(params.get("page")).toBeNull();
    expect(params.get("pageSize")).toBeNull();
  });

  it("Todos exporta sem status — o histórico inteiro que a tela mostra", async () => {
    await abrir("/comercial/pedidos?status=todos");
    expect(ultimaConsulta().status).toBeUndefined();
    expect(linkDoCsv().searchParams.get("status")).toBeNull();
  });
});
