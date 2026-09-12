import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { ItemDTO, SupplierDTO } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-02 em Item × Fornecedor.
 *
 * Esta era a tela do beco sem saída: modal de workspace por cima do
 * workspace, sidebar inerte, e a única porta era fechar o cadastro. Com a
 * foundation a sidebar voltou a ser saída — e agora a saída pergunta quando
 * há o que perder.
 *
 * Cancelar, ✕ e Esc não passam pelo router: passam por `confirmarDescarte()`,
 * e caem no MESMO diálogo.
 */

vi.mock("../../lib/supplier-items-api", () => ({
  createSupplierItem: vi.fn(),
  listSupplierItems: vi.fn(),
  getSupplierItem: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({
  listUnits: vi.fn(async () => [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1" },
  ]),
}));
vi.mock("../../lib/items-api", () => ({
  listItems: vi.fn(async () => ({ items: [], total: 0 })),
  getItem: vi.fn(),
}));
vi.mock("../../lib/suppliers-api", () => ({
  listSuppliers: vi.fn(async () => ({ suppliers: [], total: 0 })),
}));

import { createSupplierItem } from "../../lib/supplier-items-api";
import { SupplierItemFormModal } from "./SupplierItemFormModal";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

const ITEM = {
  id: "item-1",
  code: "MP-000001",
  name: "Vitamina C",
  type: "RAW_MATERIAL",
  unitCode: "kg",
  active: true,
} as unknown as ItemDTO;

const FORNECEDOR = {
  id: "for-1",
  code: "FOR-000001",
  legalName: "Fornecedor Teste",
  tradeName: null,
  active: true,
} as unknown as SupplierDTO;

let fechou = false;
let salvou = false;

function Tela() {
  return (
    <>
      <h1>Item × Fornecedor</h1>
      <SupplierItemFormModal
        items={[ITEM]}
        suppliers={[FORNECEDOR]}
        onClose={() => {
          fechou = true;
        }}
        onSaved={() => {
          salvou = true;
        }}
      />
    </>
  );
}

function Raiz() {
  return (
    <UnsavedChangesProvider>
      {/* `id="sidebar"` porque é o que o modal de workspace deixa fora do
          `inert`: a navegação lateral é saída, por decisão do PO. */}
      <nav id="sidebar">
        <Link to="/estoque">Estoque</Link>
      </nav>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

function abrir() {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/compras/item-fornecedor" element={<Tela />} />
        <Route path="/estoque" element={<h1>Posição de Estoque</h1>} />
      </Route>,
    ),
    { initialEntries: ["/compras/item-fornecedor"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const pergunta = () => screen.queryByRole("alertdialog");
const menuEstoque = () => screen.getByRole("link", { name: "Estoque" });
const codigoNoFornecedor = () =>
  document.getElementById("supplier-item-code") as HTMLInputElement;
const preco = () => document.getElementById("supplier-item-price") as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  fechou = false;
  salvou = false;
});

describe("Item × Fornecedor — navegação pelo menu", () => {
  it("modal limpo sai pela sidebar sem diálogo", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByText("Nova relação item × fornecedor");

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("modal com alteração pergunta antes de sair", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByText("Nova relação item × fornecedor");

    fireEvent.change(codigoNoFornecedor(), { target: { value: "COD-FOR-9" } });
    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas nesta relação/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Posição de Estoque" })).toBeNull();
  });
});

describe("Item × Fornecedor — Cancelar, ✕ e Esc", () => {
  it("Cancelar sem alteração fecha direto", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByText("Nova relação item × fornecedor");

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(fechou).toBe(true);
    expect(pergunta()).toBeNull();
  });

  it("Cancelar com alteração pergunta, e só fecha em Sair sem salvar", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByText("Nova relação item × fornecedor");

    fireEvent.change(codigoNoFornecedor(), { target: { value: "COD-FOR-9" } });
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(fechou).toBe(false);

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(fechou).toBe(true);
  });

  it("✕ com alteração pergunta", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByText("Nova relação item × fornecedor");

    fireEvent.change(codigoNoFornecedor(), { target: { value: "COD-FOR-9" } });
    await user.click(screen.getByRole("button", { name: /Fechar/ }));

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(fechou).toBe(false);
  });

  it("Esc com alteração pergunta — e uma pergunta só", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByText("Nova relação item × fornecedor");

    fireEvent.change(codigoNoFornecedor(), { target: { value: "COD-FOR-9" } });
    await user.keyboard("{Escape}");

    expect(await screen.findAllByText("Sair sem salvar?")).toHaveLength(1);
    expect(fechou).toBe(false);
  });
});

describe("Item × Fornecedor — o que NÃO conta como alteração", () => {
  it("abrir e digitar o preço e apagar devolve a saída livre", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByText("Nova relação item × fornecedor");

    fireEvent.change(preco(), { target: { value: "12,50" } });
    fireEvent.change(preco(), { target: { value: "" } });
    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("digitar uma palavra inteira não perde letras no caminho", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByText("Nova relação item × fornecedor");

    /*
     * O `onClose` do modal passou a ser função da tela (`confirmarDescarte`),
     * e função nova a cada renderização remontava foco e trap a cada tecla —
     * o campo ficava com a primeira letra. A correção é canônica desde a Wave
     * 01; isto aqui é a trava na tela que a usa.
     */
    await user.type(codigoNoFornecedor(), "COD-FOR-9");

    expect(codigoNoFornecedor()).toHaveValue("COD-FOR-9");
    expect(codigoNoFornecedor()).toHaveFocus();
  });

  it("salvar limpa a pendência antes de fechar", async () => {
    const user = userEvent.setup();
    vi.mocked(createSupplierItem).mockResolvedValue({ id: "si-1" } as never);
    abrir();
    await screen.findByText("Nova relação item × fornecedor");

    fireEvent.change(codigoNoFornecedor(), { target: { value: "COD-FOR-9" } });
    escolherEntidade("supplier-item-item", "MP-000001");
    escolherEntidade("supplier-item-supplier", "Fornecedor Teste");

    await user.click(screen.getByRole("button", { name: /Criar relação/ }));

    await waitFor(() => expect(salvou).toBe(true));
    expect(pergunta()).toBeNull();
  });
});

/** A escolha do campo de entidade é confirmada no `mousedown`, antes do blur. */
function escolherEntidade(campoId: string, termo: string) {
  const campo = document.getElementById(campoId) as HTMLInputElement;
  fireEvent.focus(campo);
  fireEvent.change(campo, { target: { value: termo } });
  fireEvent.mouseDown(screen.getAllByRole("option", { name: new RegExp(termo) })[0]!);
}
