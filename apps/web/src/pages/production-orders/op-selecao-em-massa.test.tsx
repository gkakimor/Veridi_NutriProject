import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ProductListResponse, ProductionOrderDTO, ProductionOrderListResponse } from "@veridi/shared";
import type { BulkSelection, BulkSelectionOptions } from "../../components/BulkSelection";

/**
 * Ordens de Produção — piloto da seleção em massa
 * (BULK-SELECTION-FOUNDATION-01).
 *
 * O mesmo princípio de Pedidos, com os filtros da OP (status, produto,
 * busca). Selecionar não chama nada no servidor e não toca o ciclo de vida
 * da ordem.
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
vi.mock("../../lib/production-orders-api", () => ({ listProductionOrders: vi.fn() }));
vi.mock("../../lib/products-api", () => ({ listProducts: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));

import { listProductionOrders } from "../../lib/production-orders-api";
import { listProducts } from "../../lib/products-api";
import { clearStoredFilters } from "../../lib/stored-filters";
import { ProductionOrdersPage } from "./ProductionOrdersPage";

const EM_ABERTO = ["DRAFT", "PLANNED", "RELEASED", "IN_PRODUCTION"];
const TOTAL = 250;

const PRODUTOS = {
  products: [{ id: "prod-1", code: "PROD-000001", name: "Whey Isolado", customer: null }],
  page: 1,
  pageSize: 20,
  total: 1,
} as unknown as ProductListResponse;

function ordem(n: number): ProductionOrderDTO {
  return {
    id: `op-${n}`,
    code: `OP-${String(n).padStart(6, "0")}`,
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Whey Isolado",
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

type Consulta = NonNullable<Parameters<typeof listProductionOrders>[0]>;
const chamadas = () => vi.mocked(listProductionOrders).mock.calls.map(([params]) => params as Consulta);
const selecao = () => espiao.atual as BulkSelection<Record<string, unknown>>;

const cabecalho = () =>
  screen.getByLabelText("Selecionar todos os registros desta página") as HTMLInputElement;
const caixa = (n: number) =>
  screen.getByLabelText(`Selecionar ordem de produção OP-${String(n).padStart(6, "0")}`) as HTMLInputElement;
const barra = () => screen.queryByRole("group", { name: "Seleção em massa" });
const contagem = () => barra()?.querySelector(".bulk-bar__count")?.textContent ?? null;

function Endereco() {
  const local = useLocation();
  return <output data-testid="endereco">{`${local.pathname}${local.search}`}</output>;
}

async function abrir(url = "/producao/ordens", primeiro = 1) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <ProductionOrdersPage />
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
  clearStoredFilters("u-1", "production-orders");
  espiao.atual = null;
  vi.mocked(listProductionOrders).mockReset();
  vi.mocked(listProductionOrders).mockImplementation(async (params) => {
    const pagina = params?.page ?? 1;
    return {
      productionOrders: Array.from({ length: 20 }, (_, indice) => ordem((pagina - 1) * 20 + indice + 1)),
      page: pagina,
      pageSize: 20,
      total: TOTAL,
    } as ProductionOrderListResponse;
  });
  vi.mocked(listProducts).mockReset();
  vi.mocked(listProducts).mockResolvedValue(PRODUTOS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OP — página × todos os filtrados", () => {
  it("20 da página, CTA com 250, todos os filtrados = 250, excluir 1 = 249", async () => {
    await abrir();
    const antes = chamadas().length;

    fireEvent.click(cabecalho());
    expect(contagem()).toBe("20 selecionados");
    fireEvent.click(screen.getByRole("button", { name: "Selecionar todos os 250 resultados filtrados" }));
    expect(contagem()).toBe("250 selecionados");
    expect(barra()?.querySelector(".bulk-bar__scope")?.textContent).toBe(
      "Todos os 250 resultados filtrados estão selecionados.",
    );
    fireEvent.click(caixa(5));

    expect(contagem()).toBe("249 selecionados");
    expect(selecao().descriptor).toEqual({
      mode: "filtered",
      filters: { status: EM_ABERTO },
      excludedIds: ["op-5"],
    });
    // Nenhuma consulta a mais, e nenhuma com página grande.
    expect(chamadas()).toHaveLength(antes);
    for (const consulta of chamadas()) expect(consulta.pageSize).toBe(20);
  });

  it("a página 2 chega marcada; voltar mantém a exceção", async () => {
    await abrir();
    await todosOsFiltrados();
    fireEvent.click(caixa(5));

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(caixa(21)).not.toBeDisabled());
    expect(caixa(40).checked).toBe(true);
    expect(contagem()).toBe("249 selecionados");

    fireEvent.click(screen.getByRole("button", { name: "Anterior" }));
    await waitFor(() => expect(caixa(1)).not.toBeDisabled());
    expect(caixa(5).checked).toBe(false);
  });
});

describe("OP — filtro muda → 0", () => {
  it("status limpa", async () => {
    await abrir();
    await todosOsFiltrados();
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "RELEASED" } });
    await waitFor(() => expect(barra()).toBeNull());
    expect(selecao().descriptor).toBeNull();
  });

  it("produto do link entra no descritor, e tirá-lo limpa", async () => {
    await abrir("/producao/ordens?productId=prod-1&search=OP-00");
    await todosOsFiltrados();
    expect(selecao().descriptor).toEqual({
      mode: "filtered",
      filters: { productId: "prod-1", search: "OP-00", status: EM_ABERTO },
      excludedIds: [],
    });

    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Produto" }));
    await waitFor(() => expect(barra()).toBeNull());
  });

  it("busca limpa", async () => {
    await abrir();
    fireEvent.click(caixa(1));
    fireEvent.change(screen.getByLabelText("Buscar ordens de produção"), { target: { value: "OP-0002" } });
    await waitFor(() => expect(chamadas().at(-1)?.search).toBe("OP-0002"));
    expect(barra()).toBeNull();
  });
});

describe("OP — a tabela continua a mesma", () => {
  it("a caixa não abre a OP; o código continua link e a linha continua abrindo", async () => {
    await abrir();
    fireEvent.click(caixa(1));
    expect(screen.getByTestId("endereco").textContent).toBe("/producao/ordens");
    expect(screen.getByRole("link", { name: /OP-000001/ })).toBeInTheDocument();

    const linha = caixa(1).closest("tr") as HTMLTableRowElement;
    fireEvent.click(linha.querySelector("td.is-numeric") as HTMLElement);
    expect(screen.getByTestId("endereco").textContent).toBe("/producao/ordens/op-1");
  });

  it("URL e sessão não guardam seleção", async () => {
    await abrir("/producao/ordens?status=todos");
    await todosOsFiltrados();
    fireEvent.click(caixa(9));
    expect(screen.getByTestId("endereco").textContent).toBe("/producao/ordens?status=todos");
    const guardado = Object.keys(sessionStorage)
      .map((chave) => `${chave}=${sessionStorage.getItem(chave)}`)
      .join("\n");
    expect(guardado).not.toMatch(/op-9|filtered|excluded|selec/i);
  });

  it("lista vazia: colSpan cobre a coluna de seleção", async () => {
    vi.mocked(listProductionOrders).mockResolvedValue({ productionOrders: [], page: 1, pageSize: 20, total: 0 });
    const { container } = render(
      <MemoryRouter initialEntries={["/producao/ordens"]}>
        <ProductionOrdersPage />
      </MemoryRouter>,
    );
    const vazio = await waitFor(() => {
      const celula = container.querySelector("td.table__empty") as HTMLTableCellElement | null;
      expect(celula).not.toBeNull();
      return celula as HTMLTableCellElement;
    });
    expect(vazio.colSpan).toBe(container.querySelectorAll("thead th").length);
  });
});
