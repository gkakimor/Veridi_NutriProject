import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PurchaseOrderListResponse, SupplierListResponse } from "@veridi/shared";

/**
 * Ordens de Compra — fila operacional sobre a foundation de filtros
 * (FILTER-OPERATIONS-WAVE-03).
 *
 * O que estava no lugar:
 *
 * 1. **Abria em todos os status**, recebidas e canceladas no meio da fila.
 * 2. **Filtros em `useState`**: nenhum endereço reproduzia o recorte, e o
 *    `?supplierId=` do cadastro do Fornecedor não tinha "Limpar filtros".
 * 3. **Fornecedor com teto**: `listSuppliers({ pageSize: 1000 })` num `<select>`.
 * 4. **Sem período.** A API passou a aceitar `dateFrom`/`dateTo` pela data do
 *    pedido, em dia civil — a tela manda `YYYY-MM-DD`, nunca instante.
 *
 * Item: não existe filtro por item na lista de OC, nem link de Item para ela,
 * nem suporte na API. Não foi criado.
 */

vi.mock("../../lib/purchase-orders-api", () => ({ listPurchaseOrders: vi.fn() }));
vi.mock("../../lib/suppliers-api", () => ({ listSuppliers: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));

import { listPurchaseOrders } from "../../lib/purchase-orders-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { clearStoredFilters, filterStorageKey } from "../../lib/stored-filters";
import { PurchaseOrdersPage } from "./PurchaseOrdersPage";

const EM_ABERTO = ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED"];

const FORNECEDORES = {
  suppliers: [
    { id: "sup-1", code: "FOR-000001", legalName: "Insumos Brasil Ltda", tradeName: "Insumos BR" },
    { id: "sup-2", code: "FOR-000002", legalName: "Embala SA", tradeName: null },
  ],
  page: 1,
  pageSize: 20,
  total: 2,
} as unknown as SupplierListResponse;

function resposta(total = 0): PurchaseOrderListResponse {
  return { purchaseOrders: [], page: 1, pageSize: 20, total };
}

type Consulta = NonNullable<Parameters<typeof listPurchaseOrders>[0]>;

const chamadas = () => vi.mocked(listPurchaseOrders).mock.calls;
const ultimaConsulta = () => chamadas()[chamadas().length - 1]?.[0] as Consulta;

function linkDoCsv(): URL {
  const link = screen.getByRole("link", { name: "Exportar CSV" });
  return new URL(link.getAttribute("href") ?? "", "http://exemplo.invalid");
}

async function abrir(url = "/compras/ordens") {
  const resultado = render(
    <MemoryRouter initialEntries={[url]}>
      <PurchaseOrdersPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(listPurchaseOrders).toHaveBeenCalled());
  return resultado;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  clearStoredFilters("u-1", "purchase-orders");
  vi.mocked(listPurchaseOrders).mockReset();
  vi.mocked(listPurchaseOrders).mockResolvedValue(resposta());
  vi.mocked(listSuppliers).mockReset();
  vi.mocked(listSuppliers).mockResolvedValue(FORNECEDORES);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Em aberto, Todos e status", () => {
  it("abre em Em aberto: rascunho, confirmada e recebida parcialmente, numa consulta", async () => {
    await abrir();
    expect(chamadas()).toHaveLength(1);
    expect(ultimaConsulta().status).toEqual(EM_ABERTO);
    expect(ultimaConsulta().status).not.toContain("RECEIVED");
    expect(ultimaConsulta().status).not.toContain("CANCELLED");
    expect(screen.getByLabelText("Filtrar por status")).toHaveValue("em-aberto");
    expect(screen.queryByText(/^Filtros \(/)).toBeNull();
  });

  it("nenhum status inventado", async () => {
    await abrir();
    const opcoes = [...screen.getByLabelText("Filtrar por status").querySelectorAll("option")];
    expect(opcoes.map((opcao) => opcao.textContent)).toEqual([
      "Em aberto",
      "Todos os status",
      "Rascunho",
      "Confirmado",
      "Recebido parcialmente",
      "Recebido",
      "Cancelado",
    ]);
  });

  it("Todos consulta sem status e vira chip", async () => {
    const { container } = await abrir();
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "todos" } });
    await waitFor(() => expect(ultimaConsulta().status).toBeUndefined());
    const chips = container.querySelector(".filter-chips") as HTMLElement;
    expect(within(chips).getByText("Todos os status")).toBeInTheDocument();
  });

  it("status específico, e remover o chip volta para Em aberto", async () => {
    await abrir("/compras/ordens?status=RECEIVED");
    expect(ultimaConsulta().status).toEqual(["RECEIVED"]);

    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Status" }));
    await waitFor(() => expect(ultimaConsulta().status).toEqual(EM_ABERTO));
  });

  it("fila vazia oferece o histórico", async () => {
    await abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Ver todas" }));
    await waitFor(() => expect(ultimaConsulta().status).toBeUndefined());
  });
});

describe("fornecedor e contexto do link", () => {
  it("`?supplierId=` do cadastro do Fornecedor é filtro real, com chip nomeado", async () => {
    const { container } = await abrir("/compras/ordens?supplierId=sup-2");
    expect(ultimaConsulta()).toMatchObject({ supplierId: "sup-2", status: EM_ABERTO });

    const chips = container.querySelector(".filter-chips") as HTMLElement;
    await waitFor(() => expect(within(chips).getByText(/FOR-000002 · Embala SA/)).toBeInTheDocument());
  });

  it("fornecedor com busca no servidor; id da URL resolvido por identidade", async () => {
    await abrir("/compras/ordens?supplierId=sup-9");
    await waitFor(() =>
      expect(
        vi.mocked(listSuppliers).mock.calls.some(([params]) => params?.ids?.[0] === "sup-9"),
      ).toBe(true),
    );
    for (const [params] of vi.mocked(listSuppliers).mock.calls) {
      expect(params?.pageSize ?? 20).toBeLessThanOrEqual(20);
    }
  });

  it("não há filtro por item: não existe suporte nem link, e não foi inventado", async () => {
    await abrir();
    expect(screen.queryByLabelText("Filtrar por item")).toBeNull();
  });

  it("o link do Fornecedor não herda busca, status nem período da sessão", async () => {
    const primeira = await abrir();
    fireEvent.change(screen.getByLabelText("Buscar ordens de compra"), { target: { value: "RESIDUO" } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ search: "RESIDUO" }));
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "CANCELLED" } });
    await waitFor(() => expect(ultimaConsulta().status).toEqual(["CANCELLED"]));
    fireEvent.click(screen.getByRole("button", { name: "Últimos 30 dias" }));
    await waitFor(() => expect(ultimaConsulta().dateFrom).toBeDefined());
    primeira.unmount();
    expect(sessionStorage.getItem(filterStorageKey("u-1", "purchase-orders", "period"))).toBe('"30d"');

    vi.mocked(listPurchaseOrders).mockClear();
    const segunda = await abrir("/compras/ordens?supplierId=sup-1");
    const consulta = ultimaConsulta();
    expect(consulta.supplierId).toBe("sup-1");
    expect(consulta.search).toBeUndefined();
    expect(consulta.dateFrom).toBeUndefined();
    expect(consulta.status).toEqual(EM_ABERTO);
    segunda.unmount();
    expect(sessionStorage.getItem(filterStorageKey("u-1", "purchase-orders", "supplierId"))).toBeNull();

    // Sem nada na URL, a escolha continua lembrada.
    vi.mocked(listPurchaseOrders).mockClear();
    await abrir();
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ search: "RESIDUO", status: ["CANCELLED"] }),
    );
  });

  it("`Limpar filtros` limpa tudo, inclusive o fornecedor do link", async () => {
    await abrir("/compras/ordens?supplierId=sup-1&status=todos&period=7d&search=OC-1");
    expect(screen.getByText("Filtros (4)")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0] as HTMLElement);
    await waitFor(() => {
      const consulta = ultimaConsulta();
      expect(consulta.supplierId).toBeUndefined();
      expect(consulta.search).toBeUndefined();
      expect(consulta.dateFrom).toBeUndefined();
      expect(consulta.status).toEqual(EM_ABERTO);
    });
  });
});

describe("período pela data do pedido, em dia civil", () => {
  it("default é Todo o período — sem recorte e sem chip", async () => {
    await abrir();
    expect(ultimaConsulta().dateFrom).toBeUndefined();
    expect(ultimaConsulta().dateTo).toBeUndefined();
    expect(screen.getByRole("button", { name: "Todo o período" })).toHaveAttribute("aria-pressed", "true");
  });

  it("personalizado viaja como `YYYY-MM-DD`, nunca instante", async () => {
    await abrir("/compras/ordens?period=custom&dateFrom=2026-09-01&dateTo=2026-09-10");
    expect(ultimaConsulta()).toMatchObject({ dateFrom: "2026-09-01", dateTo: "2026-09-10" });
    expect(screen.getByText("01/09/2026 – 10/09/2026")).toBeInTheDocument();
  });

  it("'Hoje' é o dia comercial, não o dia UTC nem o do navegador", async () => {
    // 23:30 de 10/09 em São Paulo — em UTC já é 11/09.
    vi.setSystemTime(new Date("2026-09-11T02:30:00.000Z"));
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Hoje" }));
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ dateFrom: "2026-09-10", dateTo: "2026-09-10" }),
    );
  });

  it("remover o chip de período devolve Todo o período", async () => {
    await abrir("/compras/ordens?period=30d");
    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Período" }));
    await waitFor(() => expect(ultimaConsulta().dateFrom).toBeUndefined());
  });
});

describe("busca e paginação", () => {
  it("busca com debounce", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Buscar ordens de compra"), { target: { value: "OC-000009" } });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ search: "OC-000009" }));
  });

  it("total do servidor, `pageSize` 20, recorte preservado e volta à página 1 ao filtrar", async () => {
    vi.mocked(listPurchaseOrders).mockResolvedValue(resposta(61));
    await abrir();

    expect(await screen.findByText("61 ordens de compra")).toBeInTheDocument();
    expect(screen.getByText("Página 1 de 4")).toBeInTheDocument();
    expect(ultimaConsulta().pageSize).toBe(20);

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(ultimaConsulta().page).toBe(2));
    expect(ultimaConsulta().status).toEqual(EM_ABERTO);

    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "ORDERED" } });
    await waitFor(() => expect(ultimaConsulta().page).toBe(1));
  });
});

describe("CSV — mesma consulta da tela", () => {
  it("fornecedor, status, período e busca chegam iguais; paginação não", async () => {
    await abrir(
      "/compras/ordens?supplierId=sup-1&status=PARTIALLY_RECEIVED&period=custom&dateFrom=2026-09-01&dateTo=2026-09-10&search=OC-1&page=2",
    );
    const consulta = ultimaConsulta();
    const params = linkDoCsv().searchParams;

    expect(params.get("supplierId")).toBe(consulta.supplierId ?? null);
    expect(params.get("status")).toBe((consulta.status as string[]).join(","));
    expect(params.get("dateFrom")).toBe("2026-09-01");
    expect(params.get("dateTo")).toBe("2026-09-10");
    expect(params.get("search")).toBe(consulta.search ?? null);
    expect(params.get("period")).toBeNull();
    expect(params.get("page")).toBeNull();
    expect(params.get("pageSize")).toBeNull();
  });

  it("a fila padrão exporta Em aberto; Todos exporta sem status", async () => {
    const primeira = await abrir();
    expect(linkDoCsv().searchParams.get("status")).toBe(EM_ABERTO.join(","));
    primeira.unmount();

    await abrir("/compras/ordens?status=todos");
    expect(linkDoCsv().searchParams.get("status")).toBeNull();
  });
});
