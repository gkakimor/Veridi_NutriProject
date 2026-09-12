import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import type {
  ProductListResponse,
  ProductionOrderDTO,
  ProductionOrderListResponse,
} from "@veridi/shared";

/**
 * Ordens de Produção — fila operacional sobre a foundation de filtros
 * (FILTER-OPERATIONS-WAVE-03).
 *
 * O que estava no lugar:
 *
 * 1. **Abria em todos os status**, concluídas e canceladas no meio da fila.
 * 2. **`?productId=` fora do conjunto.** O link "Ordens de produção" do
 *    Produto era lido de `useSearchParams` à parte: ficava fora das
 *    dependências do recarregamento (trocar de produto sem desmontar a tela
 *    deixava as OPs do anterior), fora do CSV (a tela mostrava um produto e o
 *    arquivo trazia todas) e fora do "Limpar filtros" da barra.
 * 3. **Merge por campo** com a sessão: busca e status lembrados se somavam ao
 *    produto do link.
 *
 * "Em aberto" são quatro status numa consulta — o `status=A,B,...` que o
 * Picking já usa. `BLOCKED` não ganha semântica: nenhum serviço o escreve.
 */

vi.mock("../../lib/production-orders-api", () => ({ listProductionOrders: vi.fn() }));
vi.mock("../../lib/products-api", () => ({ listProducts: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));

import { listProductionOrders } from "../../lib/production-orders-api";
import { listProducts } from "../../lib/products-api";
import { clearStoredFilters, filterStorageKey } from "../../lib/stored-filters";
import { ProductionOrdersPage } from "./ProductionOrdersPage";

const EM_ABERTO = ["DRAFT", "PLANNED", "RELEASED", "IN_PRODUCTION"];

const PRODUTOS = {
  products: [
    { id: "prod-1", code: "PROD-000001", name: "Whey Isolado", customer: null },
    { id: "prod-2", code: "PROD-000002", name: "Creatina", customer: null },
  ],
  page: 1,
  pageSize: 20,
  total: 2,
} as unknown as ProductListResponse;

function op(id: string, code: string, productId: string, productName: string): ProductionOrderDTO {
  return {
    id,
    code,
    productId,
    productCode: productId.toUpperCase(),
    productName,
    customerId: null,
    customerCode: null,
    customerName: null,
    customerOrderId: null,
    customerOrderCode: null,
    formulationVersionLabel: "v1",
    plannedQuantity: "100",
    outputUnitCode: "un",
    materialsStatus: "MATERIALS_AVAILABLE",
    shortageItemCount: 0,
    status: "PLANNED",
    createdAt: "2026-09-10T12:00:00.000Z",
  } as unknown as ProductionOrderDTO;
}

function resposta(
  productionOrders: ProductionOrderDTO[] = [],
  total = productionOrders.length,
): ProductionOrderListResponse {
  return { productionOrders, page: 1, pageSize: 20, total };
}

type Consulta = NonNullable<Parameters<typeof listProductionOrders>[0]>;

const chamadas = () => vi.mocked(listProductionOrders).mock.calls;
const ultimaConsulta = () => chamadas()[chamadas().length - 1]?.[0] as Consulta;

function linkDoCsv(): URL {
  const link = screen.getByRole("link", { name: "Exportar CSV" });
  return new URL(link.getAttribute("href") ?? "", "http://exemplo.invalid");
}

async function abrir(url = "/producao/ordens") {
  const resultado = render(
    <MemoryRouter initialEntries={[url]}>
      <ProductionOrdersPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(listProductionOrders).toHaveBeenCalled());
  return resultado;
}

/** Troca a URL SEM desmontar a tela — o caso do `productId` fora das dependências. */
function Harness({ para }: { para: string }) {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(para)}>
        trocar de produto
      </button>
      <ProductionOrdersPage />
    </>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  clearStoredFilters("u-1", "production-orders");
  vi.mocked(listProductionOrders).mockReset();
  vi.mocked(listProductionOrders).mockResolvedValue(resposta());
  vi.mocked(listProducts).mockReset();
  vi.mocked(listProducts).mockResolvedValue(PRODUTOS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Em aberto, multi-status e Todos", () => {
  it("abre em Em aberto: quatro status em UMA consulta", async () => {
    await abrir();
    expect(chamadas()).toHaveLength(1);
    expect(ultimaConsulta().status).toEqual(EM_ABERTO);
    expect(screen.getByLabelText("Filtrar por status")).toHaveValue("em-aberto");
    expect(screen.queryByText(/^Filtros \(/)).toBeNull();
  });

  it("concluída e cancelada ficam fora do default", async () => {
    await abrir();
    expect(ultimaConsulta().status).not.toContain("COMPLETED");
    expect(ultimaConsulta().status).not.toContain("CANCELLED");
  });

  it("Todos consulta sem status e vira chip", async () => {
    const { container } = await abrir();
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "todos" } });
    await waitFor(() => expect(ultimaConsulta().status).toBeUndefined());
    const chips = container.querySelector(".filter-chips") as HTMLElement;
    expect(within(chips).getByText("Todos os status")).toBeInTheDocument();
  });

  it("status específico consulta só ele; remover o chip volta para Em aberto", async () => {
    await abrir("/producao/ordens?status=COMPLETED");
    expect(ultimaConsulta().status).toEqual(["COMPLETED"]);

    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Status" }));
    await waitFor(() => expect(ultimaConsulta().status).toEqual(EM_ABERTO));
  });

  it("fila vazia oferece o histórico", async () => {
    await abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Ver todas" }));
    await waitFor(() => expect(ultimaConsulta().status).toBeUndefined());
  });
});

describe("BLOCKED não recebe semântica nova", () => {
  it("não entra em Em aberto", async () => {
    await abrir();
    expect(ultimaConsulta().status).not.toContain("BLOCKED");
  });

  it("continua como estava: uma opção própria, que consulta só ela", async () => {
    await abrir();
    const opcoes = [...screen.getByLabelText("Filtrar por status").querySelectorAll("option")];
    expect(opcoes.map((opcao) => opcao.textContent)).toEqual([
      "Em aberto",
      "Todos os status",
      "Rascunho",
      "Planejada",
      "Liberada",
      "Em produção",
      "Concluída",
      "Bloqueada",
      "Cancelada",
    ]);

    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "BLOCKED" } });
    await waitFor(() => expect(ultimaConsulta().status).toEqual(["BLOCKED"]));
  });
});

describe("produto e contexto do link", () => {
  it("`?productId=` do cadastro do Produto é filtro real, na fila padrão", async () => {
    await abrir("/producao/ordens?productId=prod-1");
    expect(ultimaConsulta()).toMatchObject({ productId: "prod-1", status: EM_ABERTO });
  });

  it("o aviso solto de contexto deu lugar a um chip com o nome do produto", async () => {
    const { container } = await abrir("/producao/ordens?productId=prod-2");
    expect(screen.queryByText(/filtro veio de um link/)).toBeNull();
    const chips = container.querySelector(".filter-chips") as HTMLElement;
    await waitFor(() =>
      expect(within(chips).getByText(/PROD-000002 · Creatina/)).toBeInTheDocument(),
    );
  });

  it("produto com busca no servidor; id da URL resolvido por identidade", async () => {
    await abrir("/producao/ordens?productId=prod-9");
    await waitFor(() =>
      expect(
        vi.mocked(listProducts).mock.calls.some(([params]) => params?.productId === "prod-9"),
      ).toBe(true),
    );
    for (const [params] of vi.mocked(listProducts).mock.calls) {
      expect(params?.pageSize ?? 20).toBeLessThanOrEqual(20);
    }
  });

  it("trocar de `productId` sem desmontar RECARREGA — não fica o produto anterior", async () => {
    vi.mocked(listProductionOrders).mockImplementation(async (params) =>
      resposta(
        params?.productId === "prod-2"
          ? [op("op-2", "OP-000002", "prod-2", "Creatina")]
          : [op("op-1", "OP-000001", "prod-1", "Whey Isolado")],
      ),
    );

    render(
      <MemoryRouter initialEntries={["/producao/ordens?productId=prod-1"]}>
        <Harness para="/producao/ordens?productId=prod-2" />
      </MemoryRouter>,
    );
    expect(await screen.findByText("OP-000001")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "trocar de produto" }));

    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ productId: "prod-2" }));
    expect(await screen.findByText("OP-000002")).toBeInTheDocument();
    expect(screen.queryByText("OP-000001")).toBeNull();
  });

  it("o link do Produto não herda busca nem status da sessão, nem vira lembrança", async () => {
    const primeira = await abrir();
    fireEvent.change(screen.getByLabelText("Buscar ordens de produção"), {
      target: { value: "RESIDUO" },
    });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ search: "RESIDUO" }));
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "CANCELLED" } });
    await waitFor(() => expect(ultimaConsulta().status).toEqual(["CANCELLED"]));
    primeira.unmount();

    vi.mocked(listProductionOrders).mockClear();
    const segunda = await abrir("/producao/ordens?productId=prod-1");
    const consulta = ultimaConsulta();
    expect(consulta.productId).toBe("prod-1");
    expect(consulta.search).toBeUndefined();
    expect(consulta.status).toEqual(EM_ABERTO);
    segunda.unmount();

    expect(sessionStorage.getItem(filterStorageKey("u-1", "production-orders", "productId"))).toBeNull();

    // E sem nada na URL, a escolha da pessoa continua lembrada.
    vi.mocked(listProductionOrders).mockClear();
    await abrir();
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ search: "RESIDUO", status: ["CANCELLED"] }),
    );
  });

  it("`Limpar filtros` limpa tudo, inclusive o produto do link", async () => {
    await abrir("/producao/ordens?productId=prod-1&status=todos&search=OP-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0] as HTMLElement);
    await waitFor(() => {
      const consulta = ultimaConsulta();
      expect(consulta.productId).toBeUndefined();
      expect(consulta.search).toBeUndefined();
      expect(consulta.status).toEqual(EM_ABERTO);
    });
  });
});

describe("busca e paginação", () => {
  it("busca com debounce", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Buscar ordens de produção"), {
      target: { value: "OP-000123" },
    });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ search: "OP-000123" }));
  });

  it("total do servidor, `pageSize` 20 e recorte preservado na página 2", async () => {
    vi.mocked(listProductionOrders).mockResolvedValue(resposta([], 130));
    await abrir();

    expect(await screen.findByText("130 ordens de produção")).toBeInTheDocument();
    expect(screen.getByText("Página 1 de 7")).toBeInTheDocument();
    expect(ultimaConsulta().pageSize).toBe(20);

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(ultimaConsulta().page).toBe(2));
    expect(ultimaConsulta().status).toEqual(EM_ABERTO);
  });

  it("trocar filtro volta para a página 1", async () => {
    vi.mocked(listProductionOrders).mockResolvedValue(resposta([], 130));
    await abrir("/producao/ordens?page=4");
    expect(ultimaConsulta().page).toBe(4);

    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "RELEASED" } });
    await waitFor(() => expect(ultimaConsulta().page).toBe(1));
  });
});

describe("CSV — mesma consulta da tela", () => {
  it("Em aberto viaja como a mesma lista separada por vírgula", async () => {
    await abrir();
    expect(linkDoCsv().searchParams.get("status")).toBe(EM_ABERTO.join(","));
  });

  it("produto, status e busca chegam iguais; paginação não", async () => {
    await abrir("/producao/ordens?productId=prod-1&status=RELEASED&search=OP-1&page=2");
    const consulta = ultimaConsulta();
    const params = linkDoCsv().searchParams;

    expect(params.get("productId")).toBe(consulta.productId ?? null);
    expect(params.get("status")).toBe((consulta.status as string[]).join(","));
    expect(params.get("search")).toBe(consulta.search ?? null);
    expect(params.get("page")).toBeNull();
    expect(params.get("pageSize")).toBeNull();
  });

  it("o produto do link chega ao CSV — era o filtro que ele perdia", async () => {
    await abrir("/producao/ordens?productId=prod-1");
    expect(linkDoCsv().searchParams.get("productId")).toBe("prod-1");
  });
});
