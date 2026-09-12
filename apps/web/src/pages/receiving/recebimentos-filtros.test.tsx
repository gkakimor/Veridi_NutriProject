import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReceiptListResponse, SupplierListResponse } from "@veridi/shared";

/**
 * Recebimentos — filtros sobre a foundation (FILTER-OPERATIONS-WAVE-01).
 *
 * A API já respondia por fornecedor, origem, OC, cliente e período; a tela
 * oferecia só a busca, e o período era um bug de data por cima disso. O que
 * se prova aqui é a tela: o dia comercial viaja como `YYYY-MM-DD`, os
 * filtros têm endereço, e o CSV recebe o mesmo objeto da consulta.
 *
 * Que "de 10/09 até 10/09" cubra o dia 10 INTEIRO é prova de servidor —
 * `modules/receiving/receiving.test.ts` e `business-timezone.test.ts`.
 */

vi.mock("../../lib/receiving-api", () => ({ listReceipts: vi.fn() }));
vi.mock("../../lib/suppliers-api", () => ({ listSuppliers: vi.fn() }));
vi.mock("../../lib/products-api", () => ({ listProducts: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));

import { listReceipts } from "../../lib/receiving-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { clearStoredFilters } from "../../lib/stored-filters";
import { ReceiptsPage } from "./ReceiptsPage";

/** 11/09/2026 às 12:00 em São Paulo. */
const AGORA = new Date("2026-09-11T15:00:00.000Z");

const VAZIO: ReceiptListResponse = { receipts: [], page: 1, pageSize: 20, total: 0 };
const FORNECEDORES = {
  suppliers: [
    { id: "sup-1", code: "FOR-000001", legalName: "Química Industrial Ltda", tradeName: "Química" },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
} as unknown as SupplierListResponse;

/** `listReceipts` tem default no parâmetro; o filtro sempre chega preenchido. */
type Consulta = NonNullable<Parameters<typeof listReceipts>[0]>;

const ultimaConsulta = () => {
  const chamadas = vi.mocked(listReceipts).mock.calls;
  return chamadas[chamadas.length - 1]?.[0] as Consulta;
};

function linkDoCsv(): URL {
  const link = screen.getByRole("link", { name: "Exportar CSV" });
  return new URL(link.getAttribute("href") ?? "", "http://exemplo.invalid");
}

async function abrir(url = "/") {
  const resultado = render(
    <MemoryRouter initialEntries={[url]}>
      <ReceiptsPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(listReceipts).toHaveBeenCalled());
  return resultado;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(AGORA);
  clearStoredFilters("u-1", "receipts");
  vi.mocked(listReceipts).mockReset();
  vi.mocked(listReceipts).mockResolvedValue(VAZIO);
  vi.mocked(listSuppliers).mockResolvedValue(FORNECEDORES);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("período", () => {
  it("abre em `Todo o período` — o comportamento que a tela já tinha", async () => {
    await abrir();
    const consulta = ultimaConsulta();
    expect(consulta.dateFrom).toBeUndefined();
    expect(consulta.dateTo).toBeUndefined();
    expect(screen.getByRole("button", { name: "Todo o período" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("`Hoje` pede o mesmo DIA nas duas pontas — nunca um instante", async () => {
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Hoje" }));
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ dateFrom: "2026-09-11", dateTo: "2026-09-11" }),
    );
    // `yyyy-mm-dd`, sem hora: o instante é decidido no servidor.
    expect(ultimaConsulta().dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("`Personalizado` aceita um intervalo próprio, inclusive de um dia só", async () => {
    await abrir("/?period=custom&dateFrom=2026-09-10&dateTo=2026-09-10");
    expect(ultimaConsulta()).toMatchObject({ dateFrom: "2026-09-10", dateTo: "2026-09-10" });

    fireEvent.change(screen.getByLabelText("Recebido até"), {
      target: { value: "2026-09-11" },
    });
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ dateFrom: "2026-09-10", dateTo: "2026-09-11" }),
    );
  });

  it("navegador em outro fuso produz a MESMA consulta", async () => {
    const original = process.env.TZ;
    const medidos: string[] = [];
    try {
      for (const fuso of ["UTC", "America/Vancouver", "America/Sao_Paulo", "Asia/Tokyo"]) {
        process.env.TZ = fuso;
        vi.mocked(listReceipts).mockClear();
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
});

describe("filtros preservados e os novos", () => {
  it("busca continua, com debounce", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Buscar recebimentos"), {
      target: { value: "REC-1" },
    });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ search: "REC-1" }));
  });

  it("origem entrou como filtro, e o servidor já respondia por ela", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Filtrar por origem"), {
      target: { value: "CUSTOMER_SUPPLIED" },
    });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ sourceType: "CUSTOMER_SUPPLIED" }));
  });

  it("fornecedor vem da URL e chega à consulta", async () => {
    await abrir("/?supplierId=sup-1");
    expect(ultimaConsulta()).toMatchObject({ supplierId: "sup-1" });
  });

  it("o catálogo de fornecedores não é carregado inteiro — a busca é do servidor", async () => {
    await abrir();
    await waitFor(() => expect(listSuppliers).toHaveBeenCalled());
    for (const [params] of vi.mocked(listSuppliers).mock.calls) {
      expect(params?.pageSize ?? 20).toBeLessThanOrEqual(20);
    }
  });

  it("contexto por link — OC e cliente — não é apagado ao inicializar", async () => {
    await abrir("/?purchaseOrderId=oc-9&customerId=cli-9");
    expect(ultimaConsulta()).toMatchObject({ purchaseOrderId: "oc-9", customerId: "cli-9" });
  });

  it("a URL restaura tudo de uma vez", async () => {
    await abrir("/?search=REC-1&sourceType=PURCHASE_ORDER&supplierId=sup-1&period=hoje");
    expect(ultimaConsulta()).toMatchObject({
      search: "REC-1",
      sourceType: "PURCHASE_ORDER",
      supplierId: "sup-1",
      dateFrom: "2026-09-11",
      dateTo: "2026-09-11",
    });
    expect(screen.getByLabelText("Buscar recebimentos")).toHaveValue("REC-1");
    expect(screen.getByRole("button", { name: "Hoje" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("chips, limpar e paginação", () => {
  it("conta os filtros ativos e cada × remove só o seu", async () => {
    await abrir("/?search=REC-1&sourceType=PURCHASE_ORDER");
    expect(screen.getByText("Filtros (2)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Origem" }));
    await waitFor(() => expect(ultimaConsulta().sourceType).toBeUndefined());
    expect(ultimaConsulta()).toMatchObject({ search: "REC-1" });
  });

  it("`Limpar filtros` devolve a lista completa", async () => {
    await abrir("/?search=REC-1&sourceType=PURCHASE_ORDER&period=hoje");
    fireEvent.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0] as HTMLElement);
    await waitFor(() => {
      const consulta = ultimaConsulta();
      expect(consulta.search).toBeUndefined();
      expect(consulta.sourceType).toBeUndefined();
      expect(consulta.dateFrom).toBeUndefined();
    });
  });

  it("trocar filtro volta para a página 1", async () => {
    vi.mocked(listReceipts).mockResolvedValue({ ...VAZIO, page: 3, total: 200 });
    await abrir("/?page=3");
    expect(ultimaConsulta().page).toBe(3);

    fireEvent.change(screen.getByLabelText("Filtrar por origem"), {
      target: { value: "PURCHASE_ORDER" },
    });
    await waitFor(() => expect(ultimaConsulta().page).toBe(1));
  });
});

describe("CSV — mesma semântica da tela", () => {
  it("o link leva os MESMOS filtros da consulta, sem paginação", async () => {
    await abrir(
      "/?search=REC-1&sourceType=PURCHASE_ORDER&supplierId=sup-1&period=custom&dateFrom=2026-08-25&dateTo=2026-09-05",
    );
    const consulta = ultimaConsulta();
    const params = linkDoCsv().searchParams;

    expect(params.get("search")).toBe(consulta.search ?? null);
    expect(params.get("sourceType")).toBe(consulta.sourceType ?? null);
    expect(params.get("supplierId")).toBe(consulta.supplierId ?? null);
    expect(params.get("dateFrom")).toBe("2026-08-25");
    expect(params.get("dateTo")).toBe("2026-09-05");
    expect(params.get("page")).toBeNull();
    expect(params.get("pageSize")).toBeNull();
  });

  it("o CSV acompanha o atalho de período escolhido na tela", async () => {
    await abrir();
    expect(linkDoCsv().searchParams.get("dateFrom")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Hoje" }));
    await waitFor(() => {
      const params = linkDoCsv().searchParams;
      expect(params.get("dateFrom")).toBe("2026-09-11");
      expect(params.get("dateTo")).toBe("2026-09-11");
    });
  });
});
