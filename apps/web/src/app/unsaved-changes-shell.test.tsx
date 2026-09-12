import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { AuthenticatedUserDTO } from "@veridi/shared";
import { defaultNavigationPreferences } from "@veridi/shared";

/**
 * A guarda dentro do shell de verdade — masthead, sidebar e workspace.
 *
 * Duas decisões do PO moram aqui:
 *
 * 1. com um modal de workspace aberto, a SIDEBAR continua clicável. Ela era
 *    inerte junto com o resto do fundo, e o cadastro virava beco sem saída:
 *    para ir a qualquer outra tela era obrigatório fechar o modal. O masthead
 *    continua protegido — a busca global do topo não é saída de navegação;
 * 2. no celular a sidebar é drawer, e escolher outro item com formulário sujo
 *    passa pela mesma pergunta. Confirmando a saída, o drawer não pode ficar
 *    preso nem deixar o fundo escurecido para trás.
 */

vi.mock("./AuthProvider", () => ({ useAuth: vi.fn() }));
vi.mock("../lib/user-preferences-api", () => ({
  fetchUserPreferences: vi.fn(),
  updateUserPreferences: vi.fn(),
}));
vi.mock("../lib/lots-api", () => ({ lookupLot: vi.fn() }));

import { useAuth } from "./AuthProvider";
import { fetchUserPreferences, updateUserPreferences } from "../lib/user-preferences-api";
import { AppShell } from "./AppShell";
import { FullWorkspaceModal } from "../components/FullWorkspaceModal";
import { UnsavedChangesProvider } from "./UnsavedChangesProvider";
import { useUnsavedChangesGuard } from "./use-unsaved-changes-guard";

let celular = false;

/** jsdom não tem `matchMedia`; o shell decide celular × desktop por ele. */
function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: celular && query === "(max-width: 640px)",
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

function Formulario() {
  const [valor, setValor] = useState("");
  useUnsavedChangesGuard({ isDirty: valor !== "", substantivo: "projeto" });
  return (
    <label>
      Nome do projeto
      <input value={valor} onChange={(evento) => setValor(evento.target.value)} />
    </label>
  );
}

function TelaComModal() {
  return (
    <FullWorkspaceModal
      open
      onClose={() => undefined}
      crumb="Comercial"
      crumbActive="Projetos"
      title="Novo projeto"
      footer={null}
    >
      <Formulario />
    </FullWorkspaceModal>
  );
}

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

function montar(tela: React.ReactNode) {
  const user: AuthenticatedUserDTO = {
    id: "usuario-admin",
    code: "USR-000001",
    name: "Pessoa de Teste",
    email: "pessoa@veridi.local",
    role: "ADMIN",
  };
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, refresh: vi.fn(), signOut: vi.fn() });
  vi.mocked(fetchUserPreferences).mockResolvedValue({
    navigation: { ...defaultNavigationPreferences(), openGroups: ["commercial"] },
  });

  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route element={<AppShell />}>
          <Route path="/comercial/projetos" element={tela} />
          <Route path="/comercial/pedidos" element={<h1>Tela de Pedidos</h1>} />
        </Route>
      </Route>,
    ),
    { initialEntries: ["/comercial/projetos"] },
  );
  render(<RouterProvider router={router} />);
}

const shell = () => document.querySelector(".shell") as HTMLElement;
const sidebar = () => document.getElementById("sidebar") as HTMLElement;
const masthead = () => document.querySelector("header.masthead") as HTMLElement;
const itemDoMenu = (nome: string) => screen.getByRole("link", { name: nome });

beforeEach(() => {
  vi.clearAllMocks();
  celular = false;
  stubMatchMedia();
  window.localStorage.clear();
  vi.mocked(updateUserPreferences).mockResolvedValue({
    navigation: defaultNavigationPreferences(),
  });
});

describe("modal de workspace — a sidebar é saída, o masthead não", () => {
  it("com o modal aberto, a sidebar continua alcançável e o masthead fica inerte", async () => {
    montar(<TelaComModal />);
    await screen.findByText("Novo projeto");

    expect(sidebar()).not.toHaveAttribute("inert");
    expect(masthead()).toHaveAttribute("inert");
    // A busca global do topo continua fora de alcance junto com ele.
    expect(screen.queryByRole("searchbox", { name: "Buscar ou escanear lote" })).toBeNull();
  });

  it("o item do menu leva à outra tela sem passar pelo modal", async () => {
    const user = userEvent.setup();
    montar(<TelaComModal />);
    await screen.findByText("Novo projeto");

    await user.click(itemDoMenu("Pedidos"));

    expect(await screen.findByRole("heading", { name: "Tela de Pedidos" })).toBeInTheDocument();
  });
});

describe("celular — drawer da sidebar com formulário sujo", () => {
  it("escolher outro item pergunta, e confirmar a saída não deixa o drawer preso", async () => {
    const user = userEvent.setup();
    celular = true;
    montar(<Formulario />);

    await user.click(screen.getByRole("button", { name: "Abrir menu" }));
    await waitFor(() => expect(shell()).toHaveClass("shell--nav-open"));

    await user.type(screen.getByLabelText("Nome do projeto"), "Whey");
    await user.click(itemDoMenu("Pedidos"));

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));

    expect(await screen.findByRole("heading", { name: "Tela de Pedidos" })).toBeInTheDocument();
    // Nem drawer aberto nem fundo escurecido sobrando por cima da tela nova.
    await waitFor(() => expect(shell()).not.toHaveClass("shell--nav-open"));
    expect(document.querySelector(".sidebar-backdrop")).toBeNull();
  });
});
