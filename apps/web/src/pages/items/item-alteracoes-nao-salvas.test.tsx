import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { ItemDTO, UnitOfMeasureDTO } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-03 no cadastro de Item de estoque.
 *
 * O cadastro tem duas portas — a página `/cadastros/itens/novo` e o modal da
 * listagem — e um controller só (`useItemForm`). A guarda mora nele, então as
 * duas portas ganham a mesma proteção pelo mesmo caminho.
 *
 * Abrir não suja: o tipo pré-escolhido traz os controles de lote, validade e
 * liberação como DEFAULT, e default é o ponto de partida, não edição. Pureza
 * é número: `98` e `98,0` são o mesmo item.
 */

vi.mock("../../lib/items-api", () => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({ listUnits: vi.fn() }));
vi.mock("../../components/SupplierItemsSection", () => ({ SupplierItemsSection: () => null }));
vi.mock("../../components/ItemCostReferenceSection", () => ({
  ItemCostReferenceSection: () => null,
}));

import { createItem, updateItem } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import { ItemCreatePage } from "./ItemCreatePage";
import { ItemFormModal } from "./ItemFormModal";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

const UNIDADES: UnitOfMeasureDTO[] = [
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
];

function item(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "item-1",
    code: "MP-000777",
    type: "RAW_MATERIAL",
    name: "Creatina monoidratada",
    unitCode: "kg",
    unit: UNIDADES[0]!,
    controlsLot: true,
    controlsExpiry: true,
    requiresQualityRelease: true,
    requiresCoa: false,
    sourceName: null,
    declaredNutrient: null,
    family: null,
    defaultPurityPercent: "98.000000",
    packagingSubtype: null,
    externalBarcode: null,
    active: true,
    operationallyUsed: false,
    createdAt: "2026-08-31T17:32:00.000Z",
    updatedAt: "2026-08-31T19:14:00.000Z",
    ...overrides,
  } as ItemDTO;
}

let fechou = false;

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <nav id="sidebar">
        <Link to="/painel">Painel</Link>
      </nav>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

function montar(elemento: React.ReactNode, entradas: string[], indice?: number) {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/cadastros/itens/novo" element={elemento} />
        <Route path="/cadastros/itens" element={elemento} />
        <Route path="/painel" element={<h1>Painel</h1>} />
      </Route>,
    ),
    { initialEntries: entradas, ...(indice === undefined ? {} : { initialIndex: indice }) },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function abrirPagina(entradas = ["/cadastros/itens/novo"], indice?: number) {
  const router = montar(<ItemCreatePage />, entradas, indice);
  await screen.findByRole("heading", { name: "Novo item de estoque" });
  await waitFor(() => expect(seletor("item-unit").options.length).toBeGreaterThan(1));
  return router;
}

async function abrirModalDeEdicao(dto = item()) {
  montar(
    <ItemFormModal
      mode="edit"
      item={dto}
      units={UNIDADES}
      onClose={() => {
        fechou = true;
      }}
      onSaved={() => undefined}
    />,
    ["/cadastros/itens"],
  );
  await screen.findByText(dto.name);
}

const seletor = (id: string) => document.getElementById(id) as HTMLSelectElement;
const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
const pergunta = () => screen.queryByRole("alertdialog");
/* "Estoque" colide com um link de contexto do próprio formulário de item. */
const menuEstoque = () => screen.getByRole("link", { name: "Painel" });
const nome = () => campo("item-name");
const pureza = () => campo("item-purity");

/** O aviso nativo de F5 / fechar aba só existe quando alguém o registra. */
function avisaAoFechar(): boolean {
  const evento = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(evento);
  return evento.defaultPrevented;
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
  fechou = false;
  vi.mocked(listUnits).mockResolvedValue(UNIDADES);
  vi.mocked(createItem).mockResolvedValue(item());
  vi.mocked(updateItem).mockResolvedValue(item());
});

describe("Item novo — guarda de alterações não salvas", () => {
  it("aberto com os defaults, sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrirPagina();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("o tipo pré-escolhido pela URL traz defaults e continua limpo", async () => {
    const user = userEvent.setup();
    await abrirPagina(["/cadastros/itens/novo?tipo=PACKAGING"]);

    /*
     * `?tipo=PACKAGING` troca controle de lote, validade e liberação para os
     * defaults da embalagem. É o ponto de partida daquele tipo, não edição de
     * ninguém — e perguntar aqui seria a guarda cobrando por algo que a
     * própria URL fez.
     */
    expect(seletor("item-type")).toHaveValue("PACKAGING");

    await user.click(menuEstoque());
    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("nome digitado pergunta antes de sair", async () => {
    const user = userEvent.setup();
    await abrirPagina();

    fireEvent.change(nome(), { target: { value: "Creatina monoidratada" } });
    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas neste item/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Painel" })).toBeNull();
  });

  it("desfazer a digitação devolve a saída livre", async () => {
    const user = userEvent.setup();
    await abrirPagina();

    fireEvent.change(nome(), { target: { value: "Creatina" } });
    fireEvent.change(nome(), { target: { value: "" } });
    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("salvar limpa a pendência antes de voltar para a lista", async () => {
    const user = userEvent.setup();
    await abrirPagina();

    fireEvent.change(seletor("item-type"), { target: { value: "RAW_MATERIAL" } });
    fireEvent.change(seletor("item-unit"), { target: { value: "kg" } });
    fireEvent.change(nome(), { target: { value: "Creatina monoidratada" } });
    await user.click(screen.getByRole("button", { name: "Criar item" }));

    await waitFor(() => expect(createItem).toHaveBeenCalledTimes(1));
    expect(pergunta()).toBeNull();
  });

  it("voltar pelo navegador com alteração pendente também pergunta", async () => {
    const user = userEvent.setup();
    const router = await abrirPagina(["/painel", "/cadastros/itens/novo"], 1);

    fireEvent.change(nome(), { target: { value: "Creatina" } });
    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
  });

  it("o aviso do navegador acompanha a digitação", async () => {
    await abrirPagina();

    expect(avisaAoFechar()).toBe(false);

    fireEvent.change(nome(), { target: { value: "Creatina" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(true));

    fireEvent.change(nome(), { target: { value: "" } });
    await waitFor(() => expect(avisaAoFechar()).toBe(false));
  });
});

describe("Item — modal de edição", () => {
  it("carregado e não tocado, sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("reescrever a MESMA pureza não é alteração", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao();

    // O servidor devolve `98.000000` e a pessoa redigita `98,0`.
    expect(pureza()).toHaveValue("98.000000");
    fireEvent.change(pureza(), { target: { value: "98,0" } });
    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("Cancelar sem alteração fecha direto; com alteração pergunta", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(fechou).toBe(true);

    fechou = false;
    fireEvent.change(nome(), { target: { value: "Creatina micronizada" } });
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(fechou).toBe(false);

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(fechou).toBe(true);
  });

  it("✕ com alteração pergunta", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao();

    fireEvent.change(nome(), { target: { value: "Creatina micronizada" } });
    await user.click(screen.getByRole("button", { name: /Fechar/ }));

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(fechou).toBe(false);
  });

  it("Esc com alteração pergunta — e uma pergunta só", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao();

    fireEvent.change(nome(), { target: { value: "Creatina micronizada" } });
    await user.keyboard("{Escape}");

    expect(await screen.findAllByText("Sair sem salvar?")).toHaveLength(1);
    expect(fechou).toBe(false);
  });

  it("salvar limpa a pendência", async () => {
    const user = userEvent.setup();
    await abrirModalDeEdicao();

    fireEvent.change(nome(), { target: { value: "Creatina micronizada" } });
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(updateItem).toHaveBeenCalledTimes(1));

    await user.click(menuEstoque());
    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });
});
