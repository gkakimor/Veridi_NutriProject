import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { AuthenticatedUserDTO, NavigationPreferencesDTO } from "@veridi/shared";
import { defaultNavigationPreferences } from "@veridi/shared";

vi.mock("./AuthProvider", () => ({ useAuth: vi.fn() }));
vi.mock("../lib/user-preferences-api", () => ({
  fetchUserPreferences: vi.fn(),
  updateUserPreferences: vi.fn(),
}));
vi.mock("../lib/lots-api", () => ({ lookupLot: vi.fn() }));

import { useAuth } from "./AuthProvider";
import { fetchUserPreferences, updateUserPreferences } from "../lib/user-preferences-api";
import { AppShell } from "./AppShell";
import { navItems } from "./navigation";

/**
 * NAVIGATION-INFORMATION-ARCHITECTURE-01 — Produção fica só com a operação
 * (Ordens de Produção, Picking / Consumo); Formulações e os itens do antigo
 * "Modelos e Parâmetros" moram em "Cadastros e Configurações"; Gestão segue
 * com Relatórios e Precificação. Só a arquitetura do menu mudou: endereços,
 * ids (favoritos) e busca de telas continuam os mesmos.
 */

function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
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

function renderShell(path: string, prefs: Partial<NavigationPreferencesDTO> = {}) {
  const user: AuthenticatedUserDTO = {
    id: "usuario-admin",
    code: "USR-000001",
    name: "Pessoa de Teste",
    email: "pessoa@veridi.local",
    role: "ADMIN",
  };
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, refresh: vi.fn(), signOut: vi.fn() });
  vi.mocked(fetchUserPreferences).mockResolvedValue({
    navigation: { ...defaultNavigationPreferences(), ...prefs },
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<p>tela</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

async function carregar() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const CADASTROS = "Cadastros e Configurações";
const menu = () => screen.getByRole("navigation", { name: "Navegação principal" });
const grupo = (titulo: string) => within(menu()).getByRole("button", { name: titulo });
const opcoes = () => screen.getAllByRole("option").map((opcao) => opcao.getAttribute("aria-label"));

beforeEach(() => {
  vi.clearAllMocks();
  stubMatchMedia();
  window.localStorage.clear();
  vi.mocked(updateUserPreferences).mockImplementation(async (input) => ({
    navigation: { ...defaultNavigationPreferences(), ...input.navigation },
  }));
});

describe("Arquitetura do menu — rotas e ids de sempre", () => {
  it("nenhum endereço nem id de tela mudou: favoritos e deep links continuam valendo", () => {
    expect(Object.fromEntries(navItems.map((item) => [item.id, item.path]))).toEqual({
      dashboard: "/",
      "customer-view": "/consultas/clientes",
      projects: "/comercial/projetos",
      quotes: "/comercial/orcamentos",
      samples: "/comercial/amostras",
      "customer-orders": "/comercial/pedidos",
      shipments: "/comercial/expedicoes",
      billing: "/comercial/faturamento",
      "production-orders": "/producao/ordens",
      picking: "/producao/picking",
      "production-profiles": "/planejamento/perfis-producao",
      "production-board": "/planejamento/quadro",
      "production-calendar": "/planejamento/calendario",
      "purchase-orders": "/compras/ordens",
      receipts: "/compras/recebimentos",
      "supplier-items": "/compras/item-fornecedor",
      "stock-position": "/estoque",
      lots: "/estoque/lotes",
      "finished-goods": "/producao/produto-acabado",
      "stock-movements": "/estoque/movimentacoes",
      "customer-materials": "/estoque/materiais-de-clientes",
      "stock-count": "/estoque/inventario",
      "quality-documents": "/qualidade/documentos",
      "lot-release": "/estoque/lotes?status=AWAITING_RELEASE",
      "controlled-documents": "/administracao/documentos",
      customers: "/cadastros/clientes",
      suppliers: "/cadastros/fornecedores",
      "stock-items": "/cadastros/itens",
      products: "/cadastros/produtos",
      formulations: "/producao/formulacoes",
      "formulation-templates": "/producao/templates-formulacao",
      "industrial-resources": "/gestao/recursos-industriais",
      "cost-templates": "/gestao/templates-estrutura",
      "pricing-policies": "/gestao/politicas-precificacao",
      "management-dashboard": "/gestao/painel-gerencial",
      reports: "/relatorios",
      pricing: "/gestao/precificacao",
      users: "/administracao/usuarios",
    });
  });
});

describe("Arquitetura do menu — seção ativa", () => {
  it.each([
    ["/producao/formulacoes", "Formulações"],
    ["/producao/formulacoes/produto-1", "Formulações"],
    ["/producao/templates-formulacao", "Modelos de Formulação"],
    ["/gestao/recursos-industriais", "Recursos Industriais"],
    ["/gestao/templates-estrutura", "Modelos de Estrutura de Custo"],
    ["/gestao/politicas-precificacao", "Políticas de Precificação"],
  ])("%s acende Cadastros e Configurações (e não Produção nem Gestão)", async (path, tela) => {
    renderShell(path);
    await carregar();

    expect(grupo(CADASTROS)).toHaveAttribute("aria-expanded", "true");
    expect(grupo(CADASTROS)).toHaveClass("has-active");
    expect(within(menu()).getByRole("link", { name: tela })).toHaveAttribute("aria-current", "page");
    for (const outro of ["Produção", "Gestão"]) {
      expect(grupo(outro), outro).toHaveAttribute("aria-expanded", "false");
      expect(grupo(outro), outro).not.toHaveClass("has-active");
    }
  });

  it("no menu compacto, Formulações marca o ícone de Cadastros e Configurações, não o de Produção", async () => {
    renderShell("/producao/formulacoes", { compact: true });
    await carregar();

    expect(screen.getByRole("button", { name: `${CADASTROS} — Formulações` })).toHaveClass("is-active");
    expect(screen.getByRole("button", { name: "Produção" })).not.toHaveClass("is-active");
  });

  it.each([
    ["/relatorios", "Relatórios"],
    ["/gestao/precificacao", "Precificação"],
  ])("%s continua acendendo Gestão", async (path, tela) => {
    renderShell(path);
    await carregar();

    expect(grupo("Gestão")).toHaveClass("has-active");
    expect(within(menu()).getByRole("link", { name: tela })).toHaveAttribute("aria-current", "page");
    expect(grupo(CADASTROS)).not.toHaveClass("has-active");
  });

  it("Produção acende só na operação", async () => {
    renderShell("/producao/picking");
    await carregar();

    expect(grupo("Produção")).toHaveClass("has-active");
    expect(grupo(CADASTROS)).not.toHaveClass("has-active");
  });
});

describe("Arquitetura do menu — favoritos e busca", () => {
  it("favoritos das telas que mudaram de seção seguem na ordem gravada; grupo antigo aberto é ignorado sem regravar", async () => {
    renderShell("/", {
      favorites: ["formulations", "formulation-templates", "industrial-resources", "cost-templates", "pricing-policies"],
      openGroups: ["models-parameters"],
    });
    await carregar();

    const favoritos = within(screen.getByRole("region", { name: "Favoritos" })).getAllByRole("link");
    expect(favoritos.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Formulações", "/producao/formulacoes"],
      ["Modelos de Formulação", "/producao/templates-formulacao"],
      ["Recursos Industriais", "/gestao/recursos-industriais"],
      ["Modelos de Estrutura de Custo", "/gestao/templates-estrutura"],
      ["Políticas de Precificação", "/gestao/politicas-precificacao"],
    ]);
    expect(grupo(CADASTROS)).toHaveAttribute("aria-expanded", "false");
    expect(within(menu()).queryByRole("button", { name: "Modelos e Parâmetros" })).toBeNull();
    expect(updateUserPreferences).not.toHaveBeenCalled();
  });

  it("Formulações é achada por 'formulação', 'formulações', 'fórmula' e 'receita', uma vez só e na seção nova", async () => {
    const user = userEvent.setup();
    renderShell("/");
    await carregar();
    const busca = screen.getByRole("combobox", { name: "Buscar telas" });

    await user.type(busca, "formulação");
    expect(opcoes()).toEqual([`${CADASTROS} › Modelos de Formulação`, `${CADASTROS} › Formulações`]);

    for (const termo of ["formulações", "receita"]) {
      await user.clear(busca);
      await user.type(busca, termo);
      expect(opcoes(), termo).toEqual([`${CADASTROS} › Formulações`]);
    }

    await user.clear(busca);
    await user.type(busca, "fórmula");
    const resultados = opcoes();
    expect(resultados).toContain(`${CADASTROS} › Formulações`);
    expect(new Set(resultados).size).toBe(resultados.length);
    expect(resultados.some((opcao) => opcao?.startsWith("Produção ›"))).toBe(false);
  });

  it("quem procurava pela seção antiga ('parâmetros') ainda acha as quatro telas", async () => {
    const user = userEvent.setup();
    renderShell("/");
    await carregar();

    await user.type(screen.getByRole("combobox", { name: "Buscar telas" }), "parâmetros");
    expect(opcoes()).toEqual([
      `${CADASTROS} › Modelos de Formulação`,
      `${CADASTROS} › Recursos Industriais`,
      `${CADASTROS} › Modelos de Estrutura de Custo`,
      `${CADASTROS} › Políticas de Precificação`,
    ]);
  });
});
