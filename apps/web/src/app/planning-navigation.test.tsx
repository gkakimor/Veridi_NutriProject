import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { AuthenticatedUserDTO, NavigationPreferencesDTO, UserRole } from "@veridi/shared";
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

/**
 * Planejamento no menu — PLANNING-PRODUCTION-PROFILE-01, segunda rodada.
 *
 * A arquitetura inteira da navegação já é provada em
 * `sidebar-navigation.test.tsx`. Aqui fica só o que é da seção nova: ela
 * existe no lugar combinado, a tela é achável e favoritável pelo id estável,
 * a seção abre sozinha na tela dela, e preferência gravada ANTES de
 * Planejamento existir continua funcionando.
 */

let mobile = false;
let currentLocation = { pathname: "", search: "" };

function LocationProbe() {
  const location = useLocation();
  currentLocation = { pathname: location.pathname, search: location.search };
  return <p>tela {location.pathname}</p>;
}

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

function renderShell(
  path: string,
  { role = "ADMIN", prefs = {} }: { role?: UserRole; prefs?: Partial<NavigationPreferencesDTO> } = {},
) {
  const user: AuthenticatedUserDTO = {
    id: "usuario-teste",
    code: "USR-000001",
    name: "Pessoa de Teste",
    email: "pessoa@veridi.local",
    role,
  };
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, refresh: vi.fn(), signOut: vi.fn() });
  vi.mocked(fetchUserPreferences).mockResolvedValue({
    navigation: { ...defaultNavigationPreferences(), ...prefs },
  });
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
const opcoes = () => screen.getAllByRole("option").map((opcao) => opcao.getAttribute("aria-label"));

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

describe("Planejamento no menu", () => {
  it("a seção fica entre Produção e Compras, com Roteiros de Produção dentro", async () => {
    renderShell("/", { prefs: { openGroups: ["planning"] } });
    await carregar();

    const titulos = [...menu().querySelectorAll("[data-group-toggle]")].map((botao) => botao.textContent);
    expect(titulos.slice(titulos.indexOf("Produção"), titulos.indexOf("Produção") + 3)).toEqual([
      "Produção",
      "Planejamento",
      "Compras",
    ]);

    const tela = within(lista("planning")).getByRole("link", { name: "Roteiros de Produção" });
    expect(tela).toHaveAttribute("href", "/planejamento/perfis-producao");
  });

  it("a busca acha pelo rótulo e pelo apelido, e Enter abre a tela", async () => {
    const user = userEvent.setup();
    renderShell("/");
    await carregar();
    const busca = screen.getByRole("combobox", { name: "Buscar telas" });

    await user.type(busca, "roteiros de produ");
    expect(opcoes()).toEqual(["Planejamento › Roteiros de Produção"]);

    await user.clear(busca);
    await user.type(busca, "roteiro");
    expect(opcoes()).toEqual(["Planejamento › Roteiros de Produção"]);

    await user.keyboard("{Enter}");
    expect(currentLocation.pathname).toBe("/planejamento/perfis-producao");
  });

  it("favoritar grava o id estável da tela", async () => {
    const user = userEvent.setup();
    renderShell("/", { prefs: { openGroups: ["planning"] } });
    await carregar();

    await user.click(within(lista("planning")).getByRole("button", { name: "Favoritar Roteiros de Produção" }));

    expect(within(favoritos()).getByRole("link", { name: "Roteiros de Produção" })).toHaveAttribute(
      "href",
      "/planejamento/perfis-producao",
    );
    await waitFor(
      () =>
        expect(updateUserPreferences).toHaveBeenLastCalledWith(
          { navigation: expect.objectContaining({ favorites: ["production-profiles"] }) },
          { keepalive: false },
        ),
      { timeout: 2000 },
    );
  });

  it("na tela de Roteiros de Produção a seção abre sozinha e a tela fica marcada", async () => {
    renderShell("/planejamento/perfis-producao");
    await carregar();

    expect(grupo("Planejamento")).toHaveAttribute("aria-expanded", "true");
    expect(within(lista("planning")).getByRole("link", { name: "Roteiros de Produção" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("preferência gravada antes de Planejamento existir continua valendo", async () => {
    renderShell("/", {
      prefs: { openGroups: ["commercial"], favorites: ["customer-orders"] },
    });
    await carregar();

    expect(grupo("Comercial")).toHaveAttribute("aria-expanded", "true");
    expect(grupo("Planejamento")).toHaveAttribute("aria-expanded", "false");
    expect(within(favoritos()).getByRole("link", { name: "Pedidos" })).toBeInTheDocument();
    expect(updateUserPreferences).not.toHaveBeenCalled();
  });

  it("todo perfil autorizado à tela enxerga a seção — inclusive no celular", async () => {
    mobile = true;
    stubMatchMedia();
    const user = userEvent.setup();
    renderShell("/", { role: "VIEWER", prefs: { openGroups: ["planning"] } });
    await carregar();

    await user.click(screen.getByRole("button", { name: "Abrir menu" }));
    expect(grupo("Planejamento")).toBeInTheDocument();
    expect(within(lista("planning")).getByRole("link", { name: "Roteiros de Produção" })).toBeInTheDocument();
  });
});
