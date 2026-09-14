import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { AuthenticatedUserDTO } from "@veridi/shared";
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
import { navGroups, searchNavigation } from "./navigation";
import { useTituloDaTela } from "./titulo-da-tela";

/**
 * QUOTES-HUB-01 e QUOTE-PAGE-NAV-ACTIVE-01 — Orçamentos no menu e na aba.
 *
 * Antes, na página de uma versão de orçamento, nenhum item do menu ficava
 * aceso e a aba dizia só "Veridi Nutrition". Agora Comercial → Orçamentos é o
 * item da lista geral E da página de cada versão, e a aba diz qual orçamento
 * está aberto. Monta o `AppShell` de verdade, com o roteador.
 */

let local = { pathname: "", search: "" };

function Sonda() {
  const location = useLocation();
  local = { pathname: location.pathname, search: location.search };
  return <p>tela {location.pathname}</p>;
}

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

function renderShell(path: string, telas?: ReactNode) {
  const user: AuthenticatedUserDTO = {
    id: "usuario-admin",
    code: "USR-000001",
    name: "Pessoa de Teste",
    email: "pessoa@veridi.local",
    role: "ADMIN",
  };
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, refresh: vi.fn(), signOut: vi.fn() });
  vi.mocked(fetchUserPreferences).mockResolvedValue({ navigation: defaultNavigationPreferences() });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          {telas}
          <Route path="*" element={<Sonda />} />
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

const comercial = () => within(document.getElementById("sidebar-grupo-commercial") as HTMLElement);

/** A página da versão enquanto carrega: o nome só chega com os dados. */
function VersaoCarregando() {
  const [titulo, setTitulo] = useState<string | null>(null);
  useTituloDaTela(titulo);
  return (
    <button type="button" onClick={() => setTitulo("ORC-000444 · V1")}>
      dados chegaram
    </button>
  );
}

/** Nome já na montagem — o mesmo commit do efeito de título do shell. */
function VersaoPronta() {
  useTituloDaTela("ORC-000445 · V2");
  return <p>versão pronta</p>;
}

beforeEach(() => {
  vi.clearAllMocks();
  stubMatchMedia();
  window.localStorage.clear();
  local = { pathname: "", search: "" };
  vi.mocked(updateUserPreferences).mockImplementation(async (input) => ({
    navigation: { ...defaultNavigationPreferences(), ...input.navigation },
  }));
});

describe("Comercial → Orçamentos no menu", () => {
  it("mora no Comercial, logo depois de Projetos, e abre a lista geral", async () => {
    renderShell("/comercial/orcamentos");
    await carregar();

    const nomes = comercial()
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(nomes.indexOf("Orçamentos")).toBe(nomes.indexOf("Projetos") + 1);
    expect(comercial().getByRole("link", { name: "Orçamentos" })).toHaveAttribute(
      "href",
      "/comercial/orcamentos",
    );
  });

  it.each([
    ["na lista geral", "/comercial/orcamentos"],
    ["na lista filtrada", "/comercial/orcamentos?status=todos&page=2"],
    ["na página de uma versão", "/comercial/orcamentos/qv-1"],
    [
      "na página de uma versão aberta pelo Projeto",
      `/comercial/orcamentos/qv-1?voltar=${encodeURIComponent("/comercial/projetos/prj-1")}`,
    ],
  ])("%s, Orçamentos é o item ativo — e Projetos não", async (_caso, rota) => {
    renderShell(rota);
    await carregar();

    expect(comercial().getByRole("link", { name: "Orçamentos" })).toHaveAttribute("aria-current", "page");
    expect(comercial().getByRole("link", { name: "Projetos" })).not.toHaveAttribute("aria-current");
  });

  it("a busca de telas acha Orçamentos primeiro por 'orçamento', e diz onde mora", () => {
    const [primeiro] = searchNavigation("orcamento", navGroups);
    expect(primeiro?.item.label).toBe("Orçamentos");
    expect(primeiro?.breadcrumb).toBe("Comercial › Orçamentos");
    expect(searchNavigation("cotação", navGroups)[0]?.item.label).toBe("Orçamentos");
  });
});

describe("título da aba", () => {
  it("lista geral: o nome do item de menu", async () => {
    renderShell("/comercial/orcamentos?status=todos");
    await carregar();
    expect(document.title).toBe("Orçamentos · Veridi Nutrition");
  });

  it("página da versão: o do menu enquanto carrega, e o do orçamento quando os dados chegam", async () => {
    const user = userEvent.setup();
    renderShell("/comercial/orcamentos/qv-1", (
      <Route path="/comercial/orcamentos/:id" element={<VersaoCarregando />} />
    ));
    await carregar();
    expect(document.title).toBe("Orçamentos · Veridi Nutrition");

    await user.click(screen.getByRole("button", { name: "dados chegaram" }));
    await waitFor(() => expect(document.title).toBe("ORC-000444 · V1 · Veridi Nutrition"));
  });

  it("nome entregue já na montagem não é apagado pelo título do menu", async () => {
    renderShell("/comercial/orcamentos/qv-2", (
      <Route path="/comercial/orcamentos/:id" element={<VersaoPronta />} />
    ));
    await carregar();
    await waitFor(() => expect(document.title).toBe("ORC-000445 · V2 · Veridi Nutrition"));
  });

  it("sair da versão devolve o título do menu da tela nova", async () => {
    const user = userEvent.setup();
    renderShell("/comercial/orcamentos/qv-2", (
      <Route path="/comercial/orcamentos/:id" element={<VersaoPronta />} />
    ));
    await carregar();
    await waitFor(() => expect(document.title).toBe("ORC-000445 · V2 · Veridi Nutrition"));

    await user.click(comercial().getByRole("link", { name: "Pedidos" }));
    await waitFor(() => expect(local.pathname).toBe("/comercial/pedidos"));
    await waitFor(() => expect(document.title).toBe("Pedidos · Veridi Nutrition"));
  });
});
