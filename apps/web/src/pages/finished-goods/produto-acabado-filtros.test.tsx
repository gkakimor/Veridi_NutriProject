import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { FinishedGoodsListResponse, ProductListResponse } from "@veridi/shared";

/**
 * Lotes de Produto Acabado — filtros (FILTER-OPERATIONS-WAVE-01).
 *
 * O defeito mais grave desta tela era aritmética de data no NAVEGADOR:
 *
 *   if (dateFrom) params.dateFrom = new Date(`${dateFrom}T00:00:00`).toISOString();
 *   if (dateTo)   params.dateTo   = new Date(`${dateTo}T23:59:59.999`).toISOString();
 *
 * Componentes locais: o mesmo filtro "produzido em 10/09" virava
 * `2026-09-10T03:00Z` em São Paulo e `2026-09-10T07:00Z` em Vancouver, e a
 * mesma pergunta devolvia conjuntos diferentes sem nada avisando. O segundo
 * defeito era o CSV, que não levava período nenhum: a tela mostrava um
 * recorte e o arquivo exportava a produção inteira.
 */

vi.mock("../../lib/finished-goods-api", () => ({ listFinishedGoods: vi.fn() }));
vi.mock("../../lib/products-api", () => ({ listProducts: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));

import { listFinishedGoods } from "../../lib/finished-goods-api";
import { listProducts } from "../../lib/products-api";
import { clearStoredFilters } from "../../lib/stored-filters";
import { FinishedGoodsPage } from "./FinishedGoodsPage";

/** 11/09/2026 às 12:00 em São Paulo. */
const AGORA = new Date("2026-09-11T15:00:00.000Z");

const VAZIO: FinishedGoodsListResponse = { rows: [], page: 1, pageSize: 20, total: 0 };
const PRODUTOS = {
  products: [{ id: "prod-1", code: "PROD-000001", name: "Whey Isolado", customer: null }],
  page: 1,
  pageSize: 20,
  total: 1,
} as unknown as ProductListResponse;

type Consulta = NonNullable<Parameters<typeof listFinishedGoods>[0]>;

const ultimaConsulta = () => {
  const chamadas = vi.mocked(listFinishedGoods).mock.calls;
  return chamadas[chamadas.length - 1]?.[0] as Consulta;
};

function linkDoCsv(): URL {
  const link = screen.getByRole("link", { name: "Exportar CSV" });
  return new URL(link.getAttribute("href") ?? "", "http://exemplo.invalid");
}

async function abrir(url = "/") {
  const resultado = render(
    <MemoryRouter initialEntries={[url]}>
      <FinishedGoodsPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(listFinishedGoods).toHaveBeenCalled());
  return resultado;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(AGORA);
  clearStoredFilters("u-1", "finished-goods");
  vi.mocked(listFinishedGoods).mockReset();
  vi.mocked(listFinishedGoods).mockResolvedValue(VAZIO);
  vi.mocked(listProducts).mockResolvedValue(PRODUTOS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("data sem aritmética de navegador", () => {
  it("o período viaja como DIA civil, nunca como instante ISO", async () => {
    await abrir("/?period=custom&dateFrom=2026-09-10&dateTo=2026-09-10");
    const consulta = ultimaConsulta();
    expect(consulta.dateFrom).toBe("2026-09-10");
    expect(consulta.dateTo).toBe("2026-09-10");
    // Nada de `T00:00:00` nem de `23:59:59.999` montado na tela.
    expect(consulta.dateFrom).not.toMatch(/T/);
    expect(consulta.dateTo).not.toMatch(/T/);
  });

  it("São Paulo, Vancouver, Tóquio e UTC produzem a MESMA consulta", async () => {
    const original = process.env.TZ;
    const medidos: string[] = [];
    try {
      for (const fuso of ["America/Sao_Paulo", "America/Vancouver", "Asia/Tokyo", "UTC"]) {
        process.env.TZ = fuso;
        vi.mocked(listFinishedGoods).mockClear();
        const { unmount } = await abrir("/?period=hoje");
        const consulta = ultimaConsulta();
        medidos.push(`${consulta.dateFrom}..${consulta.dateTo}`);
        unmount();
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
    expect(new Set(medidos).size).toBe(1);
    expect(medidos[0]).toBe("2026-09-11..2026-09-11");
  });

  it("`Últimos 30 dias` atravessa o mês pelo calendário comercial", async () => {
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Últimos 30 dias" }));
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ dateFrom: "2026-08-13", dateTo: "2026-09-11" }),
    );
  });
});

describe("default preservado", () => {
  it("abre em `Todo o período` — não herda o `Mês atual` do Faturamento", async () => {
    await abrir();
    const consulta = ultimaConsulta();
    expect(consulta.dateFrom).toBeUndefined();
    expect(consulta.dateTo).toBeUndefined();
    expect(screen.getByRole("button", { name: "Todo o período" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Sem filtro ativo, nenhuma barra de chips ocupa espaço.
    expect(screen.queryByText(/^Filtros \(/)).toBeNull();
  });
});

describe("filtros preservados", () => {
  it("busca continua, com debounce", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Buscar produto acabado"), {
      target: { value: "LT-2026" },
    });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ search: "LT-2026" }));
  });

  it("qualidade continua", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Filtrar por qualidade"), {
      target: { value: "AVAILABLE" },
    });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ status: "AVAILABLE" }));
  });

  it("produto continua — e o catálogo não é mais carregado inteiro", async () => {
    await abrir("/?productId=prod-1");
    expect(ultimaConsulta()).toMatchObject({ productId: "prod-1" });

    await waitFor(() => expect(listProducts).toHaveBeenCalled());
    // Era `pageSize: 1000` num `<select>`; agora é a primeira página + busca
    // no servidor. Nenhuma chamada pede catálogo.
    for (const [params] of vi.mocked(listProducts).mock.calls) {
      expect(params?.pageSize ?? 20).toBeLessThanOrEqual(20);
    }
  });

  it("contexto por link da OP não é apagado ao inicializar", async () => {
    await abrir("/?productionOrderId=op-9");
    expect(ultimaConsulta()).toMatchObject({ productionOrderId: "op-9" });
  });

  it("a URL restaura tudo de uma vez", async () => {
    await abrir("/?search=LT-1&status=AVAILABLE&productId=prod-1&period=hoje");
    expect(ultimaConsulta()).toMatchObject({
      search: "LT-1",
      status: "AVAILABLE",
      productId: "prod-1",
      dateFrom: "2026-09-11",
      dateTo: "2026-09-11",
    });
  });
});

describe("chips, limpar e paginação", () => {
  it("conta os ativos e cada × remove só o seu", async () => {
    await abrir("/?search=LT-1&status=AVAILABLE&period=hoje");
    expect(screen.getByText("Filtros (3)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Qualidade" }));
    await waitFor(() => expect(ultimaConsulta().status).toBeUndefined());
    expect(ultimaConsulta()).toMatchObject({ search: "LT-1", dateFrom: "2026-09-11" });
  });

  it("`Limpar filtros` volta ao default e some com o período", async () => {
    await abrir("/?search=LT-1&status=AVAILABLE&period=hoje");
    fireEvent.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0] as HTMLElement);
    await waitFor(() => {
      const consulta = ultimaConsulta();
      expect(consulta.search).toBeUndefined();
      expect(consulta.status).toBeUndefined();
      expect(consulta.dateFrom).toBeUndefined();
    });
  });

  it("trocar filtro volta para a página 1", async () => {
    vi.mocked(listFinishedGoods).mockResolvedValue({ ...VAZIO, page: 4, total: 300 });
    await abrir("/?page=4");
    expect(ultimaConsulta().page).toBe(4);

    fireEvent.change(screen.getByLabelText("Filtrar por qualidade"), {
      target: { value: "BLOCKED" },
    });
    await waitFor(() => expect(ultimaConsulta().page).toBe(1));
  });
});

describe("CSV — mesma semântica da tela", () => {
  it("o CSV recebe o MESMO período — era o filtro que ele deixava de fora", async () => {
    await abrir("/?period=custom&dateFrom=2026-08-25&dateTo=2026-09-05");
    const params = linkDoCsv().searchParams;
    expect(params.get("dateFrom")).toBe("2026-08-25");
    expect(params.get("dateTo")).toBe("2026-09-05");
  });

  it("e os demais filtros, sem paginação", async () => {
    await abrir("/?search=LT-1&status=AVAILABLE&productId=prod-1&period=hoje");
    const consulta = ultimaConsulta();
    const params = linkDoCsv().searchParams;

    expect(params.get("search")).toBe(consulta.search ?? null);
    expect(params.get("status")).toBe(consulta.status ?? null);
    expect(params.get("productId")).toBe(consulta.productId ?? null);
    expect(params.get("dateFrom")).toBe(consulta.dateFrom ?? null);
    expect(params.get("dateTo")).toBe(consulta.dateTo ?? null);
    expect(params.get("page")).toBeNull();
    expect(params.get("pageSize")).toBeNull();
  });
});
