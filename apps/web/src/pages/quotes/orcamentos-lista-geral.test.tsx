import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import type {
  CustomerListResponse,
  ProjectDTO,
  QuoteVersionListItemDTO,
  QuoteVersionListResponse,
} from "@veridi/shared";

/**
 * QUOTES-HUB-01 — Comercial → Orçamentos, a lista geral das versões.
 *
 * A lista só ENCONTRA e navega: cada linha abre a página da versão
 * (`/comercial/orcamentos/:id`) com a volta para o recorte de onde se saiu. O
 * que se protege aqui:
 *
 * 1. a fila abre em "Em aberto" (Rascunho + Enviado), com "Todos os status" e os
 *    seis status do domínio como saída — nenhum inventado;
 * 2. cliente, projeto, período, status e busca vão ao servidor, com página e
 *    tamanho, e moram na URL; sem URL, a lembrança da sessão volta;
 * 3. carregando, falha, fila vazia, base vazia e recorte sem resultado são
 *    frases diferentes — falha nunca vira "Nenhum orçamento";
 * 4. clique e Enter na linha abrem; "← Voltar para Orçamentos" devolve o mesmo
 *    recorte e a mesma página.
 *
 * A página da versão é de mentira: só o "Voltar" dela, montado com a MESMA
 * leitura da página real (`rotaDeRetorno` + `rotuloDaOrigem`).
 */

vi.mock("../../lib/projects-api", () => ({
  listQuoteVersions: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
}));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
}));

import { getProject, listProjects, listQuoteVersions } from "../../lib/projects-api";
import { listCustomers } from "../../lib/customers-api";
import { rotaDeRetorno } from "../../lib/contextual-create";
import { clearStoredFilters } from "../../lib/stored-filters";
import { rotuloDaOrigem } from "../../lib/use-contextual-create";
import { QuotesPage } from "./QuotesPage";

const EM_ABERTO = ["DRAFT", "SENT"];

const CLIENTES = [
  { id: "cli-1", code: "CLI-000001", legalName: "NutriViva Ltda", tradeName: "NutriViva", cnpj: null },
  { id: "cli-2", code: "CLI-000002", legalName: "Vita Forte SA", tradeName: null, cnpj: null },
];

const PROJETOS = [
  { id: "prj-1", code: "PROJ-000001", name: "Linha Performance", customerName: "NutriViva Ltda" },
  { id: "prj-2", code: "PROJ-000002", name: "Linha Kids", customerName: "Vita Forte SA" },
] as unknown as ProjectDTO[];

function versao(overrides: Partial<QuoteVersionListItemDTO> = {}): QuoteVersionListItemDTO {
  return {
    id: "qv-1",
    code: "ORC-000444",
    versionNumber: 1,
    versionLabel: "ORC-000444 · V1",
    status: "SENT",
    expired: false,
    quoteDate: "2026-09-05T00:00:00.000Z",
    validUntil: "2026-10-05T00:00:00.000Z",
    currencyCode: "BRL",
    projectId: "prj-1",
    projectCode: "PROJ-000001",
    projectName: "Linha Performance",
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "NutriViva Ltda",
    productCount: 3,
    total: "12345.6",
    sourcedOrder: null,
    ...overrides,
  };
}

function resposta(
  quoteVersions: QuoteVersionListItemDTO[] = [],
  total = quoteVersions.length,
  page = 1,
): QuoteVersionListResponse {
  return { quoteVersions, page, pageSize: 20, total };
}

type Consulta = NonNullable<Parameters<typeof listQuoteVersions>[0]>;

const chamadas = () => vi.mocked(listQuoteVersions).mock.calls;
const ultima = () => chamadas()[chamadas().length - 1]?.[0] as Consulta;

let local = { pathname: "", search: "" };

function Sonda() {
  const location = useLocation();
  local = { pathname: location.pathname, search: location.search };
  return null;
}

function PaginaDaVersao() {
  const [params] = useSearchParams();
  const voltar = rotaDeRetorno(params);
  return voltar ? <Link to={voltar}>← Voltar para {rotuloDaOrigem(voltar)}</Link> : <p>sem volta</p>;
}

async function abrir(url = "/comercial/orcamentos", consulta = true) {
  const resultado = render(
    <MemoryRouter initialEntries={[url]}>
      <Sonda />
      <Routes>
        <Route path="/comercial/orcamentos" element={<QuotesPage />} />
        <Route path="/comercial/orcamentos/:id" element={<PaginaDaVersao />} />
      </Routes>
    </MemoryRouter>,
  );
  if (consulta) await waitFor(() => expect(listQuoteVersions).toHaveBeenCalled());
  return resultado;
}

const statusSelect = () => screen.getByLabelText("Filtrar por status");
const busca = () => screen.getByRole("searchbox", { name: "Buscar orçamentos" });
const linhaDe = (rotulo: string) => screen.getByText(rotulo).closest("tr") as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  clearStoredFilters("u-1", "quote-versions");
  local = { pathname: "", search: "" };
  vi.mocked(listQuoteVersions).mockReset();
  vi.mocked(listQuoteVersions).mockResolvedValue(resposta([versao()]));
  vi.mocked(listCustomers).mockReset();
  vi.mocked(listCustomers).mockImplementation(
    async (params) =>
      ({
        customers: params?.ids ? CLIENTES.filter((cliente) => params.ids?.includes(cliente.id)) : CLIENTES,
        page: 1,
        pageSize: 20,
        total: CLIENTES.length,
      }) as unknown as CustomerListResponse,
  );
  vi.mocked(listProjects).mockReset();
  vi.mocked(listProjects).mockResolvedValue({ projects: PROJETOS, page: 1, pageSize: 20, total: 2 });
  vi.mocked(getProject).mockReset();
  vi.mocked(getProject).mockImplementation(async (id) => {
    const projeto = PROJETOS.find((candidato) => candidato.id === id);
    if (!projeto) throw new Error("não encontrado");
    return projeto;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fila padrão: EM ABERTO", () => {
  it("abre em Em aberto — Rascunho e Enviado, numa consulta só, primeira página no servidor", async () => {
    await abrir();
    expect(chamadas()).toHaveLength(1);
    expect(ultima()).toEqual({ status: EM_ABERTO, page: 1, pageSize: 20 });
    expect(statusSelect()).toHaveValue("em-aberto");
    // O default não é chip nem parâmetro.
    expect(screen.queryByText(/^Filtros \(/)).toBeNull();
    expect(local.search).toBe("");
  });

  it("nenhum status inventado: Em aberto, Todos e os seis do domínio, com os rótulos de sempre", async () => {
    await abrir();
    const opcoes = [...statusSelect().querySelectorAll("option")].map((opcao) => opcao.textContent);
    expect(opcoes).toEqual([
      "Em aberto",
      "Todos os status",
      "Rascunho",
      "Enviado",
      "Aceito",
      "Recusado",
      "Substituído",
      "Histórico",
    ]);
  });

  it("Todos os status tira o filtro de status, vira chip e vai para a URL", async () => {
    await abrir();
    fireEvent.change(statusSelect(), { target: { value: "todos" } });
    await waitFor(() => expect(ultima().status).toBeUndefined());
    expect(local.search).toBe("?status=todos");
    expect(screen.getByText(/^Filtros \(1\)/)).toBeInTheDocument();
  });

  it.each([
    ["ACCEPTED", "Aceito"],
    ["REJECTED", "Recusado"],
    ["SUPERSEDED", "Substituído"],
  ])("status individual %s consulta só ele", async (status) => {
    await abrir();
    fireEvent.change(statusSelect(), { target: { value: status } });
    await waitFor(() => expect(ultima().status).toEqual([status]));
    expect(local.search).toBe(`?status=${status}`);
  });
});

describe("filtros no servidor e na URL", () => {
  it("cliente pela URL: consulta pelo id, e o chip diz quem — mesmo fora da primeira página", async () => {
    await abrir("/comercial/orcamentos?customerId=cli-2");
    expect(ultima()).toMatchObject({ customerId: "cli-2", status: EM_ABERTO });
    expect(await screen.findByText(/CLI-000002 · Vita Forte SA/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Cliente" }));
    await waitFor(() => expect(ultima().customerId).toBeUndefined());
  });

  it("projeto pela URL: consulta pelo id, e o chip resolve o projeto no servidor", async () => {
    await abrir("/comercial/orcamentos?projectId=prj-2");
    expect(ultima()).toMatchObject({ projectId: "prj-2" });
    expect(await screen.findByText(/PROJ-000002 · Linha Kids/)).toBeInTheDocument();
    expect(getProject).toHaveBeenCalledWith("prj-2");
  });

  it("período: atalho e personalizado vão como dia civil", async () => {
    await abrir("/comercial/orcamentos?period=custom&dateFrom=2026-09-01&dateTo=2026-09-10");
    expect(ultima()).toMatchObject({ dateFrom: "2026-09-01", dateTo: "2026-09-10" });

    fireEvent.click(screen.getByRole("button", { name: "Últimos 30 dias" }));
    await waitFor(() => expect(local.search).toBe("?period=30d"));
    expect(ultima().dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ultima().dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ultima().dateFrom! < ultima().dateTo!).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Todo o período" }));
    await waitFor(() => expect(ultima().dateFrom).toBeUndefined());
  });

  it("período invertido não consulta, e a tabela diz por quê", async () => {
    await abrir("/comercial/orcamentos?period=custom&dateFrom=2026-09-10&dateTo=2026-09-01", false);
    expect(await screen.findByText("Corrija o período para consultar.")).toBeInTheDocument();
    expect(listQuoteVersions).not.toHaveBeenCalled();
    expect(screen.queryByText(/Nenhum orçamento/)).toBeNull();
  });

  it("busca: uma consulta depois da pausa, não uma por letra — e o termo vai para a URL", async () => {
    await abrir();
    expect(chamadas()).toHaveLength(1);

    fireEvent.change(busca(), { target: { value: "O" } });
    fireEvent.change(busca(), { target: { value: "OR" } });
    fireEvent.change(busca(), { target: { value: "ORC-0004" } });
    expect(chamadas()).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await waitFor(() => expect(ultima().search).toBe("ORC-0004"));
    expect(chamadas()).toHaveLength(2);
    expect(local.search).toBe("?search=ORC-0004");
  });

  it("sem URL, a escolha da sessão volta; com URL, a URL vence", async () => {
    const primeira = await abrir();
    fireEvent.change(statusSelect(), { target: { value: "todos" } });
    await waitFor(() => expect(ultima().status).toBeUndefined());
    primeira.unmount();

    vi.mocked(listQuoteVersions).mockClear();
    await abrir();
    await waitFor(() => expect(ultima().status).toBeUndefined());
    expect(local.search).toBe("?status=todos");
    cleanup();

    vi.mocked(listQuoteVersions).mockClear();
    await abrir("/comercial/orcamentos?status=ACCEPTED");
    expect(ultima().status).toEqual(["ACCEPTED"]);
    expect(chamadas().every(([consulta]) => JSON.stringify(consulta?.status) === '["ACCEPTED"]')).toBe(true);
  });

  it("paginação no servidor: a página vai na consulta e na URL; filtro novo volta à primeira", async () => {
    vi.mocked(listQuoteVersions).mockImplementation(async (params) =>
      resposta([versao()], 45, params?.page ?? 1),
    );
    await abrir();
    expect(await screen.findByText("Página 1 de 3")).toBeInTheDocument();
    expect(screen.getByText("45 versões de orçamento")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(ultima().page).toBe(2));
    expect(local.search).toBe("?page=2");
    expect(await screen.findByText("Página 2 de 3")).toBeInTheDocument();

    fireEvent.change(statusSelect(), { target: { value: "todos" } });
    await waitFor(() => expect(ultima()).toEqual({ page: 1, pageSize: 20 }));
  });
});

describe("estados da tabela", () => {
  it("carregando: a tabela diz que ainda não sabe", async () => {
    vi.mocked(listQuoteVersions).mockReturnValue(new Promise(() => {}));
    await abrir();
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(screen.queryByText(/Nenhum orçamento/)).toBeNull();
  });

  it("falha não vira 'Nenhum orçamento'; Tentar novamente consulta o mesmo recorte", async () => {
    vi.mocked(listQuoteVersions).mockRejectedValueOnce(new Error("Falha ao carregar orçamentos"));
    await abrir();
    expect(await screen.findByRole("alert")).toHaveTextContent("Falha ao carregar orçamentos");
    expect(screen.queryByText(/Nenhum orçamento/)).toBeNull();
    expect(screen.queryByText("Carregando…")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByText("ORC-000444 · V1")).toBeInTheDocument();
    expect(chamadas()).toHaveLength(2);
    expect(chamadas()[1]?.[0]).toEqual(chamadas()[0]?.[0]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("fila vazia não é base vazia: oferece o histórico, e só Todos sem recorte diz que não há orçamento", async () => {
    vi.mocked(listQuoteVersions).mockResolvedValue(resposta([]));
    await abrir();
    expect(await screen.findByText(/Nenhum orçamento em aberto\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ver todos" }));
    await waitFor(() => expect(ultima().status).toBeUndefined());
    expect(
      await screen.findByText("Nenhum orçamento cadastrado — o orçamento nasce na ficha do Projeto."),
    ).toBeInTheDocument();
  });

  it("recorte sem resultado diz que nada casou e oferece limpar", async () => {
    vi.mocked(listQuoteVersions).mockResolvedValue(resposta([]));
    await abrir("/comercial/orcamentos?search=xyz&status=todos");
    const vazio = await screen.findByText(/Nenhum orçamento encontrado para os filtros atuais\./);
    fireEvent.click(within(vazio.closest("td") as HTMLElement).getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(ultima()).toEqual({ status: EM_ABERTO, page: 1, pageSize: 20 }));
  });
});

describe("a linha", () => {
  it("mostra código e versão, cliente, projeto, data, produtos, total do servidor, validade, status e o Pedido originado", async () => {
    vi.mocked(listQuoteVersions).mockResolvedValue(
      resposta([
        versao({ status: "ACCEPTED", sourcedOrder: { id: "ped-1", code: "PED-000009" } }),
        versao({ id: "qv-2", versionLabel: "ORC-000450 · V2", status: "DRAFT", total: null }),
        versao({ id: "qv-3", versionLabel: "ORC-000451 · V1", expired: true }),
      ]),
    );
    await abrir("/comercial/orcamentos?status=todos");

    const aceita = within(await screen.findByText("ORC-000444 · V1").then((celula) => celula.closest("tr") as HTMLElement));
    const cliente = aceita.getByRole("link", { name: "NutriViva Ltda" });
    // Cadastro em lista com modal: o link leva a volta para ESTE recorte.
    expect(cliente.getAttribute("href")).toBe(
      `/cadastros/clientes?ids=cli-1&open=cli-1&voltar=${encodeURIComponent("/comercial/orcamentos?status=todos")}`,
    );
    expect(aceita.getByRole("link", { name: "PROJ-000001 Linha Performance" })).toHaveAttribute(
      "href",
      "/comercial/projetos/prj-1",
    );
    expect(aceita.getByText("05/09/2026")).toBeInTheDocument();
    expect(aceita.getByText("3")).toBeInTheDocument();
    expect(aceita.getByText("R$ 12.345,60", { normalizer: (texto) => texto.replace(/\s+/g, " ").trim() })).toBeInTheDocument();
    expect(aceita.getByText("05/10/2026")).toBeInTheDocument();
    expect(aceita.getByText("Aceito")).toBeInTheDocument();
    expect(aceita.getByRole("link", { name: "PED-000009" })).toHaveAttribute("href", "/comercial/pedidos/ped-1");

    const rascunho = within(linhaDe("ORC-000450 · V2"));
    expect(rascunho.getByText("Rascunho")).toBeInTheDocument();
    expect(rascunho.getByText("—")).toBeInTheDocument();

    expect(within(linhaDe("ORC-000451 · V1")).getByText(/Vencido/)).toBeInTheDocument();
  });

  it("clique na linha abre a página da versão, com a volta para este recorte e esta página", async () => {
    await abrir("/comercial/orcamentos?status=todos&page=2");
    fireEvent.click(await screen.findByText("ORC-000444 · V1"));
    expect(local.pathname).toBe("/comercial/orcamentos/qv-1");
    expect(local.search).toBe(`?voltar=${encodeURIComponent("/comercial/orcamentos?status=todos&page=2")}`);
  });

  it("Enter na linha abre; Enter num link da linha não abre a versão no lugar dele", async () => {
    await abrir();
    const linha = linhaDe((await screen.findByText("ORC-000444 · V1")).textContent ?? "");
    expect(linha).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(within(linha).getByRole("link", { name: "NutriViva Ltda" }), { key: "Enter" });
    expect(local.pathname).toBe("/comercial/orcamentos");

    linha.focus();
    fireEvent.keyDown(linha, { key: "Enter" });
    expect(local.pathname).toBe("/comercial/orcamentos/qv-1");
  });

  it("Abrir é link com nome acessível e o mesmo destino da linha", async () => {
    await abrir();
    const abrirLink = await screen.findByRole("link", { name: "Abrir ORC-000444 · V1" });
    expect(abrirLink).toHaveAttribute(
      "href",
      `/comercial/orcamentos/qv-1?voltar=${encodeURIComponent("/comercial/orcamentos")}`,
    );
    // Coluna fixa: a última `td` continua célula; o flex mora num `div` dentro dela.
    const celula = abrirLink.closest("td") as HTMLElement;
    expect(celula.parentElement?.lastElementChild).toBe(celula);
    expect(celula).not.toHaveClass("table__actions");
    expect(abrirLink.closest(".table__actions")).not.toBeNull();
    expect(celula.closest("table")).toHaveClass("table--sticky-actions");
  });

  it("Voltar da página da versão devolve exatamente o recorte e a página de antes", async () => {
    const URL_DO_RECORTE = "/comercial/orcamentos?search=ORC&status=todos&page=2";
    vi.mocked(listQuoteVersions).mockImplementation(async (params) =>
      resposta([versao()], 45, params?.page ?? 1),
    );
    await abrir(URL_DO_RECORTE);
    const antes = ultima();
    expect(antes).toEqual({ search: "ORC", page: 2, pageSize: 20 });

    fireEvent.click(await screen.findByRole("link", { name: "Abrir ORC-000444 · V1" }));
    const voltar = await screen.findByRole("link", { name: "← Voltar para Orçamentos" });

    vi.mocked(listQuoteVersions).mockClear();
    fireEvent.click(voltar);
    await waitFor(() => expect(listQuoteVersions).toHaveBeenCalled());
    expect(`${local.pathname}${local.search}`).toBe(URL_DO_RECORTE);
    expect(ultima()).toEqual(antes);
    expect(busca()).toHaveValue("ORC");
    expect(statusSelect()).toHaveValue("todos");
    expect(await screen.findByText("Página 2 de 3")).toBeInTheDocument();
  });
});
