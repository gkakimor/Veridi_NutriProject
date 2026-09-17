import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ItemDTO, StockCountResultDTO, UserRole } from "@veridi/shared";
import { linhaDaPrevia, previa } from "./testing/inventario-fixtures";

/**
 * Estoque → Inventário Físico → Contagem rápida (INVENTORY-PHYSICAL-COUNT-01, Fatia 2B).
 *
 * - a posição retida num inventário aberto aponta o `INV-` e nunca mostra saldo;
 * - o lote aparece com dono, situação, validade, local e saldo;
 * - o confirmar leva o saldo mostrado; saldo que mudou é recusa sem ajuste, e a
 *   tela pede atualizar antes de confirmar de novo;
 * - o resultado traz o `INV-` gravado.
 */

let papel: UserRole = "PRODUCTION";

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: papel } }),
  useOptionalAuth: () => ({ user: { id: "u-1", role: papel } }),
}));
vi.mock("../../lib/items-api", () => ({ listItems: vi.fn() }));
vi.mock("../../lib/stock-counts-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/stock-counts-api")>()),
  previewStockCount: vi.fn(),
  createQuickStockCount: vi.fn(),
}));

import { listItems } from "../../lib/items-api";
import { StockCountApiError, createQuickStockCount, previewStockCount } from "../../lib/stock-counts-api";
import { StockCountPage } from "./StockCountPage";

const COM_LOTE = {
  id: "item-1",
  code: "MP-000431",
  name: "Vitamina C",
  type: "RAW_MATERIAL",
  unitCode: "kg",
  controlsLot: true,
  active: true,
} as unknown as ItemDTO;

const SEM_LOTE = {
  id: "item-2",
  code: "ME-000077",
  name: "Pote PET 500 ml",
  type: "PACKAGING",
  unitCode: "un",
  controlsLot: false,
  active: true,
} as unknown as ItemDTO;

function abrir() {
  return render(
    <MemoryRouter initialEntries={["/estoque/inventario/contagem-rapida"]}>
      <Routes>
        <Route path="/estoque/inventario/contagem-rapida" element={<StockCountPage />} />
        <Route path="/estoque/inventario/:id" element={<h1>Inventário (tela)</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function escolher(item: ItemDTO) {
  const campo = document.getElementById("count-item") as HTMLInputElement;
  fireEvent.focus(campo);
  fireEvent.mouseDown((await screen.findAllByRole("option", { name: new RegExp(item.code) }))[0]!);
}

const RETIDA_EM = { stockCountId: "inv-14", stockCountCode: "INV-000014" };

const resultado = (sobre: Partial<StockCountResultDTO> = {}): StockCountResultDTO => ({
  itemId: "item-2",
  lotId: null,
  systemQuantity: "0.3",
  countedQuantity: "0.1",
  difference: "-0.2",
  movementCreated: null,
  stockCountId: "inv-123",
  stockCountCode: "INV-000123",
  positionId: "pos-1",
  entryId: "e-1",
  ...sobre,
});

beforeEach(() => {
  vi.clearAllMocks();
  papel = "PRODUCTION";
  vi.mocked(listItems).mockResolvedValue({ items: [COM_LOTE, SEM_LOTE], page: 1, pageSize: 50, total: 2 });
});

describe("Contagem rápida — retenção antes do saldo", () => {
  it("lote livre com dono, situação, validade, local e saldo; lote retido só aponta o INV-, sem saldo", async () => {
    vi.mocked(previewStockCount).mockResolvedValue(
      previa({
        positions: [
          linhaDaPrevia({
            positionKey: "item-1:lote-1",
            lotId: "lote-1",
            lotCode: "LT-000118",
            ownerType: "CUSTOMER",
            ownerCustomerCode: "CLI-000003",
            lotStatus: "AVAILABLE",
            expiryDate: "2027-03-31T00:00:00.000Z",
            location: "A-03",
            balance: "12.5",
          }),
        ],
        heldByOpenCounts: [
          { positionKey: "item-1:lote-2", itemCode: "MP-000431", lotCode: "LT-000140", ...RETIDA_EM },
        ],
      }),
    );
    abrir();
    await escolher(COM_LOTE);

    const lotes = await screen.findByRole("group", { name: "Lotes do item" });
    const livre = within(lotes).getByRole("radio", { name: /LT-000118/ });
    expect(livre.closest("label")).toHaveTextContent(
      "LT-000118 · CLI-000003 · Disponível · validade 31/03/2027 · A-03 · saldo 12,5 kg",
    );
    expect(lotes).toHaveTextContent("LT-000140 está em contagem no INV-000014 — registre lá.");
    expect(within(lotes).getByRole("link", { name: "INV-000014" })).toHaveAttribute("href", "/estoque/inventario/inv-14");
    expect(within(lotes).queryByRole("radio", { name: /LT-000140/ })).toBeNull();
    expect(previewStockCount).toHaveBeenCalledWith({ mode: "ASSISTED", scope: { balance: "ANY", itemIds: ["item-1"] } });
  });

  it("item sem lote retido: aponta o INV- e não há saldo nem campo de contagem", async () => {
    vi.mocked(previewStockCount).mockResolvedValue(
      previa({
        positions: [],
        heldByOpenCounts: [{ positionKey: "item-2", itemCode: "ME-000077", lotCode: null, ...RETIDA_EM }],
      }),
    );
    abrir();
    await escolher(SEM_LOTE);

    expect(await screen.findByText(/está em contagem no/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "INV-000014" })).toHaveAttribute("href", "/estoque/inventario/inv-14");
    expect(screen.queryByText("Saldo sistema")).toBeNull();
    expect(document.getElementById("count-quantity")).toBeNull();
    expect(screen.getByRole("button", { name: "Confirmar contagem" })).toBeDisabled();
  });
});

describe("Contagem rápida — confirmar", () => {
  function semLoteComSaldo(saldo: string) {
    return previa({
      positions: [
        linhaDaPrevia({
          positionKey: "item-2",
          itemId: "item-2",
          itemCode: "ME-000077",
          itemName: "Pote PET 500 ml",
          unitCode: "un",
          lotId: null,
          lotCode: null,
          lotStatus: null,
          expiryDate: null,
          location: null,
          balance: saldo,
        }),
      ],
    });
  }

  it("diferença em Decimal, o saldo mostrado vai no envio e o resultado traz o INV-", async () => {
    vi.mocked(previewStockCount).mockResolvedValue(semLoteComSaldo("0.3"));
    vi.mocked(createQuickStockCount).mockResolvedValue(resultado());
    abrir();
    await escolher(SEM_LOTE);
    const campo = await waitFor(() => {
      const encontrado = document.getElementById("count-quantity") as HTMLInputElement;
      expect(encontrado).toBeEnabled();
      return encontrado;
    });
    fireEvent.change(campo, { target: { value: "0,1" } });
    expect(screen.getByText("-0,2 un")).toBeInTheDocument();
    fireEvent.change(document.getElementById("count-reason") as HTMLTextAreaElement, { target: { value: "Quebra" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar contagem" }));

    await waitFor(() =>
      expect(createQuickStockCount).toHaveBeenCalledWith({
        itemId: "item-2",
        countedQuantity: "0.1",
        reason: "Quebra",
        expectedSystemQuantity: "0.3",
      }),
    );
    const documento = await screen.findByRole("link", { name: "INV-000123" });
    expect(documento).toHaveAttribute("href", "/estoque/inventario/inv-123");
  });

  it("saldo que mudou: nada ajustado, confirmar trava até atualizar o saldo", async () => {
    vi.mocked(previewStockCount).mockResolvedValueOnce(semLoteComSaldo("10")).mockResolvedValueOnce(semLoteComSaldo("8"));
    vi.mocked(createQuickStockCount).mockRejectedValueOnce(
      new StockCountApiError(409, {
        error: "system_quantity_changed",
        message: "O saldo mudou desde que você abriu (era 10, agora 8). Confira antes de confirmar.",
        shownQuantity: "10",
        currentQuantity: "8",
      }),
    );
    abrir();
    await escolher(SEM_LOTE);
    await waitFor(() => expect(document.getElementById("count-quantity")).toBeEnabled());
    fireEvent.change(document.getElementById("count-quantity") as HTMLInputElement, { target: { value: "8" } });
    fireEvent.change(document.getElementById("count-reason") as HTMLTextAreaElement, { target: { value: "Consumo não lançado" } });
    const confirmar = screen.getByRole("button", { name: "Confirmar contagem" });
    fireEvent.click(confirmar);

    const alerta = await screen.findByText(/O saldo mudou desde que você abriu \(era 10, agora 8\)/);
    expect(alerta).toHaveTextContent("Nada foi ajustado.");
    expect(confirmar).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Atualizar o saldo" }));
    await waitFor(() => expect(previewStockCount).toHaveBeenCalledTimes(2));
    // Contagem 8 contra o saldo novo 8: confere, sem motivo, e confirmar libera.
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar contagem" })).toBeEnabled());
    expect(document.getElementById("count-reason")).toBeNull();
  });

  it("posição que entrou num inventário no meio do caminho: aponta o INV- e relê as posições", async () => {
    vi.mocked(previewStockCount).mockResolvedValue(semLoteComSaldo("5"));
    vi.mocked(createQuickStockCount).mockRejectedValueOnce(
      new StockCountApiError(409, {
        error: "position_in_open_count",
        message: "Posição em outro inventário (INV-000014). Registre a contagem lá.",
        held: [{ positionKey: "item-2", itemCode: "ME-000077", lotCode: null, ...RETIDA_EM }],
      }),
    );
    abrir();
    await escolher(SEM_LOTE);
    await waitFor(() => expect(document.getElementById("count-quantity")).toBeEnabled());
    fireEvent.change(document.getElementById("count-quantity") as HTMLInputElement, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar contagem" }));

    const alerta = (await screen.findByText(/Posição em outro inventário \(INV-000014\)/)).closest("[role=alert]") as HTMLElement;
    expect(within(alerta).getByRole("link", { name: "INV-000014" })).toHaveAttribute("href", "/estoque/inventario/inv-14");
    expect(alerta).toHaveTextContent("Nada foi ajustado.");
    await waitFor(() => expect(previewStockCount).toHaveBeenCalledTimes(2));
  });

  it("quem não opera não vê formulário nem consulta posições", async () => {
    papel = "VIEWER";
    abrir();
    expect(await screen.findByText(/não registra contagem/)).toBeInTheDocument();
    expect(document.getElementById("count-item")).toBeNull();
    expect(previewStockCount).not.toHaveBeenCalled();
  });
});
