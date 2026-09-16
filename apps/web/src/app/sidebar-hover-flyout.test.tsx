import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { navGroups } from "./navigation";

/**
 * NAV-SIDEBAR-HOVER-01 — menu recolhido no desktop: o mouse parado num ícone
 * de seção, ou o foco do teclado nele, abre ao lado o catálogo das telas da
 * seção. O clique no ícone segue abrindo o menu inteiro por cima, o celular
 * segue sem trilho, e nada disso vira preferência gravada.
 *
 * Mouse com relógio falso e `fireEvent`: as pausas de abrir e de fechar são o
 * que separa passar pelo trilho de parar nele, e cada uma é medida no antes e
 * no depois. O `user-event` não serve aqui — ele espera um `setTimeout` que o
 * relógio falso do Vitest nunca dispara. Teclado com relógio real e
 * `user-event`: o foco abre na hora, sem pausa para medir.
 */

const ABRIR_MS = 150;
const FECHAR_MS = 200;

let mobile = false;
let currentLocation = { pathname: "", search: "" };
/** Onde o mouse está: o próximo gesto sai daqui. */
let ponteiro: Element | null = null;

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
}

/** Sem opção, o menu já vem recolhido: é onde o catálogo existe. */
function renderShell(path: string, { role = "ADMIN", prefs = { compact: true } }: RenderOptions = {}) {
  const user: AuthenticatedUserDTO = {
    id: `usuario-${role.toLowerCase()}`,
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

/** Deixa a preferência da API chegar à tela. */
async function carregar() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Adianta o relógio falso: pausas do catálogo e coalescência da preferência. */
function passar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/**
 * Mouse de verdade: sai de onde estava e entra no alvo, com `relatedTarget` —
 * é por ele que o React decide quem o mouse deixou e onde entrou.
 */
function mouseSobre(alvo: Element) {
  const de = ponteiro?.isConnected ? ponteiro : null;
  if (de !== alvo) {
    if (de) {
      fireEvent.pointerOut(de, { pointerType: "mouse", relatedTarget: alvo });
      fireEvent.mouseOut(de, { relatedTarget: alvo });
    }
    fireEvent.pointerOver(alvo, { pointerType: "mouse", relatedTarget: de });
    fireEvent.mouseOver(alvo, { relatedTarget: de });
  }
  fireEvent.pointerMove(alvo, { pointerType: "mouse" });
  fireEvent.mouseMove(alvo);
  ponteiro = alvo;
}

/**
 * Clique de mouse: o botão pressionado leva o foco, como no Chrome.
 * `noMeio` confere a tela com o botão já pressionado e o foco no alvo.
 */
function clicar(alvo: HTMLElement, noMeio?: () => void) {
  mouseSobre(alvo);
  fireEvent.pointerDown(alvo, { pointerType: "mouse" });
  fireEvent.mouseDown(alvo);
  act(() => alvo.focus());
  noMeio?.();
  fireEvent.pointerUp(alvo, { pointerType: "mouse" });
  fireEvent.mouseUp(alvo);
  fireEvent.click(alvo);
}

/** Toque: eventos de ponteiro `touch` e, depois, os de mouse de compatibilidade — sem `pointermove` de mouse. */
function tocar(alvo: HTMLElement, noMeio?: () => void) {
  fireEvent.pointerDown(alvo, { pointerType: "touch" });
  fireEvent.pointerUp(alvo, { pointerType: "touch" });
  fireEvent.mouseOver(alvo);
  fireEvent.mouseMove(alvo);
  fireEvent.mouseDown(alvo);
  act(() => alvo.focus());
  noMeio?.();
  fireEvent.mouseUp(alvo);
  fireEvent.click(alvo);
}

function teclar(key: string) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
}

const menu = () => screen.getByRole("navigation", { name: "Navegação principal" });
const icone = (nome: string) => within(menu()).getByRole("button", { name: nome });
const catalogo = (secao: string) => screen.queryByRole("group", { name: secao });
const telasDo = (secao: string) => {
  const lista = catalogo(secao);
  if (!lista) throw new Error(`o catálogo de ${secao} está fechado`);
  return within(lista).getAllByRole("link");
};
const nomes = (elementos: HTMLElement[]) => elementos.map((elemento) => elemento.textContent);
const areaDeTrabalho = () => screen.getByText(/^tela /);
/** A coluna do trilho fora de qualquer ícone: a folga entre o ícone e o catálogo. */
const folgaDoTrilho = () => menu().querySelector(".sidebar__nav") as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.clearAllMocks();
  mobile = false;
  ponteiro = null;
  stubMatchMedia();
  window.localStorage.clear();
  currentLocation = { pathname: "", search: "" };
  vi.mocked(updateUserPreferences).mockImplementation(async (input) => ({
    navigation: { ...defaultNavigationPreferences(), ...input.navigation },
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Menu recolhido — catálogo da seção pelo mouse", () => {
  it("mouse parado no ícone: passada a pausa, o catálogo abre ao lado, sem clique e sem gravar preferência", async () => {
    const { container } = renderShell("/");
    await carregar();

    mouseSobre(icone("Comercial"));
    // A dica aparece na hora, como sempre; o catálogo espera a pausa.
    expect(screen.getByRole("tooltip")).toHaveTextContent("Comercial");
    passar(ABRIR_MS - 1);
    expect(catalogo("Comercial")).toBeNull();

    passar(1);
    expect(nomes(telasDo("Comercial"))).toEqual([
      "Visão do Cliente",
      "Projetos",
      "Orçamentos",
      "Amostras",
      "Pedidos",
      "Expedições",
      "Faturamento",
    ]);
    expect(icone("Comercial")).toHaveClass("is-open");
    expect(screen.queryByRole("tooltip")).toBeNull();

    // Continua recolhido: nem o menu por cima, nem preferência nova.
    expect(container.querySelector(".shell")).toHaveClass("shell--compact");
    expect(screen.queryByRole("combobox", { name: "Buscar telas" })).toBeNull();
    passar(1000);
    expect(updateUserPreferences).not.toHaveBeenCalled();
  });

  it("cada ícone abre as telas da sua seção, com os endereços de sempre", async () => {
    renderShell("/");
    await carregar();

    for (const secao of navGroups) {
      mouseSobre(icone(secao.title));
      passar(ABRIR_MS);
      expect(
        telasDo(secao.title).map((tela) => [tela.textContent, tela.getAttribute("href")]),
        secao.id,
      ).toEqual(secao.items.map((item) => [item.label, item.path]));
    }
  });

  it("passar rápido pelo ícone não abre nada; tirar o mouse fecha depois da pausa", async () => {
    renderShell("/");
    await carregar();

    mouseSobre(icone("Compras"));
    passar(ABRIR_MS - 1);
    mouseSobre(areaDeTrabalho());
    passar(1000);
    expect(catalogo("Compras")).toBeNull();

    mouseSobre(icone("Compras"));
    passar(ABRIR_MS);
    expect(catalogo("Compras")).not.toBeNull();

    mouseSobre(areaDeTrabalho());
    passar(FECHAR_MS - 1);
    expect(catalogo("Compras")).not.toBeNull();
    passar(1);
    expect(catalogo("Compras")).toBeNull();
    expect(icone("Compras")).not.toHaveClass("is-open");
  });

  it("parado em outro ícone, o catálogo troca de seção depois da pausa", async () => {
    renderShell("/");
    await carregar();

    mouseSobre(icone("Compras"));
    passar(ABRIR_MS);
    mouseSobre(icone("Estoque"));
    passar(ABRIR_MS - 1);
    expect(catalogo("Compras")).not.toBeNull();
    expect(catalogo("Estoque")).toBeNull();

    passar(1);
    expect(catalogo("Compras")).toBeNull();
    expect(nomes(telasDo("Estoque"))).toEqual([
      "Posição de Estoque",
      "Lotes",
      "Lotes de Produto Acabado",
      "Movimentações",
      "Materiais de Clientes",
      "Inventário Físico",
    ]);
  });

  it("levar o mouse do ícone ao catálogo não fecha — pela folga do trilho ou cruzando outro ícone; a tela escolhida abre e o trilho continua", async () => {
    const { container } = renderShell("/");
    await carregar();

    mouseSobre(icone("Compras"));
    passar(ABRIR_MS);
    // Pela folga do trilho, sem pressa: a pausa de fechar cobre a travessia.
    mouseSobre(folgaDoTrilho());
    passar(FECHAR_MS - 1);
    const recebimentos = within(catalogo("Compras") as HTMLElement).getByRole("link", { name: "Recebimentos" });
    mouseSobre(recebimentos);
    passar(1000);
    expect(catalogo("Compras")).not.toBeNull();

    // Na diagonal, o mouse cruza o ícone de Estoque a caminho do catálogo de Compras.
    mouseSobre(icone("Estoque"));
    passar(ABRIR_MS - 1);
    mouseSobre(recebimentos);
    passar(1000);
    expect(catalogo("Compras")).not.toBeNull();
    expect(catalogo("Estoque")).toBeNull();

    clicar(recebimentos);
    expect(currentLocation.pathname).toBe("/compras/recebimentos");
    expect(catalogo("Compras")).toBeNull();
    expect(container.querySelector(".shell")).toHaveClass("shell--compact");
    expect(icone("Compras — Recebimentos")).toHaveClass("is-active");
    passar(1000);
    expect(updateUserPreferences).not.toHaveBeenCalled();
  });

  it("o clique no ícone segue abrindo o menu inteiro por cima, com ou sem catálogo; Esc devolve o trilho sem reabrir o catálogo", async () => {
    renderShell("/comercial/pedidos");
    await carregar();

    mouseSobre(icone("Compras"));
    passar(ABRIR_MS);
    expect(catalogo("Compras")).not.toBeNull();

    clicar(icone("Compras"));
    expect(screen.getByRole("combobox", { name: "Buscar telas" })).toBeInTheDocument();
    expect(within(menu()).getByRole("button", { name: "Compras" })).toHaveAttribute("aria-expanded", "true");
    expect(catalogo("Compras")).toBeNull();
    expect(screen.getAllByRole("link", { name: "Recebimentos" })).toHaveLength(1);

    teclar("Escape");
    expect(screen.queryByRole("combobox", { name: "Buscar telas" })).toBeNull();
    expect(icone("Compras")).toHaveFocus();
    passar(1000);
    expect(catalogo("Compras")).toBeNull();

    // Clique direto, sem esperar a pausa: o foco do clique não abre catálogo, o menu vem por cima.
    clicar(icone("Estoque"), () => expect(catalogo("Estoque")).toBeNull());
    passar(1000);
    expect(within(menu()).getByRole("button", { name: "Estoque" })).toHaveAttribute("aria-expanded", "true");
    expect(catalogo("Estoque")).toBeNull();
    expect(updateUserPreferences).not.toHaveBeenCalled();
  });

  it("toque não depende de hover: só o mouse abre o catálogo, e tocar no ícone abre o menu por cima", async () => {
    renderShell("/");
    await carregar();

    // O mesmo gesto com mouse abre: prova de que o evento chega ao trilho.
    fireEvent.pointerMove(icone("Estoque"), { pointerType: "mouse" });
    passar(ABRIR_MS);
    expect(catalogo("Estoque")).not.toBeNull();
    teclar("Escape");
    expect(catalogo("Estoque")).toBeNull();

    fireEvent.pointerMove(icone("Compras"), { pointerType: "touch" });
    fireEvent.pointerMove(icone("Compras"), { pointerType: "pen" });
    passar(1000);
    expect(catalogo("Compras")).toBeNull();

    // Nem no meio do toque: o foco que ele leva ao ícone não abre catálogo.
    tocar(icone("Compras"), () => expect(catalogo("Compras")).toBeNull());
    passar(1000);
    expect(screen.getByRole("combobox", { name: "Buscar telas" })).toBeInTheDocument();
    expect(within(menu()).getByRole("button", { name: "Compras" })).toHaveAttribute("aria-expanded", "true");
    expect(catalogo("Compras")).toBeNull();
  });

  it("Esc com o catálogo aberto pelo mouse fecha só o catálogo — o Esc não chega a quem está atrás, e o mouse parado não reabre", async () => {
    renderShell("/");
    await carregar();
    const escAtras = vi.fn();
    document.addEventListener("keydown", escAtras);
    try {
      mouseSobre(icone("Qualidade"));
      passar(ABRIR_MS);
      expect(catalogo("Qualidade")).not.toBeNull();

      teclar("Escape");
      expect(catalogo("Qualidade")).toBeNull();
      expect(escAtras).not.toHaveBeenCalled();
      passar(1000);
      expect(catalogo("Qualidade")).toBeNull();

      // Sem catálogo aberto, o Esc segue o caminho de sempre.
      teclar("Escape");
      expect(escAtras).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", escAtras);
    }
  });
});

describe("Menu recolhido — tela atual e perfil", () => {
  it("a tela atual fica acesa no catálogo e a seção no ícone — inclusive telas de mesmo endereço com filtro", async () => {
    const { unmount } = renderShell("/compras/recebimentos");
    await carregar();

    const compras = icone("Compras — Recebimentos");
    expect(compras).toHaveClass("is-active");
    expect(compras).toHaveAttribute("aria-current", "true");
    mouseSobre(compras);
    passar(ABRIR_MS);
    const [ordens, recebimentos, itemFornecedor] = telasDo("Compras");
    expect(recebimentos).toHaveAttribute("aria-current", "page");
    expect(recebimentos).toHaveClass("is-active");
    expect(ordens).not.toHaveAttribute("aria-current");
    expect(itemFornecedor).not.toHaveClass("is-active");
    expect(compras).toHaveClass("is-active", "is-open");
    unmount();

    // Liberação de lotes é Lotes com filtro: acende em Qualidade, não em Estoque.
    renderShell("/estoque/lotes?status=AWAITING_RELEASE");
    await carregar();
    mouseSobre(icone("Estoque"));
    passar(ABRIR_MS);
    expect(telasDo("Estoque").filter((tela) => tela.getAttribute("aria-current") === "page")).toEqual([]);
    mouseSobre(icone("Qualidade — Liberação de lotes"));
    passar(ABRIR_MS);
    expect(
      within(catalogo("Qualidade") as HTMLElement).getByRole("link", { name: "Liberação de lotes" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it.each<[UserRole, string[]]>([
    ["ADMIN", ["Painel Gerencial", "Relatórios", "Precificação"]],
    ["VIEWER", ["Relatórios"]],
  ])("perfil %s: o catálogo mostra só as telas que o perfil enxerga", async (role, telas) => {
    renderShell("/", { role, prefs: { compact: true } });
    await carregar();

    mouseSobre(icone("Gestão"));
    passar(ABRIR_MS);
    expect(nomes(telasDo("Gestão")), role).toEqual(telas);
    // Seção sem tela permitida não tem ícone — nem catálogo.
    const administracao = within(menu()).queryByRole("button", { name: "Administração" });
    expect(administracao === null, `${role} sem Administração`).toBe(role !== "ADMIN");
  });
});

describe("Fora do trilho — sem catálogo", () => {
  it("menu expandido: mouse e foco na seção não abrem catálogo nem mexem na seção", async () => {
    renderShell("/", { prefs: {} });
    await carregar();

    const compras = within(menu()).getByRole("button", { name: "Compras" });
    mouseSobre(compras);
    passar(1000);
    act(() => compras.focus());
    passar(1000);

    expect(document.querySelector(".sidebar-flyout")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
    expect(compras).toHaveAttribute("aria-expanded", "false");
    expect(updateUserPreferences).not.toHaveBeenCalled();
  });

  it("celular: sem trilho e sem catálogo por hover — tocar na seção abre e a tela navega, como antes", async () => {
    mobile = true;
    stubMatchMedia();
    // Recolhido é preferência de desktop: no celular o menu é sempre o drawer expandido.
    const { container } = renderShell("/");
    await carregar();

    expect(container.querySelector(".shell")).not.toHaveClass("shell--compact");
    expect(container.querySelector("[data-rail]")).toBeNull();
    tocar(screen.getByRole("button", { name: "Abrir menu" }));
    expect(container.querySelector(".shell")).toHaveClass("shell--nav-open");

    const comercial = within(menu()).getByRole("button", { name: "Comercial" });
    mouseSobre(comercial);
    act(() => comercial.focus());
    passar(1000);
    expect(document.querySelector(".sidebar-flyout")).toBeNull();
    expect(comercial).toHaveAttribute("aria-expanded", "false");

    tocar(comercial);
    expect(comercial).toHaveAttribute("aria-expanded", "true");
    tocar(within(document.getElementById("sidebar-grupo-commercial") as HTMLElement).getByRole("link", { name: "Pedidos" }));
    expect(currentLocation.pathname).toBe("/comercial/pedidos");
    expect(container.querySelector(".shell")).not.toHaveClass("shell--nav-open");
  });
});

describe("Menu recolhido — catálogo da seção pelo teclado", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  /** Relógio real, dentro do `act`: prova que nada muda depois das pausas do mouse. */
  async function esperar(ms: number) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  it("o foco no ícone abre o catálogo na hora; o Tab percorre as telas e segue para a próxima seção; o Esc fecha e devolve o foco", async () => {
    const user = userEvent.setup();
    renderShell("/");
    await carregar();

    act(() => icone("Favoritos").focus());
    await user.tab();
    expect(icone("Comercial")).toHaveFocus();
    expect(catalogo("Comercial")).not.toBeNull();

    // O mouse parado noutro ícone não troca o catálogo que o foco do teclado abriu.
    mouseSobre(icone("Estoque"));
    await esperar(ABRIR_MS + 50);
    expect(catalogo("Estoque")).toBeNull();
    expect(catalogo("Comercial")).not.toBeNull();

    await user.tab();
    const telas = telasDo("Comercial");
    expect(telas[0]).toHaveFocus();

    // Nem o mouse passando pelo catálogo e saindo dele o fecha com o foco numa tela.
    mouseSobre(telas[3] as HTMLElement);
    mouseSobre(areaDeTrabalho());
    await esperar(FECHAR_MS + 50);
    expect(telas[0]).toHaveFocus();
    expect(catalogo("Comercial")).not.toBeNull();

    for (let tela = 1; tela < telas.length; tela++) await user.tab();
    expect(telas[telas.length - 1]).toHaveFocus();
    await user.tab();
    expect(icone("Produção")).toHaveFocus();
    expect(catalogo("Comercial")).toBeNull();
    expect(nomes(telasDo("Produção"))).toEqual(["Ordens de Produção", "Picking / Consumo"]);

    await user.tab();
    expect(telasDo("Produção")[0]).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(catalogo("Produção")).toBeNull();
    expect(icone("Produção")).toHaveFocus();
    await esperar(50);
    expect(catalogo("Produção")).toBeNull();

    // Enter no ícone continua abrindo o menu inteiro por cima.
    await user.keyboard("{Enter}");
    expect(screen.getByRole("combobox", { name: "Buscar telas" })).toBeInTheDocument();
    expect(within(menu()).getByRole("button", { name: "Produção" })).toHaveAttribute("aria-expanded", "true");
    expect(updateUserPreferences).not.toHaveBeenCalled();
  });

  it("foco que sai do trilho fecha o catálogo; Enter numa tela do catálogo navega", async () => {
    const user = userEvent.setup();
    renderShell("/");
    await carregar();

    act(() => icone("Favoritos").focus());
    await user.tab();
    expect(catalogo("Comercial")).not.toBeNull();
    act(() => (areaDeTrabalho().closest("main") as HTMLElement).focus());
    await waitFor(() => expect(catalogo("Comercial")).toBeNull());

    act(() => icone("Favoritos").focus());
    await user.tab();
    await user.tab();
    await user.tab();
    expect(telasDo("Comercial")[1]).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(currentLocation.pathname).toBe("/comercial/projetos");
    expect(catalogo("Comercial")).toBeNull();
  });
});

describe("Catálogo do trilho — CSS", () => {
  const css = readFileSync(join(process.cwd(), "src", "app", "shell.css"), "utf8").replace(/\r\n/g, "\n");
  const regra = (seletor: string) => {
    const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return css.match(new RegExp(`\\n${escapado} \\{([^}]*)\\}`))?.[1] ?? "";
  };

  it("fica por cima do conteúdo sem empurrar a tela nem alargar a página, e o invólucro do ícone não muda o trilho", () => {
    const catalogoCss = regra(".sidebar-flyout");
    expect(catalogoCss).toMatch(/position: fixed;/);
    expect(catalogoCss).toMatch(/max-width: var\(--sidebar-w\);/);
    expect(catalogoCss).toMatch(/max-height: calc\(100vh - var\(--topbar-h\)/);
    expect(regra(".sidebar__rail-group")).toMatch(/display: contents;/);
  });
});
