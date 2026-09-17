import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { InventoryItemDetailDTO, InventoryItemSummaryDTO, ItemDTO, UserRole } from "@veridi/shared";
import { linhaDaPrevia, previa } from "./testing/inventario-fixtures";

/**
 * INVENTORY-INACTIVE-ITEM-VISIBILITY-01 (§107) — item inativo não some do
 * estoque físico, e a marca vem do servidor (`itemActive`/`active`).
 *
 * - Estoque: a linha do inativo diz "Item inativo"; "Incluir inativos sem
 *   saldo" pede o recorte à API e leva o mesmo filtro ao CSV;
 * - detalhe: marca o inativo, mostra os lotes e o ajuste não oferece entrada;
 * - Contagem rápida: a busca acha o inativo, marcado, e ele é contado pela
 *   prévia como qualquer posição com saldo.
 */

let papel: UserRole = "PRODUCTION";

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: papel } }),
  useOptionalAuth: () => ({ user: { id: "u-1", role: papel } }),
}));
vi.mock("../../lib/inventory-api", () => ({
  listInventory: vi.fn(),
  getInventoryItem: vi.fn(),
  getAllocationSuggestion: vi.fn(),
  createInventoryAdjustment: vi.fn(),
}));
vi.mock("../../lib/items-api", () => ({ listItems: vi.fn(), getItemCostReferences: vi.fn() }));
vi.mock("../../lib/stock-counts-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/stock-counts-api")>()),
  previewStockCount: vi.fn(),
  createQuickStockCount: vi.fn(),
}));

import { getInventoryItem, listInventory } from "../../lib/inventory-api";
import { getItemCostReferences, listItems } from "../../lib/items-api";
import { createQuickStockCount, previewStockCount } from "../../lib/stock-counts-api";
import { InventoryItemDetailPage } from "./InventoryItemDetailPage";
import { InventoryOverviewPage } from "./InventoryOverviewPage";
import { StockCountPage } from "./StockCountPage";

function linhaEstoque(sobre: Partial<InventoryItemSummaryDTO> = {}): InventoryItemSummaryDTO {
  return {
    itemId: "item-ativo",
    itemCode: "MP-000431",
    itemName: "Vitamina C",
    itemType: "RAW_MATERIAL",
    unitCode: "kg",
    controlsLot: true,
    itemActive: true,
    onHand: "12",
    reserved: "0",
    available: "12",
    onOrder: "0",
    unavailable: [],
    ...sobre,
  };
}

const INATIVA = linhaEstoque({ itemId: "item-inativo", itemCode: "MP-000977", itemName: "Cafeína anidra", itemActive: false });

beforeEach(() => {
  vi.clearAllMocks();
  papel = "PRODUCTION";
});

describe("Estoque — visão geral", () => {
  function abrirEstoque() {
    vi.mocked(listInventory).mockResolvedValue({ items: [linhaEstoque(), INATIVA], page: 1, pageSize: 20, total: 2 });
    render(
      <MemoryRouter>
        <InventoryOverviewPage />
      </MemoryRouter>,
    );
  }

  function parametrosDoCsv(): URLSearchParams {
    const link = screen.getByRole("link", { name: "Exportar CSV" });
    return new URL(link.getAttribute("href")!, "http://exemplo.invalid").searchParams;
  }

  it('só a linha do item inativo leva a marca "Item inativo"', async () => {
    abrirEstoque();
    const inativa = (await screen.findByText("MP-000977")).closest("tr")!;
    expect(within(inativa).getByText("Item inativo")).toHaveClass("badge", "badge--inactive");
    const ativa = screen.getByText("MP-000431").closest("tr")!;
    expect(within(ativa).queryByText("Item inativo")).toBeNull();
  });

  it('"Incluir inativos sem saldo" pede o recorte à API e leva o mesmo filtro ao CSV', async () => {
    abrirEstoque();
    await waitFor(() => expect(listInventory).toHaveBeenCalledTimes(1));
    expect(vi.mocked(listInventory).mock.calls[0]![0]).not.toHaveProperty("includeInactiveWithoutPosition");
    expect(parametrosDoCsv().get("includeInactiveWithoutPosition")).toBe("false");

    fireEvent.click(screen.getByRole("checkbox", { name: "Incluir inativos sem saldo" }));
    await waitFor(() =>
      expect(listInventory).toHaveBeenLastCalledWith(expect.objectContaining({ includeInactiveWithoutPosition: true, page: 1 })),
    );
    expect(parametrosDoCsv().get("includeInactiveWithoutPosition")).toBe("true");

    fireEvent.click(screen.getByRole("checkbox", { name: "Incluir inativos sem saldo" }));
    await waitFor(() => expect(parametrosDoCsv().get("includeInactiveWithoutPosition")).toBe("false"));
    expect(vi.mocked(listInventory).mock.lastCall![0]).not.toHaveProperty("includeInactiveWithoutPosition");
  });
});

describe("Estoque — detalhe do item", () => {
  function detalhe(sobre: Partial<InventoryItemDetailDTO> = {}): InventoryItemDetailDTO {
    return {
      ...INATIVA,
      lots: [
        {
          lotId: "lote-1",
          lotCode: "LT-000118",
          expiryDate: null,
          isExpired: false,
          location: "A-03",
          status: "AVAILABLE",
          onHand: "12",
          reserved: "0",
          available: "12",
        },
      ],
      ...sobre,
    };
  }

  function abrirDetalhe(item: InventoryItemDetailDTO) {
    vi.mocked(getInventoryItem).mockResolvedValue(item);
    vi.mocked(getItemCostReferences).mockResolvedValue(null as never);
    render(
      <MemoryRouter initialEntries={[`/estoque/${item.itemId}`]}>
        <Routes>
          <Route path="/estoque/:itemId" element={<InventoryItemDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("marca o inativo e mantém os lotes; o ajuste não oferece entrada manual", async () => {
    abrirDetalhe(detalhe());
    // O lote só aparece com o detalhe carregado — antes disso o h1 é o "Carregando…".
    expect(await screen.findByText("LT-000118")).toBeInTheDocument();
    const titulo = document.querySelector<HTMLElement>(".doc-title")!;
    expect(within(titulo).getByText("Item inativo")).toHaveClass("badge--inactive");

    fireEvent.click(screen.getByRole("button", { name: "Ajustar estoque" }));
    const tipo = (await screen.findByLabelText(/Tipo/)) as HTMLSelectElement;
    expect(within(tipo).getByRole("option", { name: "Ajuste de entrada" })).toBeDisabled();
    expect(within(tipo).getByRole("option", { name: "Ajuste de saída" })).toBeEnabled();
    expect(within(tipo).getByRole("option", { name: "Perda" })).toBeEnabled();
    expect(tipo.value).toBe("ADJUSTMENT_OUT");
    expect(screen.getByText("Item inativo: sem entrada manual. Sobra física entra pela contagem.")).toBeInTheDocument();
  });

  it("item ativo: sem marca, e a entrada manual segue no ajuste", async () => {
    abrirDetalhe(detalhe({ itemId: "item-ativo", itemCode: "MP-000431", itemName: "Vitamina C", itemActive: true }));
    expect(await screen.findByText("LT-000118")).toBeInTheDocument();
    expect(screen.queryByText("Item inativo")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ajustar estoque" }));
    const tipo = (await screen.findByLabelText(/Tipo/)) as HTMLSelectElement;
    expect(within(tipo).getByRole("option", { name: "Ajuste de entrada" })).toBeEnabled();
    expect(tipo.value).toBe("ADJUSTMENT_IN");
  });
});

describe("Contagem rápida — item inativo elegível", () => {
  const ATIVO = {
    id: "item-ativo",
    code: "MP-000431",
    name: "Vitamina C",
    type: "RAW_MATERIAL",
    unitCode: "kg",
    controlsLot: false,
    active: true,
  } as unknown as ItemDTO;
  const INATIVO = { ...ATIVO, id: "item-inativo", code: "MP-000977", name: "Cafeína anidra", active: false } as ItemDTO;

  function abrirContagem() {
    // A primeira página segue só com ativos; a busca devolve o que o servidor achar.
    vi.mocked(listItems).mockImplementation(async (filtro) =>
      filtro?.search
        ? { items: [INATIVO], page: 1, pageSize: 50, total: 1 }
        : { items: [ATIVO], page: 1, pageSize: 50, total: 1 },
    );
    render(
      <MemoryRouter>
        <StockCountPage />
      </MemoryRouter>,
    );
  }

  async function buscarInativo() {
    const campo = document.getElementById("count-item") as HTMLInputElement;
    fireEvent.focus(campo);
    fireEvent.change(campo, { target: { value: "Cafeína" } });
    await waitFor(() => expect(listItems).toHaveBeenCalledWith({ search: "Cafeína", pageSize: 50 }));
    const opcao = await screen.findByRole("option", { name: /^MP-000977/ });
    expect(opcao).toHaveTextContent("Item inativo");
    fireEvent.mouseDown(opcao);
  }

  it("a busca acha o inativo, marcado, e a posição com saldo é contada", async () => {
    vi.mocked(previewStockCount).mockResolvedValue(
      previa({
        positions: [
          linhaDaPrevia({
            positionKey: "item-inativo",
            itemId: "item-inativo",
            itemCode: "MP-000977",
            itemName: "Cafeína anidra",
            lotId: null,
            lotCode: null,
            lotStatus: null,
            expiryDate: null,
            location: null,
            balance: "10",
          }),
        ],
      }),
    );
    vi.mocked(createQuickStockCount).mockResolvedValue({
      itemId: "item-inativo",
      lotId: null,
      systemQuantity: "10",
      countedQuantity: "12",
      difference: "2",
      movementCreated: null,
      stockCountId: "inv-9",
      stockCountCode: "INV-000009",
      positionId: "pos-9",
      entryId: "e-9",
    });
    abrirContagem();
    await buscarInativo();

    expect(await screen.findByText("Item inativo: entra na contagem só a posição com saldo.")).toBeInTheDocument();
    await waitFor(() =>
      expect(previewStockCount).toHaveBeenCalledWith({ mode: "ASSISTED", scope: { balance: "ANY", itemIds: ["item-inativo"] } }),
    );
    const campo = await waitFor(() => {
      const encontrado = document.getElementById("count-quantity") as HTMLInputElement;
      expect(encontrado).toBeEnabled();
      return encontrado;
    });
    fireEvent.change(campo, { target: { value: "12" } });
    fireEvent.change(document.getElementById("count-reason") as HTMLTextAreaElement, { target: { value: "Sobra encontrada" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar contagem" }));

    await waitFor(() =>
      expect(createQuickStockCount).toHaveBeenCalledWith({
        itemId: "item-inativo",
        countedQuantity: "12",
        reason: "Sobra encontrada",
        expectedSystemQuantity: "10",
      }),
    );
  });

  it("inativo sem saldo: a prévia não traz posição, e a tela diz por quê", async () => {
    vi.mocked(previewStockCount).mockResolvedValue(previa({ positions: [] }));
    abrirContagem();
    await buscarInativo();

    expect(await screen.findByText("Item inativo sem saldo: nenhuma posição para contar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar contagem" })).toBeDisabled();
  });
});
