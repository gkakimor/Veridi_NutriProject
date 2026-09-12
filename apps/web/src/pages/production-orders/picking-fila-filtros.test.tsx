import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProductionOrderListResponse, ProductListResponse } from "@veridi/shared";

/**
 * Picking / Consumo — a fila deixou de ser duas listas cortadas
 * (FILTER-OPERATIONS-WAVE-01).
 *
 * A tela fazia:
 *
 *   Promise.all([
 *     listProductionOrders({ status: "RELEASED", pageSize: 100 }),
 *     listProductionOrders({ status: "IN_PRODUCTION", pageSize: 100 }),
 *   ]).then(([a, b]) => setOrders([...a.productionOrders, ...b.productionOrders]))
 *
 * Três problemas num só lugar: da 101ª ordem em diante cada lado perdia
 * linhas em silêncio; o rodapé contava `orders.length` como se fosse o total;
 * e não havia filtro nenhum nem paginação. Numa tela cuja função é garantir
 * que nada ficou para trás, o corte é o pior defeito possível.
 */

vi.mock("../../lib/production-orders-api", () => ({ listProductionOrders: vi.fn() }));
vi.mock("../../lib/products-api", () => ({ listProducts: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));

import { listProductionOrders } from "../../lib/production-orders-api";
import { listProducts } from "../../lib/products-api";
import { clearStoredFilters } from "../../lib/stored-filters";
import { PickingConsumptionPage } from "./PickingConsumptionPage";

const VAZIO: ProductionOrderListResponse = {
  productionOrders: [],
  page: 1,
  pageSize: 20,
  total: 0,
};

const PRODUTOS = {
  products: [{ id: "prod-1", code: "PROD-000001", name: "Whey Isolado", customer: null }],
  page: 1,
  pageSize: 20,
  total: 1,
} as unknown as ProductListResponse;

type Consulta = NonNullable<Parameters<typeof listProductionOrders>[0]>;

const chamadas = () => vi.mocked(listProductionOrders).mock.calls;
const ultimaConsulta = () => chamadas()[chamadas().length - 1]?.[0] as Consulta;

async function abrir(url = "/") {
  const resultado = render(
    <MemoryRouter initialEntries={[url]}>
      <PickingConsumptionPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(listProductionOrders).toHaveBeenCalled());
  return resultado;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  clearStoredFilters("u-1", "picking");
  vi.mocked(listProductionOrders).mockReset();
  vi.mocked(listProductionOrders).mockResolvedValue(VAZIO);
  vi.mocked(listProducts).mockResolvedValue(PRODUTOS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("uma consulta, sem corte oculto", () => {
  it("o default operacional é EM ABERTO, e vai numa consulta só", async () => {
    await abrir();
    // Uma chamada, não duas.
    expect(chamadas()).toHaveLength(1);
    expect(ultimaConsulta().status).toEqual(["RELEASED", "IN_PRODUCTION"]);
    expect(screen.getByLabelText("Filtrar por situação")).toHaveValue("em-aberto");
  });

  it("nunca pede `pageSize: 100` para fingir que trouxe tudo", async () => {
    await abrir();
    for (const [params] of chamadas()) {
      expect(params?.pageSize).toBe(20);
    }
  });

  it("o rodapé e a paginação usam o total do SERVIDOR, não o tamanho da página", async () => {
    // 250 ordens em aberto, 20 por página: nada pode desaparecer.
    vi.mocked(listProductionOrders).mockResolvedValue({ ...VAZIO, total: 250 });
    await abrir();

    expect(await screen.findByText("250 ordens")).toBeInTheDocument();
    expect(screen.getByText("Página 1 de 13")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima" })).toBeEnabled();
  });

  it("a paginação é explícita e preserva o recorte", async () => {
    vi.mocked(listProductionOrders).mockResolvedValue({ ...VAZIO, total: 250 });
    await abrir();

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(ultimaConsulta().page).toBe(2));
    expect(ultimaConsulta().status).toEqual(["RELEASED", "IN_PRODUCTION"]);
  });
});

describe("filtros", () => {
  it("busca, com debounce", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Buscar ordens de produção"), {
      target: { value: "OP-000123" },
    });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ search: "OP-000123" }));
  });

  it("produto — com busca no servidor, sem catálogo carregado no navegador", async () => {
    await abrir("/?productId=prod-1");
    expect(ultimaConsulta()).toMatchObject({ productId: "prod-1" });

    await waitFor(() => expect(listProducts).toHaveBeenCalled());
    for (const [params] of vi.mocked(listProducts).mock.calls) {
      expect(params?.pageSize ?? 20).toBeLessThanOrEqual(20);
    }
  });

  it("o grupo de situação escolhe UM status quando é isso que se quer", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Filtrar por situação"), {
      target: { value: "em-producao" },
    });
    await waitFor(() => expect(ultimaConsulta().status).toEqual(["IN_PRODUCTION"]));

    fireEvent.change(screen.getByLabelText("Filtrar por situação"), {
      target: { value: "liberada" },
    });
    await waitFor(() => expect(ultimaConsulta().status).toEqual(["RELEASED"]));
  });

  it("nenhum status novo é inventado — só os do domínio", async () => {
    await abrir();
    const opcoes = [...screen.getByLabelText("Filtrar por situação").querySelectorAll("option")];
    expect(opcoes.map((opcao) => opcao.textContent)).toEqual([
      "Em aberto",
      "Liberada",
      "Em produção",
    ]);
  });

  it("a URL restaura o recorte", async () => {
    await abrir("/?search=OP-1&grupo=liberada&productId=prod-1");
    expect(ultimaConsulta()).toMatchObject({
      search: "OP-1",
      productId: "prod-1",
      status: ["RELEASED"],
    });
    expect(screen.getByLabelText("Filtrar por situação")).toHaveValue("liberada");
  });

  it("trocar filtro volta para a página 1", async () => {
    vi.mocked(listProductionOrders).mockResolvedValue({ ...VAZIO, total: 250 });
    await abrir("/?page=3");
    expect(ultimaConsulta().page).toBe(3);

    fireEvent.change(screen.getByLabelText("Filtrar por situação"), {
      target: { value: "liberada" },
    });
    await waitFor(() => expect(ultimaConsulta().page).toBe(1));
  });
});

describe("chips e limpar", () => {
  it("o default operacional não vira chip; o resto vira", async () => {
    const primeira = await abrir();
    expect(screen.queryByText(/^Filtros \(/)).toBeNull();
    primeira.unmount();

    const { container } = await abrir("/?grupo=liberada&search=OP-1");
    expect(screen.getByText("Filtros (2)")).toBeInTheDocument();
    const chips = container.querySelector(".filter-chips") as HTMLElement;
    expect(within(chips).getByText("Liberada")).toBeInTheDocument();
    expect(within(chips).getByText("OP-1")).toBeInTheDocument();
  });

  it("remover o chip de situação devolve EM ABERTO, não `sem filtro`", async () => {
    await abrir("/?grupo=liberada");
    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Situação" }));
    await waitFor(() =>
      expect(ultimaConsulta().status).toEqual(["RELEASED", "IN_PRODUCTION"]),
    );
  });

  it("`Limpar filtros` volta ao default operacional", async () => {
    await abrir("/?grupo=liberada&search=OP-1&productId=prod-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0] as HTMLElement);
    await waitFor(() => {
      const consulta = ultimaConsulta();
      expect(consulta.search).toBeUndefined();
      expect(consulta.productId).toBeUndefined();
      expect(consulta.status).toEqual(["RELEASED", "IN_PRODUCTION"]);
    });
  });
});
