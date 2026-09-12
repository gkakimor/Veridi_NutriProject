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
import type { ItemCostReferencesResponse, ItemDTO, UnitOfMeasureDTO } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-03 — save parcial dentro do cadastro de Item.
 *
 * O modal de edição tem DOIS salvamentos: "Salvar alterações", que grava os
 * campos do item, e "Salvar referência", dentro do bloco de Custo de
 * referência, que grava uma vigência nova. Um não grava o outro.
 *
 * A regra é a mesma provada no detalhe de Item × Fornecedor: a pendência é a
 * SOMA do que continua por gravar, e cada parcela some sozinha quando o seu
 * botão grava. Gravar os campos do item com um custo digitado no bloco ao
 * lado não pode liberar a saída — seria perder o custo em silêncio.
 */

vi.mock("../../lib/items-api", () => ({
  createItem: vi.fn(),
  updateItem: vi.fn(),
  getItemCostReferences: vi.fn(),
  createItemCostReference: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({
  listUnits: vi.fn(async () => UNIDADES),
}));
vi.mock("../../components/SupplierItemsSection", () => ({ SupplierItemsSection: () => null }));
vi.mock("../../app/AuthProvider", () => ({ useAuth: vi.fn() }));

import {
  createItemCostReference,
  getItemCostReferences,
  updateItem,
} from "../../lib/items-api";
import { useAuth } from "../../app/AuthProvider";
import { ItemFormModal } from "./ItemFormModal";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

const UNIDADES: UnitOfMeasureDTO[] = [
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
];

function item(): ItemDTO {
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
    defaultPurityPercent: null,
    packagingSubtype: null,
    externalBarcode: null,
    active: true,
    operationallyUsed: false,
    createdAt: "2026-08-31T17:32:00.000Z",
    updatedAt: "2026-08-31T19:14:00.000Z",
  } as ItemDTO;
}

function referencias(): ItemCostReferencesResponse {
  return {
    itemId: "item-1",
    itemCode: "MP-000777",
    itemName: "Creatina monoidratada",
    itemUnitCode: "kg",
    current: null,
    history: [],
    automatic: {
      unitCost: null,
      unitCode: "kg",
      source: "NO_COST",
      details: null,
      referenceDate: "2026-09-04T12:00:00.000Z",
    },
  };
}

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

async function abrir() {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route
          path="/cadastros/itens"
          element={
            <ItemFormModal
              mode="edit"
              item={item()}
              units={UNIDADES}
              onClose={() => undefined}
              onSaved={() => undefined}
            />
          }
        />
        <Route path="/painel" element={<h1>Painel</h1>} />
      </Route>,
    ),
    { initialEntries: ["/cadastros/itens"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByText("Creatina monoidratada");
  await screen.findByRole("button", { name: "Definir referência" });
  return router;
}

const pergunta = () => screen.queryByRole("alertdialog");
const menu = () => screen.getByRole("link", { name: "Painel" });
const nome = () => document.getElementById("item-name") as HTMLInputElement;
const custo = () => document.getElementById("cost-reference-value") as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    user: { role: "ADMIN" },
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(getItemCostReferences).mockResolvedValue(referencias());
  vi.mocked(updateItem).mockResolvedValue(item());
  vi.mocked(createItemCostReference).mockResolvedValue(referencias());
});

describe("Item — custo de referência é pendência própria", () => {
  it("abrir o bloco sem digitar nada não suja a tela", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(screen.getByRole("button", { name: "Definir referência" }));
    await waitFor(() => expect(custo()).toBeInTheDocument());

    // Unidade e data nascem do item e do dia de hoje: são sugestões.
    await user.click(menu());
    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("custo digitado pergunta, mesmo sem tocar nos campos do item", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(screen.getByRole("button", { name: "Definir referência" }));
    fireEvent.change(custo(), { target: { value: "1200" } });

    await user.click(menu());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Painel" })).toBeNull();
  });

  it("salvar os campos do item NÃO libera o custo ainda digitado", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(nome(), { target: { value: "Creatina micronizada" } });
    await user.click(screen.getByRole("button", { name: "Definir referência" }));
    fireEvent.change(custo(), { target: { value: "1200" } });

    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
    await waitFor(() => expect(updateItem).toHaveBeenCalledTimes(1));

    // O item já está no servidor; o custo continua só na tela.
    await user.click(menu());
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(pergunta()).toBeNull());

    // Gravar o custo encerra a última parcela, e a saída fica livre.
    await user.click(screen.getByRole("button", { name: "Salvar referência" }));
    await waitFor(() => expect(createItemCostReference).toHaveBeenCalledTimes(1));

    await user.click(menu());
    expect(await screen.findByRole("heading", { name: "Painel" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });
});
