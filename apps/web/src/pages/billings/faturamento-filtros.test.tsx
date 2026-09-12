import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BillingListResponse, CustomerDTO } from "@veridi/shared";

/**
 * Faturamento — filtros sobre a fundação (FILTER-FOUNDATION-01).
 *
 * Duas coisas se provam aqui, e a segunda é a que doía:
 *
 * 1. os filtros existentes continuam (busca, status, cliente, período), agora
 *    com endereço, atalhos de período, chips e "Limpar filtros";
 * 2. o CSV recebe EXATAMENTE o que a tela consultou. O arquivo baixado não
 *    tem tela para conferir: se ele divergir do período mostrado, ninguém
 *    descobre até alguém faturar em cima do número errado.
 *
 * O período viaja como DIA COMERCIAL (`YYYY-MM-DD`). Quem o abre nos dois
 * instantes que o limitam é o servidor, com fim exclusivo — provado em
 * `packages/shared/src/business-timezone.test.ts`.
 */

vi.mock("../../lib/billings-api", () => ({
  listBillings: vi.fn(),
  listAwaitingBilling: vi.fn(),
  createBilling: vi.fn(),
}));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));

import { listAwaitingBilling, listBillings } from "../../lib/billings-api";
import { listCustomers } from "../../lib/customers-api";
import { clearStoredFilters } from "../../lib/stored-filters";
import { BillingsPage } from "./BillingsPage";

/** 11/09/2026 às 12:00 em São Paulo. O mês comercial é setembro. */
const AGORA = new Date("2026-09-11T15:00:00.000Z");

const CLIENTE: CustomerDTO = {
  id: "cust-1",
  code: "CLI-000001",
  legalName: "Nutrifarm Indústria Ltda",
  tradeName: "Nutrifarm",
} as CustomerDTO;

const VAZIO: BillingListResponse = { billings: [], page: 1, pageSize: 20, total: 0 };

/** `listBillings` tem default no parâmetro; o filtro sempre chega preenchido. */
type Consulta = NonNullable<Parameters<typeof listBillings>[0]>;

const chamadas = () => vi.mocked(listBillings).mock.calls.map(([query]) => query as Consulta);
const ultimaConsulta = () => {
  const todas = chamadas();
  return todas[todas.length - 1] as Consulta;
};

function linkDoCsv(): URL {
  const link = screen.getByRole("link", { name: "Exportar CSV" });
  return new URL(link.getAttribute("href") ?? "", "http://exemplo.invalid");
}

async function abrir(url = "/") {
  const resultado = render(
    <MemoryRouter initialEntries={[url]}>
      <BillingsPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(listBillings).toHaveBeenCalled());
  return resultado;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(AGORA);
  clearStoredFilters("u-1", "billings");
  vi.mocked(listBillings).mockReset();
  vi.mocked(listBillings).mockResolvedValue(VAZIO);
  vi.mocked(listAwaitingBilling).mockResolvedValue({ rows: [] });
  vi.mocked(listCustomers).mockResolvedValue({
    customers: [CLIENTE],
    page: 1,
    pageSize: 1000,
    total: 1,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("período — default e atalhos", () => {
  it("abre no MÊS ATUAL, resolvido no dia comercial da Veridi", async () => {
    await abrir();
    expect(ultimaConsulta()).toMatchObject({ dateFrom: "2026-09-01", dateTo: "2026-09-11" });
    expect(screen.getByRole("button", { name: "Mês atual" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("`Hoje` pede o mesmo dia nas duas pontas — o dia comercial inteiro", async () => {
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Hoje" }));
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ dateFrom: "2026-09-11", dateTo: "2026-09-11" }),
    );
  });

  it("`Últimos 7 dias` inclui hoje", async () => {
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Últimos 7 dias" }));
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ dateFrom: "2026-09-05", dateTo: "2026-09-11" }),
    );
  });

  it("`Últimos 30 dias` atravessa o mês", async () => {
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Últimos 30 dias" }));
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ dateFrom: "2026-08-13", dateTo: "2026-09-11" }),
    );
  });

  it("`Personalizado` abre semeado com o período da tela e aceita intervalo próprio", async () => {
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Personalizado" }));

    const de = screen.getByLabelText("Emitido a partir de");
    const ate = screen.getByLabelText("Emitido até");
    expect(de).toHaveValue("2026-09-01");
    expect(ate).toHaveValue("2026-09-11");

    fireEvent.change(de, { target: { value: "2026-08-25" } });
    fireEvent.change(ate, { target: { value: "2026-09-05" } });
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ dateFrom: "2026-08-25", dateTo: "2026-09-05" }),
    );
  });

  it("período de um dia só permanece um dia só na consulta", async () => {
    await abrir("/?period=custom&dateFrom=2026-09-10&dateTo=2026-09-10");
    expect(ultimaConsulta()).toMatchObject({ dateFrom: "2026-09-10", dateTo: "2026-09-10" });
  });

  it("navegador em outro fuso produz a MESMA consulta", async () => {
    const original = process.env.TZ;
    const medidos: string[] = [];
    try {
      for (const fuso of ["UTC", "America/Vancouver", "America/Sao_Paulo", "Asia/Tokyo"]) {
        process.env.TZ = fuso;
        vi.mocked(listBillings).mockClear();
        const { unmount } = await abrir();
        const consulta = ultimaConsulta();
        medidos.push(`${consulta.dateFrom}..${consulta.dateTo}`);
        unmount();
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
    expect(new Set(medidos).size).toBe(1);
    expect(medidos[0]).toBe("2026-09-01..2026-09-11");
  });
});

describe("filtros preservados", () => {
  it("busca continua, com debounce, e vai para a URL", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Buscar faturamentos"), {
      target: { value: "NF-1" },
    });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ search: "NF-1" }));
  });

  it("status continua", async () => {
    await abrir();
    fireEvent.change(screen.getByLabelText("Filtrar por status"), {
      target: { value: "ISSUED" },
    });
    await waitFor(() => expect(ultimaConsulta()).toMatchObject({ status: "ISSUED" }));
  });

  it("cliente continua — inclusive vindo de um link de contexto", async () => {
    await abrir("/?customerId=cust-1");
    expect(ultimaConsulta()).toMatchObject({ customerId: "cust-1" });
  });

  it("a URL restaura todos os filtros de uma vez", async () => {
    await abrir("/?search=NF-1&status=ISSUED&customerId=cust-1&period=hoje");
    expect(ultimaConsulta()).toMatchObject({
      search: "NF-1",
      status: "ISSUED",
      customerId: "cust-1",
      dateFrom: "2026-09-11",
      dateTo: "2026-09-11",
    });
    expect(screen.getByLabelText("Buscar faturamentos")).toHaveValue("NF-1");
    expect(screen.getByLabelText("Filtrar por status")).toHaveValue("ISSUED");
    expect(screen.getByRole("button", { name: "Hoje" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("chips, contador e limpar", () => {
  it("nada aparece quando só o default está aplicado", async () => {
    await abrir();
    expect(screen.queryByText(/^Filtros \(/)).toBeNull();
  });

  it("conta os filtros ativos e trata o período personalizado como UM", async () => {
    await abrir(
      "/?search=NF-1&status=ISSUED&period=custom&dateFrom=2026-09-10&dateTo=2026-09-10",
    );
    expect(screen.getByText("Filtros (3)")).toBeInTheDocument();
    expect(screen.getByText("10/09/2026")).toBeInTheDocument();
  });

  it("o × de um chip remove só aquele filtro", async () => {
    await abrir("/?search=NF-1&status=ISSUED");
    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Status" }));
    await waitFor(() => expect(ultimaConsulta().status).toBeUndefined());
    expect(ultimaConsulta()).toMatchObject({ search: "NF-1" });
  });

  it("o chip do cliente mostra o NOME, não o id", async () => {
    await abrir("/?customerId=cust-1");
    await waitFor(() => expect(screen.getByText("Nutrifarm")).toBeInTheDocument());
  });

  it("remover o período devolve o default operacional, não a base inteira", async () => {
    await abrir("/?period=hoje");
    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Período" }));
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ dateFrom: "2026-09-01", dateTo: "2026-09-11" }),
    );
  });

  it("`Limpar filtros` volta ao default e esvazia a URL dos filtros", async () => {
    await abrir("/?search=NF-1&status=ISSUED&customerId=cust-1&period=hoje");
    fireEvent.click(screen.getAllByRole("button", { name: "Limpar filtros" })[0] as HTMLElement);
    await waitFor(() => {
      const consulta = ultimaConsulta();
      expect(consulta.search).toBeUndefined();
      expect(consulta.status).toBeUndefined();
      expect(consulta.customerId).toBeUndefined();
      expect(consulta).toMatchObject({ dateFrom: "2026-09-01", dateTo: "2026-09-11" });
    });
  });

  it("o vazio filtrado oferece a saída dentro da própria tabela", async () => {
    await abrir("/?status=CANCELLED");
    const vazio = await screen.findByText(/Nenhum faturamento encontrado/);
    expect(
      within(vazio.closest("td") as HTMLElement).getByRole("button", { name: "Limpar filtros" }),
    ).toBeInTheDocument();
  });
});

describe("paginação", () => {
  it("trocar filtro volta para a página 1", async () => {
    vi.mocked(listBillings).mockResolvedValue({ ...VAZIO, page: 3, total: 200 });
    await abrir("/?page=3");
    expect(ultimaConsulta().page).toBe(3);

    fireEvent.change(screen.getByLabelText("Filtrar por status"), {
      target: { value: "ISSUED" },
    });
    await waitFor(() => expect(ultimaConsulta().page).toBe(1));
  });
});

describe("CSV — mesma semântica da tela", () => {
  it("o link leva os MESMOS filtros da última consulta, sem paginação", async () => {
    await abrir("/?search=NF-1&status=ISSUED&customerId=cust-1&period=custom&dateFrom=2026-08-25&dateTo=2026-09-05");
    const consulta = ultimaConsulta();
    const params = linkDoCsv().searchParams;

    expect(params.get("search")).toBe(consulta.search ?? null);
    expect(params.get("status")).toBe(consulta.status ?? null);
    expect(params.get("customerId")).toBe(consulta.customerId ?? null);
    expect(params.get("dateFrom")).toBe("2026-08-25");
    expect(params.get("dateTo")).toBe("2026-09-05");
    expect(params.get("page")).toBeNull();
    expect(params.get("pageSize")).toBeNull();
  });

  it("o CSV acompanha o atalho de período escolhido na tela", async () => {
    await abrir();
    expect(linkDoCsv().searchParams.get("dateFrom")).toBe("2026-09-01");

    fireEvent.click(screen.getByRole("button", { name: "Hoje" }));
    await waitFor(() => {
      const params = linkDoCsv().searchParams;
      expect(params.get("dateFrom")).toBe("2026-09-11");
      expect(params.get("dateTo")).toBe("2026-09-11");
    });
  });

  it("sem filtro além do default, o CSV ainda carrega o período — nunca a base inteira", async () => {
    await abrir();
    const params = linkDoCsv().searchParams;
    expect(params.get("dateFrom")).toBe("2026-09-01");
    expect(params.get("dateTo")).toBe("2026-09-11");
    expect(params.get("status")).toBeNull();
  });
});

describe("390px", () => {
  /*
   * jsdom não faz layout, então o que se prova é a regra: os controles que
   * têm largura mínima em pixel passam a ocupar a linha inteira em tela
   * estreita, e nenhum deles força a PÁGINA a rolar na horizontal. Rolagem
   * horizontal continua só dentro de `.table-container`, onde ela é honesta.
   */
  it("o CSS empilha os controles de filtro em tela estreita", () => {
    const css = readFileSync(
      join(process.cwd(), "src", "styles", "components.css"),
      "utf8",
    );
    const estreita = css.slice(css.lastIndexOf("@media (max-width: 640px)"));
    expect(estreita.length).toBeLessThan(css.length);
    for (const seletor of [".toolbar__search", ".toolbar__entity", ".filter-period__custom"]) {
      expect(estreita).toContain(seletor);
    }
    expect(estreita).toContain("min-width: 100%");
  });

  it("período e chips quebram linha em vez de esticar a página", () => {
    const css = readFileSync(
      join(process.cwd(), "src", "styles", "components.css"),
      "utf8",
    );
    for (const seletor of [".filter-period {", ".filter-chips {"]) {
      const bloco = css.slice(css.indexOf(seletor), css.indexOf("}", css.indexOf(seletor)));
      expect(bloco).toContain("flex-wrap: wrap");
    }
  });

  it("a barra de filtros não tem tabela larga nem largura fixa em pixel", async () => {
    const { container } = await abrir();
    const toolbar = container.querySelector(".toolbar") as HTMLElement;
    expect(toolbar.querySelector("table")).toBeNull();
    expect(container.querySelector(".filter-period")).toBeInTheDocument();
    // Toda tabela larga da tela rola dentro do próprio container.
    for (const tabela of container.querySelectorAll("table")) {
      expect(tabela.closest(".table-container")).not.toBeNull();
    }
  });
});
