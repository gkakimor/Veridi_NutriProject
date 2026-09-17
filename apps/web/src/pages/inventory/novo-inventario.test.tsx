import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { StockCountPreviewDTO, UserRole } from "@veridi/shared";
import {
  SALDO_SENTINELA,
  SALDO_SENTINELA_NA_TELA,
  detalhe,
  linhaDaPrevia,
  previa,
} from "./testing/inventario-fixtures";

/**
 * Estoque → Inventário Físico → Novo inventário (INVENTORY-PHYSICAL-COUNT-01, Fatia 2A).
 *
 * A prévia é do servidor e se atualiza sozinha; só a última resposta pedida
 * vale. Na contagem cega ela não mostra saldo — nem se a resposta o trouxesse.
 * Posição presa em outro inventário aparece com o código dele; retirar e
 * recolocar na prévia vai ao servidor; e iniciar sobre um escopo que mudou
 * mostra o delta e exige nova confirmação.
 */

let papel: UserRole = "PRODUCTION";

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: papel } }),
  useOptionalAuth: () => ({ user: { id: "u-1", role: papel } }),
}));
vi.mock("../../lib/items-api", () => ({
  listItems: vi.fn(async () => ({ items: [], page: 1, pageSize: 50, total: 0 })),
}));
vi.mock("../../lib/stock-counts-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/stock-counts-api")>();
  return { ...original, previewStockCount: vi.fn(), startStockCount: vi.fn() };
});

import { StockCountApiError, previewStockCount, startStockCount } from "../../lib/stock-counts-api";
import { NewStockCountPage } from "./NewStockCountPage";

function abrir() {
  return render(
    <MemoryRouter initialEntries={["/estoque/inventario/novo"]}>
      <Routes>
        <Route path="/estoque/inventario/novo" element={<NewStockCountPage />} />
        <Route path="/estoque/inventario/:id" element={<h1>Detalhe (tela)</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

const chamadasDaPrevia = () => vi.mocked(previewStockCount).mock.calls.map((chamada) => chamada[0]);
const iniciar = () => screen.getByRole("button", { name: "Iniciar inventário" });

beforeEach(() => {
  vi.clearAllMocks();
  papel = "PRODUCTION";
  vi.mocked(previewStockCount).mockResolvedValue(previa());
});

describe("novo inventário — prévia", () => {
  it("abre em contagem cega e, cega, não mostra saldo nem se a resposta trouxer", async () => {
    vi.mocked(previewStockCount).mockResolvedValue(
      previa({ positions: [linhaDaPrevia({ balance: SALDO_SENTINELA })] }),
    );
    abrir();
    expect(screen.getByRole("radio", { name: "Contagem cega" })).toBeChecked();
    await screen.findByText("MP-000431");
    expect(chamadasDaPrevia().at(-1)).toMatchObject({ mode: "BLIND", scope: { balance: "WITH_BALANCE", owner: "ALL" } });
    expect(screen.queryByRole("columnheader", { name: "Saldo" })).toBeNull();
    expect(document.body.textContent).not.toContain(SALDO_SENTINELA_NA_TELA);

    vi.mocked(previewStockCount).mockResolvedValue(previa({ positions: [linhaDaPrevia({ balance: "12.5" })] }));
    fireEvent.click(screen.getByRole("radio", { name: "Contagem com saldo" }));
    expect(await screen.findByRole("columnheader", { name: "Saldo" })).toBeInTheDocument();
    expect(await screen.findByText("12,5")).toBeInTheDocument();
    expect(chamadasDaPrevia().at(-1)).toMatchObject({ mode: "ASSISTED" });
  });

  it("só a última resposta pedida vale: a atrasada não sobrescreve", async () => {
    let responderAntiga: (dados: StockCountPreviewDTO) => void = () => undefined;
    vi.mocked(previewStockCount).mockImplementationOnce(
      () => new Promise<StockCountPreviewDTO>((resolve) => (responderAntiga = resolve)),
    );
    abrir();
    await waitFor(() => expect(previewStockCount).toHaveBeenCalledTimes(1));

    vi.mocked(previewStockCount).mockResolvedValueOnce(
      previa({ positions: [linhaDaPrevia({ positionKey: "item-9", itemId: "item-9", itemCode: "ME-000009", itemName: "Tampa", lotId: null, lotCode: null })] }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Material de embalagem" }));
    await screen.findByText("ME-000009");
    expect(chamadasDaPrevia().at(-1)).toMatchObject({ scope: { itemTypes: ["PACKAGING"] } });

    await act(async () => {
      responderAntiga(previa({ positions: [linhaDaPrevia({ itemCode: "MP-ANTIGA" })] }));
    });
    expect(screen.queryByText("MP-ANTIGA")).toBeNull();
    expect(screen.getByText("ME-000009")).toBeInTheDocument();
  });

  it("posição em outro inventário aberto aparece com o código e o link dele", async () => {
    vi.mocked(previewStockCount).mockResolvedValue(
      previa({
        heldByOpenCounts: [
          { positionKey: "item-1:lote-8", itemCode: "MP-000431", lotCode: "LT-8", stockCountId: "inv-13", stockCountCode: "INV-000013" },
          { positionKey: "item-1:lote-9", itemCode: "MP-000431", lotCode: "LT-9", stockCountId: "inv-13", stockCountCode: "INV-000013" },
        ],
      }),
    );
    abrir();
    const link = await screen.findByRole("link", { name: "INV-000013" });
    expect(link).toHaveAttribute("href", "/estoque/inventario/inv-13");
    expect(link.closest("p")).toHaveTextContent("2 posições estão no INV-000013 e ficam fora.");
  });

  it("retirar e recolocar na prévia vão ao servidor pelas chaves", async () => {
    abrir();
    await screen.findAllByText("MP-000431");
    vi.mocked(previewStockCount).mockResolvedValue(
      previa({
        positions: [linhaDaPrevia({ positionKey: "item-1:lote-2", lotId: "lote-2", lotCode: "LT-20260910-000140" })],
        excludedCount: 1,
        excludedPositions: [(({ sequence: _s, ...resto }) => resto)(linhaDaPrevia())],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Retirar da prévia MP-000431 · Vitamina C · lote LT-20260902-000118/ }));
    const recolocar = await screen.findByRole("button", { name: /Recolocar MP-000431 · Vitamina C · lote LT-20260902-000118/ });
    expect(chamadasDaPrevia().at(-1)).toMatchObject({ excludedPositionKeys: ["item-1:lote-1"] });

    vi.mocked(previewStockCount).mockResolvedValue(previa());
    fireEvent.click(recolocar);
    await waitFor(() => expect(chamadasDaPrevia().at(-1)).not.toHaveProperty("excludedPositionKeys"));
  });

  it("escopo que mudou mostra o que entrou e saiu, e só inicia de novo sobre a prévia nova", async () => {
    abrir();
    await screen.findAllByText("MP-000431");
    await waitFor(() => expect(iniciar()).toBeEnabled());

    vi.mocked(startStockCount).mockRejectedValueOnce(
      new StockCountApiError(409, {
        error: "scope_changed",
        message: "As posições do escopo mudaram desde o preview.",
        added: ["item-9"],
        removed: ["item-1:lote-2"],
      }),
    );
    let responderNova: (dados: StockCountPreviewDTO) => void = () => undefined;
    vi.mocked(previewStockCount).mockImplementationOnce(
      () => new Promise<StockCountPreviewDTO>((resolve) => (responderNova = resolve)),
    );
    const previasAntes = vi.mocked(previewStockCount).mock.calls.length;
    fireEvent.click(iniciar());

    const aviso = await screen.findByText("O escopo mudou desde a prévia.");
    const painel = aviso.closest("[role='alert']") as HTMLElement;
    expect(within(painel).getByText("Saiu: MP-000431 · Vitamina C · lote LT-20260910-000140")).toBeInTheDocument();
    // Enquanto a prévia nova não chega, iniciar de novo não é possível.
    expect(iniciar()).toBeDisabled();

    const nova = previa({
      positions: [
        linhaDaPrevia(),
        linhaDaPrevia({ positionKey: "item-9", sequence: 2, itemId: "item-9", itemCode: "ME-000009", itemName: "Tampa", lotId: null, lotCode: null }),
      ],
    });
    // A prévia nova sai depois da pausa de digitação: só então há o que responder.
    await waitFor(() => expect(vi.mocked(previewStockCount).mock.calls.length).toBe(previasAntes + 1));
    await act(async () => {
      responderNova(nova);
    });
    expect(await within(painel).findByText("Entrou: ME-000009 · Tampa")).toBeInTheDocument();
    await waitFor(() => expect(iniciar()).toBeEnabled());

    vi.mocked(startStockCount).mockResolvedValueOnce(detalhe({ id: "inv-novo" }));
    fireEvent.click(iniciar());
    expect(await screen.findByRole("heading", { name: "Detalhe (tela)" })).toBeInTheDocument();
    expect(vi.mocked(startStockCount).mock.calls.at(-1)?.[0]).toMatchObject({
      mode: "BLIND",
      expectedPositionKeys: ["item-1:lote-1", "item-9"],
    });
  });

  it("quem não opera inventário vê o motivo e nenhuma prévia é pedida", async () => {
    papel = "VIEWER";
    abrir();
    expect(await screen.findByText(/Seu perfil consulta os inventários, mas não inicia/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Iniciar inventário" })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(previewStockCount).not.toHaveBeenCalled();
  });
});
