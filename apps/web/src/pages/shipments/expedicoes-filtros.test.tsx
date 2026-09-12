import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  CustomerOrderDTO,
  CustomerOrderListResponse,
  ShipmentDTO,
  ShipmentListResponse,
} from "@veridi/shared";

/**
 * Expedições — fila operacional sobre a foundation de filtros
 * (FILTER-OPERATIONS-WAVE-03).
 *
 * O ciclo da Expedição é rascunho → confirmada | cancelada. Só o rascunho
 * ainda pede trabalho nesta tela (conferir lotes, confirmar a saída); a
 * confirmada que falta faturar tem fila própria no Faturamento. Por isso o
 * default é o rascunho.
 *
 * Antes: filtros em `useState` (nenhum endereço, nada sobrevivia a abrir uma
 * expedição e voltar), abertura em todos os status, e o filtro por pedido que
 * a API sempre aceitou (`customerOrderId`) não existia na tela.
 *
 * Paginação e corte: a lista já paginava no banco (`skip`/`take` + `count`
 * com o mesmo `where`), com `pageSize` 20 e total do servidor. Os testes
 * abaixo protegem isso; não havia corte a corrigir.
 */

vi.mock("../../lib/shipments-api", () => ({ listShipments: vi.fn() }));
vi.mock("../../lib/customer-orders-api", () => ({
  listCustomerOrders: vi.fn(),
  getCustomerOrder: vi.fn(),
}));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));

import { listShipments } from "../../lib/shipments-api";
import { getCustomerOrder, listCustomerOrders } from "../../lib/customer-orders-api";
import { clearStoredFilters, filterStorageKey } from "../../lib/stored-filters";
import { ShipmentsPage } from "./ShipmentsPage";

function pedido(id: string, code: string, customerName: string): CustomerOrderDTO {
  return { id, code, customerName, customerId: `cli-${id}` } as unknown as CustomerOrderDTO;
}

const PEDIDOS = {
  customerOrders: [pedido("co-1", "PED-000001", "NutriViva")],
  page: 1,
  pageSize: 20,
  total: 1,
} as unknown as CustomerOrderListResponse;

function resposta(shipments: ShipmentDTO[] = [], total = shipments.length): ShipmentListResponse {
  return { shipments, page: 1, pageSize: 20, total } as unknown as ShipmentListResponse;
}

type Consulta = NonNullable<Parameters<typeof listShipments>[0]>;

const chamadas = () => vi.mocked(listShipments).mock.calls;
const ultimaConsulta = () => chamadas()[chamadas().length - 1]?.[0] as Consulta;

function linkDoCsv(): URL {
  const link = screen.getByRole("link", { name: "Exportar CSV" });
  return new URL(link.getAttribute("href") ?? "", "http://exemplo.invalid");
}

async function abrir(url = "/comercial/expedicoes") {
  const resultado = render(
    <MemoryRouter initialEntries={[url]}>
      <ShipmentsPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(listShipments).toHaveBeenCalled());
  return resultado;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  clearStoredFilters("u-1", "shipments");
  vi.mocked(listShipments).mockReset();
  vi.mocked(listShipments).mockResolvedValue(resposta());
  vi.mocked(listCustomerOrders).mockReset();
  vi.mocked(listCustomerOrders).mockResolvedValue(PEDIDOS);
  vi.mocked(getCustomerOrder).mockReset();
  vi.mocked(getCustomerOrder).mockResolvedValue(pedido("co-7", "PED-000007", "Vita Forte"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("default operacional", () => {
  it("abre no rascunho — o que ainda exige conferência e confirmação", async () => {
    await abrir();
    expect(chamadas()).toHaveLength(1);
    expect(ultimaConsulta().status).toBe("DRAFT");
    expect(screen.getByLabelText("Filtrar por status")).toHaveValue("em-aberto");
    expect(screen.queryByText(/^Filtros \(/)).toBeNull();
  });

  it("as escolhas são as do domínio, sem Rascunho repetido ao lado de Em aberto", async () => {
    await abrir();
    const opcoes = [...screen.getByLabelText("Filtrar por status").querySelectorAll("option")];
    expect(opcoes.map((opcao) => opcao.textContent)).toEqual([
      "Em aberto",
      "Todos os status",
      "Confirmada",
      "Cancelada",
    ]);
  });

  it("Todos consulta sem status — confirmadas e canceladas não ficam inalcançáveis", async () => {
    const { container } = await abrir();
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "todos" } });
    await waitFor(() => expect(ultimaConsulta().status).toBeUndefined());
    const chips = container.querySelector(".filter-chips") as HTMLElement;
    expect(within(chips).getByText("Todos os status")).toBeInTheDocument();
  });

  it("status específico, e o chip volta para o default", async () => {
    await abrir("/comercial/expedicoes?status=CONFIRMED");
    expect(ultimaConsulta().status).toBe("CONFIRMED");

    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Status" }));
    await waitFor(() => expect(ultimaConsulta().status).toBe("DRAFT"));
  });

  it("fila vazia oferece o histórico", async () => {
    await abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Ver todas" }));
    await waitFor(() => expect(ultimaConsulta().status).toBeUndefined());
  });
});

describe("pedido e contexto por link", () => {
  it("`?customerOrderId=` filtra a consulta", async () => {
    await abrir("/comercial/expedicoes?customerOrderId=co-1");
    expect(ultimaConsulta()).toMatchObject({ customerOrderId: "co-1", status: "DRAFT" });
  });

  it("o chip nomeia o pedido resolvido por identidade, mesmo com a lista vazia", async () => {
    const { container } = await abrir("/comercial/expedicoes?customerOrderId=co-7");
    await waitFor(() => expect(getCustomerOrder).toHaveBeenCalledWith("co-7"));
    const chips = container.querySelector(".filter-chips") as HTMLElement;
    await waitFor(() =>
      expect(within(chips).getByText(/PED-000007 · Vita Forte/)).toBeInTheDocument(),
    );
  });

  it("o pedido tem busca no servidor, com página curta", async () => {
    await abrir();
    await waitFor(() => expect(listCustomerOrders).toHaveBeenCalled());
    for (const [params] of vi.mocked(listCustomerOrders).mock.calls) {
      expect(params?.pageSize ?? 20).toBeLessThanOrEqual(20);
    }
  });

  it("o link não herda a busca nem o status da sessão", async () => {
    const primeira = await abrir();
    fireEvent.change(screen.getByLabelText("Buscar expedições"), { target: { value: "RESIDUO" } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ search: "RESIDUO" }));
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "CANCELLED" } });
    await waitFor(() => expect(ultimaConsulta().status).toBe("CANCELLED"));
    primeira.unmount();
    expect(sessionStorage.getItem(filterStorageKey("u-1", "shipments", "status"))).toBe('"CANCELLED"');

    vi.mocked(listShipments).mockClear();
    await abrir("/comercial/expedicoes?customerOrderId=co-1");
    const consulta = ultimaConsulta();
    expect(consulta.customerOrderId).toBe("co-1");
    expect(consulta.search).toBeUndefined();
    expect(consulta.status).toBe("DRAFT");
  });

  it("sem nada na URL, a sessão restaura a escolha", async () => {
    const primeira = await abrir();
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "CONFIRMED" } });
    await waitFor(() => expect(ultimaConsulta().status).toBe("CONFIRMED"));
    primeira.unmount();

    vi.mocked(listShipments).mockClear();
    await abrir();
    await waitFor(() => expect(ultimaConsulta().status).toBe("CONFIRMED"));
  });

  it("`Limpar filtros` remove o pedido do link — nenhum filtro invisível fica", async () => {
    await abrir("/comercial/expedicoes?customerOrderId=co-1&search=EXP-1&status=todos");
    expect(screen.getByText("Filtros (3)")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0] as HTMLElement);
    await waitFor(() => {
      const consulta = ultimaConsulta();
      expect(consulta.customerOrderId).toBeUndefined();
      expect(consulta.search).toBeUndefined();
      expect(consulta.status).toBe("DRAFT");
    });
    expect(screen.queryByText(/^Filtros \(/)).toBeNull();
  });
});

describe("paginação sem corte", () => {
  it("uma consulta, `pageSize` 20, total do servidor", async () => {
    vi.mocked(listShipments).mockResolvedValue(resposta([], 45));
    await abrir();

    expect(chamadas()).toHaveLength(1);
    expect(ultimaConsulta().pageSize).toBe(20);
    expect(await screen.findByText("45 expedições")).toBeInTheDocument();
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
  });

  it("Próxima pede a página 2 com o mesmo recorte; trocar filtro volta à 1", async () => {
    vi.mocked(listShipments).mockResolvedValue(resposta([], 45));
    await abrir("/comercial/expedicoes?status=todos");

    fireEvent.click(await screen.findByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(ultimaConsulta().page).toBe(2));
    expect(ultimaConsulta().status).toBeUndefined();

    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "CONFIRMED" } });
    await waitFor(() => expect(ultimaConsulta().page).toBe(1));
  });

  it("busca com debounce", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Buscar expedições"), { target: { value: "PED-000001" } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ search: "PED-000001" }));
  });
});

describe("CSV — mesma consulta da tela", () => {
  it("default, pedido, status e busca chegam iguais; paginação não", async () => {
    await abrir("/comercial/expedicoes?customerOrderId=co-1&search=EXP-1&page=2");
    const consulta = ultimaConsulta();
    const params = linkDoCsv().searchParams;

    expect(params.get("status")).toBe("DRAFT");
    expect(params.get("status")).toBe(consulta.status ?? null);
    expect(params.get("customerOrderId")).toBe(consulta.customerOrderId ?? null);
    expect(params.get("search")).toBe(consulta.search ?? null);
    expect(params.get("page")).toBeNull();
    expect(params.get("pageSize")).toBeNull();
  });

  it("Todos exporta sem status", async () => {
    await abrir("/comercial/expedicoes?status=todos");
    expect(linkDoCsv().searchParams.get("status")).toBeNull();
  });
});
