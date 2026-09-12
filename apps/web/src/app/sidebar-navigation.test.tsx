import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { AuthenticatedUserDTO, NavigationPreferencesDTO, UserRole } from "@veridi/shared";
import { NAVIGATION_PREFERENCE_ID_PATTERN, defaultNavigationPreferences } from "@veridi/shared";

vi.mock("./AuthProvider", () => ({ useAuth: vi.fn() }));
vi.mock("../lib/user-preferences-api", () => ({
  fetchUserPreferences: vi.fn(),
  updateUserPreferences: vi.fn(),
}));
vi.mock("../lib/lots-api", () => ({ lookupLot: vi.fn() }));

import { useAuth } from "./AuthProvider";
import { fetchUserPreferences, updateUserPreferences } from "../lib/user-preferences-api";
import { AppShell } from "./AppShell";
import { navGroups, navItems } from "./navigation";

/**
 * NAVIGATION-SIDEBAR-01 — a navegação do ERP.
 *
 * Monta o `AppShell` de verdade, com o roteador: o que se protege aqui é o
 * que a pessoa vê e faz no menu — onde cada tela mora, o que abre sozinho, o
 * que é gravado como preferência e o que o perfil não pode ver. A API de
 * preferência é trocada por dublê; o contrato dela é provado no teste da API.
 */

const SECOES: [id: string, titulo: string, telas: string[]][] = [
  ["commercial", "Comercial", ["Visão do Cliente", "Projetos", "Amostras", "Pedidos", "Expedições", "Faturamento"]],
  ["production", "Produção", ["Ordens de Produção", "Picking / Consumo", "Formulações"]],
  ["planning", "Planejamento", ["Perfis de Produção", "Calendário de Produção"]],
  ["purchasing", "Compras", ["Ordens de Compra", "Recebimentos", "Item × Fornecedor"]],
  [
    "inventory",
    "Estoque",
    ["Posição de Estoque", "Lotes", "Lotes de Produto Acabado", "Movimentações", "Materiais de Clientes", "Inventário Físico"],
  ],
  ["quality", "Qualidade", ["Documentos / CoA", "Liberação de lotes", "Documentos controlados"]],
  ["master-data", "Cadastros", ["Clientes", "Fornecedores", "Itens de estoque", "Produtos Acabados"]],
  ["management", "Gestão", ["Relatórios", "Precificação"]],
  [
    "models-parameters",
    "Modelos e Parâmetros",
    ["Modelos de Formulação", "Recursos Industriais", "Modelos de Estrutura de Custo", "Políticas de Precificação"],
  ],
  ["administration", "Administração", ["Usuários"]],
];

let mobile = false;
let currentLocation = { pathname: "", search: "" };

function LocationProbe() {
  const location = useLocation();
  currentLocation = { pathname: location.pathname, search: location.search };
  return <p>tela {location.pathname}</p>;
}

/** jsdom não tem `matchMedia`; o shell decide celular × desktop por ele. */
function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: mobile && query === "(max-width: 640px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

interface RenderOptions {
  role?: UserRole;
  prefs?: Partial<NavigationPreferencesDTO>;
  loadFails?: boolean;
}

function renderShell(path: string, { role = "ADMIN", prefs = {}, loadFails = false }: RenderOptions = {}) {
  const user: AuthenticatedUserDTO = {
    id: `usuario-${role.toLowerCase()}`,
    code: "USR-000001",
    name: "Pessoa de Teste",
    email: "pessoa@veridi.local",
    role,
  };
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, refresh: vi.fn(), signOut: vi.fn() });
  if (loadFails) {
    vi.mocked(fetchUserPreferences).mockRejectedValue(new Error("API fora do ar"));
  } else {
    vi.mocked(fetchUserPreferences).mockResolvedValue({
      navigation: { ...defaultNavigationPreferences(), ...prefs },
    });
  }
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<LocationProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

/** Deixa a preferência da API chegar à tela. */
async function carregar() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const menu = () => screen.getByRole("navigation", { name: "Navegação principal" });
const grupo = (titulo: string) => within(menu()).getByRole("button", { name: titulo });
const lista = (id: string) => document.getElementById(`sidebar-grupo-${id}`) as HTMLElement;
const favoritos = () => screen.getByRole("region", { name: "Favoritos" });
const nomes = (elementos: HTMLElement[]) => elementos.map((elemento) => elemento.textContent);
const opcoes = () => screen.getAllByRole("option").map((opcao) => opcao.getAttribute("aria-label"));

/** Última gravação de preferência — depois da pausa de coalescência. */
async function gravou(navigation: Partial<NavigationPreferencesDTO>) {
  await waitFor(
    () =>
      expect(updateUserPreferences).toHaveBeenLastCalledWith(
        { navigation: expect.objectContaining(navigation) },
        { keepalive: false },
      ),
    { timeout: 2000 },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mobile = false;
  stubMatchMedia();
  window.localStorage.clear();
  currentLocation = { pathname: "", search: "" };
  vi.mocked(updateUserPreferences).mockImplementation(async (input) => ({
    navigation: { ...defaultNavigationPreferences(), ...input.navigation },
  }));
});

describe("Navegação do ERP — arquitetura", () => {
  it("Painel no topo e dez seções na ordem do fluxo, cada uma com as suas telas", async () => {
    renderShell("/", { prefs: { openGroups: SECOES.map(([id]) => id) } });
    await carregar();

    const primeiroLink = within(menu()).getAllByRole("link")[0];
    expect(primeiroLink).toHaveTextContent("Painel");
    expect(primeiroLink).toHaveAttribute("href", "/");

    const titulos = [...menu().querySelectorAll("[data-group-toggle]")].map((botao) => botao.textContent);
    expect(titulos).toEqual(SECOES.map(([, titulo]) => titulo));

    for (const [id, , telas] of SECOES) {
      expect(nomes(within(lista(id)).getAllByRole("link")), id).toEqual(telas);
    }
  });

  it("Visão do Cliente abre o Comercial; rótulos novos, endereços de sempre", async () => {
    renderShell("/", { prefs: { openGroups: ["commercial", "models-parameters"] } });
    await carregar();

    const visao = within(lista("commercial")).getAllByRole("link")[0];
    expect(visao).toHaveTextContent("Visão do Cliente");
    expect(visao).toHaveAttribute("href", "/consultas/clientes");
    expect(screen.queryByText("Consulta de Cliente")).toBeNull();

    const modelos = within(lista("models-parameters"));
    expect(modelos.getByRole("link", { name: "Modelos de Formulação" })).toHaveAttribute(
      "href",
      "/producao/templates-formulacao",
    );
    expect(modelos.getByRole("link", { name: "Modelos de Estrutura de Custo" })).toHaveAttribute(
      "href",
      "/gestao/templates-estrutura",
    );
    expect(screen.queryByText(/Templates de/)).toBeNull();
  });

  it("Produtos Acabados é o cadastro; os lotes produzidos ficam em Estoque — nenhuma tela some", async () => {
    renderShell("/", { prefs: { openGroups: ["master-data", "inventory", "production"] } });
    await carregar();

    expect(within(lista("master-data")).getByRole("link", { name: "Produtos Acabados" })).toHaveAttribute(
      "href",
      "/cadastros/produtos",
    );
    expect(within(lista("inventory")).getByRole("link", { name: "Lotes de Produto Acabado" })).toHaveAttribute(
      "href",
      "/producao/produto-acabado",
    );
    expect(nomes(within(lista("production")).getAllByRole("link"))).not.toContain("Produto Acabado");
  });

  it("ids estáveis: únicos e no formato que a API de preferência aceita", () => {
    const ids = [...navItems.map((item) => item.id), ...navGroups.map((group) => group.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(NAVIGATION_PREFERENCE_ID_PATTERN);
  });

  it("o título da aba usa o rótulo novo", async () => {
    renderShell("/consultas/clientes");
    await carregar();
    expect(document.title).toBe("Visão do Cliente · Veridi Nutrition");
  });
});

describe("Navegação do ERP — grupos", () => {
  it("grupo abre e fecha no clique, e a escolha é gravada", async () => {
    const user = userEvent.setup();
    renderShell("/");
    await carregar();

    expect(grupo("Compras")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Recebimentos" })).toBeNull();

    await user.click(grupo("Compras"));
    expect(grupo("Compras")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Recebimentos" })).toBeVisible();
    await gravou({ openGroups: ["purchasing"] });

    await user.click(grupo("Compras"));
    expect(grupo("Compras")).toHaveAttribute("aria-expanded", "false");
    await gravou({ openGroups: [] });
  });

  it("no Painel, sem preferência, tudo começa recolhido", async () => {
    renderShell("/");
    await carregar();
    for (const [, titulo] of SECOES) expect(grupo(titulo)).toHaveAttribute("aria-expanded", "false");
  });

  it("a seção da tela atual abre sozinha, marca a tela e não vira preferência gravada", async () => {
    const user = userEvent.setup();
    renderShell("/compras/recebimentos");
    await carregar();

    expect(grupo("Compras")).toHaveAttribute("aria-expanded", "true");
    expect(within(lista("purchasing")).getByRole("link", { name: "Recebimentos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(grupo("Comercial")).toHaveAttribute("aria-expanded", "false");

    // Fechar a seção aberta sozinha também não grava nada.
    await user.click(grupo("Compras"));
    expect(grupo("Compras")).toHaveAttribute("aria-expanded", "false");
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(updateUserPreferences).not.toHaveBeenCalled();
  });
});

describe("Navegação do ERP — menu compacto", () => {
  it("recolher vira trilho de ícones com dica, o grupo da tela atual fica marcado, e a escolha é gravada", async () => {
    const user = userEvent.setup();
    const { container } = renderShell("/comercial/pedidos");
    await carregar();

    await user.click(screen.getByRole("button", { name: "Recolher menu" }));

    expect(container.querySelector(".shell")).toHaveClass("shell--compact");
    expect(screen.queryByRole("combobox", { name: "Buscar telas" })).toBeNull();
    const comercial = screen.getByRole("button", { name: "Comercial — Pedidos" });
    expect(comercial).toHaveClass("is-active");
    expect(comercial).toHaveAttribute("aria-current", "true");
    await gravou({ compact: true });

    await user.hover(screen.getByRole("button", { name: "Estoque" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Estoque");

    // O ícone abre o menu por cima, sem mudar a preferência; Esc devolve o trilho.
    await user.click(comercial);
    expect(screen.getByRole("link", { name: "Pedidos" })).toHaveAttribute("aria-current", "page");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("link", { name: "Pedidos" })).toBeNull();
    expect(screen.getByRole("button", { name: "Comercial — Pedidos" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Expandir menu" }));
    expect(container.querySelector(".shell")).not.toHaveClass("shell--compact");
    await gravou({ compact: false });
  });

  it("preferência gravada volta: compacto", async () => {
    const { container } = renderShell("/", { prefs: { compact: true } });
    await carregar();

    expect(container.querySelector(".shell")).toHaveClass("shell--compact");
    expect(screen.getByRole("button", { name: "Expandir menu" })).toBeInTheDocument();
    expect(updateUserPreferences).not.toHaveBeenCalled();
  });

  it("preferência gravada volta: grupos abertos e favoritos", async () => {
    renderShell("/", { prefs: { openGroups: ["inventory"], favorites: ["receipts"] } });
    await carregar();

    expect(grupo("Estoque")).toHaveAttribute("aria-expanded", "true");
    expect(nomes(within(favoritos()).getAllByRole("link"))).toEqual(["Recebimentos"]);
  });
});

describe("Navegação do ERP — favoritos", () => {
  it("favoritar põe a tela em Favoritos sem tirá-la da seção; desfavoritar tira; as duas coisas são gravadas", async () => {
    const user = userEvent.setup();
    renderShell("/comercial/pedidos");
    await carregar();

    expect(within(favoritos()).queryAllByRole("link")).toHaveLength(0);
    expect(within(favoritos()).getByText(/Marque ☆/)).toBeInTheDocument();

    const estrela = within(lista("commercial")).getByRole("button", { name: "Favoritar Pedidos" });
    expect(estrela).toHaveAttribute("aria-pressed", "false");
    await user.click(estrela);

    expect(within(favoritos()).getByRole("link", { name: "Pedidos" })).toHaveAttribute("href", "/comercial/pedidos");
    expect(within(lista("commercial")).getByRole("link", { name: "Pedidos" })).toBeInTheDocument();
    expect(estrela).toHaveAttribute("aria-pressed", "true");
    await gravou({ favorites: ["customer-orders"] });

    await user.click(within(favoritos()).getByRole("button", { name: "Favoritar Pedidos" }));
    expect(within(favoritos()).queryByRole("link", { name: "Pedidos" })).toBeNull();
    await gravou({ favorites: [] });
  });

  it("favorito sem permissão, ou de tela que não existe mais, não aparece; seção sem tela permitida some", async () => {
    const user = userEvent.setup();
    renderShell("/", {
      role: "VIEWER",
      prefs: { favorites: ["users", "pricing", "customer-orders", "tela-que-saiu"], openGroups: ["grupo-que-saiu"] },
    });
    await carregar();

    expect(nomes(within(favoritos()).getAllByRole("link"))).toEqual(["Pedidos"]);
    expect(within(menu()).queryByRole("button", { name: "Administração" })).toBeNull();

    await user.click(grupo("Gestão"));
    expect(nomes(within(lista("management")).getAllByRole("link"))).toEqual(["Relatórios"]);
  });
});

describe("Navegação do ERP — busca de telas", () => {
  it("acha pelo rótulo e pela seção, mostra onde a tela mora, e Enter navega", async () => {
    const user = userEvent.setup();
    renderShell("/");
    await carregar();
    const busca = screen.getByRole("combobox", { name: "Buscar telas" });

    await user.type(busca, "cliente");
    expect(opcoes()).toEqual([
      "Cadastros › Clientes",
      "Comercial › Visão do Cliente",
      "Estoque › Materiais de Clientes",
    ]);

    await user.clear(busca);
    await user.type(busca, "receb");
    expect(opcoes()).toEqual(["Compras › Recebimentos"]);
    await user.keyboard("{Enter}");
    expect(currentLocation.pathname).toBe("/compras/recebimentos");
    expect(busca).toHaveValue("");
  });

  it("setas percorrem os resultados e Enter abre o destacado", async () => {
    const user = userEvent.setup();
    renderShell("/");
    await carregar();
    const busca = screen.getByRole("combobox", { name: "Buscar telas" });

    await user.type(busca, "lotes");
    expect(opcoes()).toEqual([
      "Estoque › Lotes",
      "Estoque › Lotes de Produto Acabado",
      "Qualidade › Liberação de lotes",
    ]);
    const [primeira, segunda] = screen.getAllByRole("option");
    expect(busca).toHaveAttribute("aria-activedescendant", primeira?.id);

    await user.keyboard("{ArrowDown}");
    expect(busca).toHaveAttribute("aria-activedescendant", segunda?.id);
    await user.keyboard("{Enter}");
    expect(currentLocation.pathname).toBe("/producao/produto-acabado");
  });

  it("não mostra tela sem acesso", async () => {
    const user = userEvent.setup();
    renderShell("/", { role: "VIEWER" });
    await carregar();
    const busca = screen.getByRole("combobox", { name: "Buscar telas" });

    await user.type(busca, "usuár");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("Nenhuma tela encontrada.");

    await user.clear(busca);
    await user.type(busca, "precifica");
    expect(opcoes()).toEqual(["Modelos e Parâmetros › Políticas de Precificação"]);
  });

  it("Ctrl+K e Cmd+K focam a busca; Esc fecha", async () => {
    const user = userEvent.setup();
    renderShell("/");
    await carregar();
    const busca = screen.getByRole("combobox", { name: "Buscar telas" });

    await user.keyboard("{Control>}k{/Control}");
    expect(busca).toHaveFocus();
    await user.type(busca, "pedi");
    await user.keyboard("{Escape}");
    expect(busca).toHaveValue("");
    expect(busca).not.toHaveFocus();

    await user.keyboard("{Meta>}k{/Meta}");
    expect(busca).toHaveFocus();
  });

  it("no menu compacto, Ctrl+K abre o menu por cima com a busca focada; Esc devolve o trilho", async () => {
    const user = userEvent.setup();
    renderShell("/", { prefs: { compact: true } });
    await carregar();

    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("combobox", { name: "Buscar telas" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox", { name: "Buscar telas" })).toBeNull();
    expect(screen.getByRole("button", { name: /Buscar telas/ })).toHaveFocus();
  });
});

describe("Navegação do ERP — celular e falhas", () => {
  it("celular: drawer com busca, favoritos e grupos; tocar numa tela navega e fecha", async () => {
    mobile = true;
    stubMatchMedia();
    const user = userEvent.setup();
    // Compacto é preferência de desktop: no celular o menu é sempre expandido.
    const { container } = renderShell("/", { prefs: { compact: true } });
    await carregar();
    const shell = container.querySelector(".shell");

    expect(shell).not.toHaveClass("shell--compact");
    await user.click(screen.getByRole("button", { name: "Abrir menu" }));
    expect(shell).toHaveClass("shell--nav-open");
    expect(screen.getByRole("combobox", { name: "Buscar telas" })).toBeInTheDocument();
    expect(favoritos()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recolher menu" })).toBeNull();

    await user.click(grupo("Comercial"));
    await user.click(within(lista("commercial")).getByRole("link", { name: "Pedidos" }));
    expect(currentLocation.pathname).toBe("/comercial/pedidos");
    expect(shell).not.toHaveClass("shell--nav-open");
  });

  it("API de preferência fora do ar não trava o menu: favorita, navega e segue", async () => {
    vi.mocked(updateUserPreferences).mockRejectedValue(new Error("API fora do ar"));
    const user = userEvent.setup();
    renderShell("/comercial/pedidos", { loadFails: true });
    await carregar();

    expect(grupo("Comercial")).toHaveAttribute("aria-expanded", "true");
    await user.click(within(lista("commercial")).getByRole("button", { name: "Favoritar Pedidos" }));
    await waitFor(() => expect(updateUserPreferences).toHaveBeenCalled(), { timeout: 2000 });
    expect(within(favoritos()).getByRole("link", { name: "Pedidos" })).toBeInTheDocument();

    await user.click(within(lista("commercial")).getByRole("link", { name: "Projetos" }));
    expect(currentLocation.pathname).toBe("/comercial/projetos");
  });
});
