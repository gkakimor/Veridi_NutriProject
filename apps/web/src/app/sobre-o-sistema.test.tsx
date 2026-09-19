import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, RouterProvider, createMemoryRouter, createRoutesFromElements } from "react-router-dom";
import type { AuthenticatedUserDTO, SystemMetaDTO } from "@veridi/shared";
import { defaultNavigationPreferences } from "@veridi/shared";

/**
 * Versão no cabeçalho e "Sobre o sistema" (VERIDI-SYSTEM-VERSIONING-01).
 *
 * O cabeçalho mostra só "v1.0.0", colado em "Nutrition". O clique abre "Sobre
 * o sistema", que pergunta à API o ambiente e o build — a tela nunca afirma
 * "Produção" por conta própria. Busca e usuário seguem onde e como estavam.
 */

vi.mock("./AuthProvider", () => ({ useAuth: vi.fn() }));
vi.mock("../lib/user-preferences-api", () => ({
  fetchUserPreferences: vi.fn(),
  updateUserPreferences: vi.fn(),
}));
vi.mock("../lib/lots-api", () => ({ lookupLot: vi.fn() }));
vi.mock("../lib/system-api", () => ({ fetchSystemMeta: vi.fn() }));

import { useAuth } from "./AuthProvider";
import { fetchUserPreferences, updateUserPreferences } from "../lib/user-preferences-api";
import { lookupLot } from "../lib/lots-api";
import { fetchSystemMeta } from "../lib/system-api";
import { AppShell } from "./AppShell";

const SHA = "ff861c90512232bb5a168c304a186747150576d0";
const signOut = vi.fn();

function meta(parcial: Partial<SystemMetaDTO> = {}): SystemMetaDTO {
  return { version: "1.0.0", environment: "production", commitHash: SHA, ...parcial };
}

function montar() {
  const user: AuthenticatedUserDTO = {
    id: "usuario-consulta",
    code: "USR-000009",
    name: "Pessoa de Consulta",
    email: "consulta@veridi.local",
    role: "VIEWER",
  };
  vi.mocked(useAuth).mockReturnValue({ user, loading: false, refresh: vi.fn(), signOut });
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<AppShell />}>
        <Route path="/" element={<h1>Painel</h1>} />
      </Route>,
    ),
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
  return { user: userEvent.setup() };
}

const cabecalho = () => document.querySelector("header.masthead") as HTMLElement;
const versao = () => within(cabecalho()).getByRole("button", { name: "v1.0.0" });
const dialogo = () => screen.getByRole("dialog", { name: "Sobre o sistema" });

/** Valor da linha `rotulo` da lista de fatos do diálogo. */
function fato(rotulo: string): string {
  const termo = within(dialogo())
    .getAllByRole("term")
    .find((dt) => dt.textContent === rotulo);
  if (!termo) throw new Error(`sem a linha "${rotulo}" no diálogo`);
  return termo.nextElementSibling?.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
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
  window.localStorage.clear();
  vi.mocked(fetchUserPreferences).mockResolvedValue({ navigation: defaultNavigationPreferences() });
  vi.mocked(updateUserPreferences).mockResolvedValue({ navigation: defaultNavigationPreferences() });
});

describe("cabeçalho — versão ao lado de Nutrition", () => {
  it("mostra v1.0.0 e só isso: nem build nem SHA, e nenhuma consulta antes do clique", () => {
    montar();

    expect(versao()).toBeInTheDocument();
    expect(cabecalho()).not.toHaveTextContent(SHA.slice(0, 8));
    expect(cabecalho()).not.toHaveTextContent("Produção");
    expect(fetchSystemMeta).not.toHaveBeenCalled();
  });

  it("fica colada em Nutrition, no bloco da marca — longe do usuário", () => {
    montar();

    const marca = within(cabecalho()).getByRole("link", { name: /Veridi\s*Nutrition/ });
    expect(marca.nextElementSibling).toBe(versao());
    expect(marca.parentElement).toHaveClass("masthead__identity");
    // Botão dentro de link não é HTML válido, e a marca continua levando ao Painel.
    expect(marca).not.toContainElement(versao());
    expect(document.querySelector(".masthead__user")).not.toContainElement(versao());
  });

  it("não mexe na busca nem no usuário: mesma ordem no topo, e os dois seguem funcionando", async () => {
    vi.mocked(lookupLot).mockResolvedValue(null);
    const { user } = montar();

    const filhos = Array.from(cabecalho().children).map((filho) => filho.className);
    expect(filhos).toEqual(["masthead__identity", "masthead__search-wrap", "masthead__user"]);

    await user.type(screen.getByLabelText("Buscar ou escanear lote"), "L-000123{Enter}");
    expect(lookupLot).toHaveBeenCalledWith("L-000123");

    const usuario = document.querySelector(".masthead__user") as HTMLElement;
    expect(usuario).toHaveTextContent("Pessoa de Consulta");
    await user.click(within(usuario).getByRole("button", { name: "Sair" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe("Sobre o sistema", () => {
  it("abre no clique da versão com produto, versão, data, ambiente e build abreviado", async () => {
    vi.mocked(fetchSystemMeta).mockResolvedValue(meta());
    const { user } = montar();

    await user.click(versao());

    expect(dialogo()).toBeInTheDocument();
    expect(within(dialogo()).getByText("Veridi Nutrition")).toBeInTheDocument();
    expect(fato("Versão")).toBe("v1.0.0");
    expect(fato("Data da versão")).toBe("19/09/2026");
    await waitFor(() => expect(fato("Ambiente")).toBe("Produção"));
    expect(fato("Build")).toBe("ff861c90");
    expect(dialogo()).not.toHaveTextContent(SHA);
    expect(fetchSystemMeta).toHaveBeenCalledTimes(1);
  });

  it("o ambiente é o da API: desenvolvimento, e nome sem tradução como veio", async () => {
    vi.mocked(fetchSystemMeta).mockResolvedValueOnce(meta({ environment: "development", commitHash: null }));
    const { user } = montar();

    await user.click(versao());
    await waitFor(() => expect(fato("Ambiente")).toBe("Desenvolvimento"));
    // Fora do Railway não há commit publicado: a tela diz isso, não inventa build.
    expect(fato("Build")).toBe("Não informado");

    await user.click(within(dialogo()).getByRole("button", { name: "Fechar" }));
    vi.mocked(fetchSystemMeta).mockResolvedValueOnce(meta({ environment: "homologacao" }));
    await user.click(versao());
    await waitFor(() => expect(fato("Ambiente")).toBe("homologacao"));
  });

  it("enquanto a API não responde, não afirma ambiente nenhum", async () => {
    vi.mocked(fetchSystemMeta).mockReturnValue(new Promise<SystemMetaDTO>(() => undefined));
    const { user } = montar();

    await user.click(versao());

    expect(fato("Ambiente")).toBe("Consultando…");
    expect(fato("Build")).toBe("Consultando…");
    expect(dialogo()).not.toHaveTextContent("Produção");
  });

  it("falha na consulta avisa e deixa tentar de novo", async () => {
    vi.mocked(fetchSystemMeta).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(meta());
    const { user } = montar();

    await user.click(versao());
    expect(await within(dialogo()).findByRole("alert")).toHaveTextContent(
      "Não foi possível consultar ambiente e build agora.",
    );
    expect(fato("Ambiente")).toBe("—");

    await user.click(within(dialogo()).getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(fato("Ambiente")).toBe("Produção"));
    expect(within(dialogo()).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Fechar e Escape saem, e o foco volta para a versão", async () => {
    vi.mocked(fetchSystemMeta).mockResolvedValue(meta());
    const { user } = montar();

    await user.click(versao());
    await user.click(within(dialogo()).getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(versao()).toHaveFocus();
    expect(versao()).toHaveAttribute("aria-expanded", "false");

    await user.click(versao());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("versão no cabeçalho — CSS", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "shell.css"), "utf8").replace(/\r\n/g, "\n");
  const regra = (seletor: string) => {
    const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return css.match(new RegExp(`\\n${escapado} \\{([^}]*)\\}`))?.[1] ?? "";
  };

  it("menor que o nome e em tom secundário, sem moldura", () => {
    expect(regra(".masthead__brand")).toMatch(/font-size: var\(--fs-md\);/);
    const versaoCss = regra(".masthead__version");
    expect(versaoCss).toMatch(/font-size: var\(--fs-xs\);/);
    expect(versaoCss).toMatch(/color: var\(--on-dark-3\);/);
    expect(versaoCss).toMatch(/border: none;/);
    expect(versaoCss).toMatch(/white-space: nowrap;/);
  });

  it("o bloco da marca não encolhe e a busca segue com a mesma regra — é ela que cede espaço", () => {
    expect(regra(".masthead__identity")).toMatch(/flex-shrink: 0;/);
    const busca = regra(".masthead__search-wrap");
    expect(busca).toMatch(/flex: 1;/);
    expect(busca).toMatch(/min-width: 0;/);
    expect(busca).toMatch(/max-width: 460px;/);
  });
});
