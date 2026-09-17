import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ItemDTO, StockCountDetailDTO, UserRole } from "@veridi/shared";
import {
  SALDO_SENTINELA,
  SALDO_SENTINELA_NA_TELA,
  detalhe,
  linhaDaPrevia,
  posicao,
  posicaoContada,
  previa,
} from "./testing/inventario-fixtures";

/**
 * Estoque → Inventário Físico → um inventário (INVENTORY-PHYSICAL-COUNT-01, Fatia 2A).
 *
 * O detalhe lê a revisão — que o servidor mantém cega até a primeira contagem
 * terminar — e oferece só o que o estado permite a quem opera: contar, adicionar
 * e retirar posição, ocorrência, cancelar e concluir a primeira contagem.
 */

let papel: UserRole = "PRODUCTION";

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: papel } }),
  useOptionalAuth: () => ({ user: { id: "u-1", role: papel } }),
}));
vi.mock("../../lib/units-api", () => ({
  listUnits: vi.fn(async () => [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
  ]),
}));
vi.mock("../../lib/items-api", () => ({ listItems: vi.fn() }));
vi.mock("../../lib/stock-counts-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/stock-counts-api")>();
  return {
    ...original,
    getStockCount: vi.fn(),
    previewStockCount: vi.fn(),
    addStockCountPosition: vi.fn(),
    removeStockCountPosition: vi.fn(),
    createStockCountFinding: vi.fn(),
    cancelStockCount: vi.fn(),
    closeStockCountFirstRound: vi.fn(),
  };
});

import { listItems } from "../../lib/items-api";
import {
  StockCountApiError,
  addStockCountPosition,
  cancelStockCount,
  closeStockCountFirstRound,
  createStockCountFinding,
  getStockCount,
  previewStockCount,
  removeStockCountPosition,
} from "../../lib/stock-counts-api";
import { StockCountDetailPage } from "./StockCountDetailPage";

const ITEM_COM_LOTE = {
  id: "item-5",
  code: "MP-000500",
  name: "Magnésio quelato",
  type: "RAW_MATERIAL",
  unitCode: "kg",
  unit: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  controlsLot: true,
  active: true,
} as unknown as ItemDTO;

function abrir() {
  return render(
    <MemoryRouter initialEntries={["/estoque/inventario/inv-1"]}>
      <Routes>
        <Route path="/estoque/inventario/:id" element={<StockCountDetailPage />} />
        <Route path="/estoque/inventario/:id/contagem" element={<h1>Contagem (tela)</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function carregado() {
  return screen.findByRole("heading", { level: 1, name: "INV-000014" });
}

function revisao(overrides: Partial<StockCountDetailDTO> = {}): StockCountDetailDTO {
  return detalhe({ view: "review", ...overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
  papel = "PRODUCTION";
  vi.mocked(getStockCount).mockResolvedValue(revisao());
  vi.mocked(listItems).mockResolvedValue({ items: [ITEM_COM_LOTE], page: 1, pageSize: 50, total: 1 });
});

describe("detalhe do inventário — leitura e ações", () => {
  it("lê a revisão; cega em contagem não tem coluna de saldo", async () => {
    abrir();
    await carregado();
    expect(getStockCount).toHaveBeenCalledWith("inv-1", "review");
    expect(screen.queryByRole("columnheader", { name: "Saldo de referência" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Diferença" })).toBeNull();
  });

  it("em contagem, quem opera vê contar, adicionar, ocorrência, cancelar, concluir e retirar", async () => {
    abrir();
    await carregado();
    for (const nome of ["Adicionar posição", "Registrar ocorrência", "Cancelar inventário", "Concluir primeira contagem"]) {
      expect(screen.getByRole("button", { name: nome })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Contar" })).toHaveAttribute("href", "/estoque/inventario/inv-1/contagem");
    expect(screen.getByRole("button", { name: "Retirar a posição 1" })).toBeInTheDocument();
  });

  it.each(["VIEWER", "COMMERCIAL", "PURCHASING"] as const)("%s consulta sem nenhuma ação de escrita", async (role) => {
    papel = role;
    abrir();
    await carregado();
    expect(screen.queryByRole("link", { name: "Contar" })).toBeNull();
    for (const nome of ["Adicionar posição", "Registrar ocorrência", "Cancelar inventário", "Concluir primeira contagem"]) {
      expect(screen.queryByRole("button", { name: nome })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: /Retirar a posição/ })).toBeNull();
  });

  it("em revisão: revisa e encerra, sem adicionar, retirar nem concluir — e mostra o que o servidor revelou", async () => {
    vi.mocked(getStockCount).mockResolvedValue(
      revisao({
        status: "IN_REVIEW",
        balancesHidden: false,
        divergentCount: 1,
        firstRoundClosedAt: "2026-09-15T15:00:00.000Z",
        firstRoundClosedByName: "Bruno Produção",
        positions: [
          posicaoContada(
            { situation: "DIVERGENT", referenceQuantity: "12.5", finalDifference: "-0.5" },
            { countedQuantity: "12", expectedQuantity: "12.5", difference: "-0.5" },
          ),
        ],
      }),
    );
    abrir();
    await carregado();
    expect(screen.getByText(/Revise as divergências/)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Saldo de referência" })).toBeInTheDocument();
    // Saldo de referência e esperado da posição, os dois revelados.
    expect(screen.getAllByText("12,5 kg")).toHaveLength(2);
    expect(screen.getByText("Divergente")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adicionar posição" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Concluir primeira contagem" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Retirar a posição/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancelar inventário" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Encerrar inventário" })).toBeInTheDocument();
  });
});

describe("detalhe do inventário — posições", () => {
  it("retirar exige motivo e avisa que é definitivo", async () => {
    abrir();
    await carregado();
    fireEvent.click(screen.getByRole("button", { name: "Retirar a posição 1" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(dialogo).toHaveTextContent("A retirada é definitiva neste inventário.");
    const confirmar = within(dialogo).getByRole("button", { name: "Retirar posição" });
    expect(confirmar).toBeDisabled();

    vi.mocked(removeStockCountPosition).mockResolvedValue(posicao({ situation: "REMOVED", removedAt: "2026-09-15T13:00:00.000Z" }));
    fireEvent.change(within(dialogo).getByLabelText(/Motivo/), { target: { value: "Item descontinuado" } });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);
    await waitFor(() =>
      expect(removeStockCountPosition).toHaveBeenCalledWith("inv-1", "p-1", { reason: "Item descontinuado" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("adicionar posição escolhe o lote pela prévia no modo do inventário, sem saldo na cega", async () => {
    vi.mocked(previewStockCount).mockResolvedValue(
      previa({
        positions: [
          linhaDaPrevia({ positionKey: "item-5:lote-50", itemId: "item-5", itemCode: "MP-000500", lotId: "lote-50", lotCode: "LT-50", balance: SALDO_SENTINELA }),
        ],
      }),
    );
    vi.mocked(addStockCountPosition).mockResolvedValue(
      posicao({ id: "p-9", sequence: 9, itemCode: "MP-000500", lotCode: "LT-50", origin: "ADDED" }),
    );
    abrir();
    await carregado();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar posição" }));
    const dialogo = await screen.findByRole("alertdialog");

    const busca = within(dialogo).getByPlaceholderText("Digite código ou nome do item…");
    fireEvent.focus(busca);
    fireEvent.mouseDown((await within(document.body).findAllByRole("option", { name: /MP-000500/ }))[0]!);

    const lote = await within(dialogo).findByRole("radio", { name: /LT-50/ });
    expect(previewStockCount).toHaveBeenCalledWith({ mode: "BLIND", scope: { balance: "ANY", itemIds: ["item-5"] } });
    expect(dialogo.textContent).not.toContain(SALDO_SENTINELA_NA_TELA);
    fireEvent.click(lote);
    fireEvent.change(within(dialogo).getByLabelText(/Motivo/), { target: { value: "Achado na doca" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Adicionar posição" }));

    await waitFor(() =>
      expect(addStockCountPosition).toHaveBeenCalledWith("inv-1", { itemId: "item-5", lotId: "lote-50", reason: "Achado na doca" }),
    );
    expect(await screen.findByText("Posição 9 adicionada: MP-000500 · LT-50.")).toBeInTheDocument();
  });
});

describe("detalhe do inventário — ocorrência, cancelar e concluir", () => {
  it("ocorrência: lote sem cadastro exige o item; item sem cadastro não aponta item", async () => {
    vi.mocked(createStockCountFinding).mockResolvedValue({
      id: "f-1",
      kind: "UNREGISTERED_ITEM",
      itemId: null,
      itemCode: null,
      itemName: null,
      identification: "Caixa sem etiqueta",
      quantity: null,
      unitCode: null,
      note: null,
      createdAt: "2026-09-15T13:00:00.000Z",
      createdByName: "Bruno Produção",
    });
    abrir();
    await carregado();
    fireEvent.click(screen.getByRole("button", { name: "Registrar ocorrência" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByRole("radio", { name: "Lote sem cadastro" })).toBeChecked();
    expect(within(dialogo).getByText(/não cria item\s+nem lote, não mexe no estoque e não impede o encerramento/)).toBeInTheDocument();

    fireEvent.change(within(dialogo).getByLabelText(/Identificação/), { target: { value: "Caixa sem etiqueta" } });
    // Lote sem cadastro sem o item do ERP não grava.
    expect(within(dialogo).getByRole("button", { name: "Registrar ocorrência" })).toBeDisabled();

    fireEvent.click(within(dialogo).getByRole("radio", { name: "Item sem cadastro" }));
    expect(within(dialogo).queryByPlaceholderText("Digite código ou nome do item…")).toBeNull();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar ocorrência" }));
    await waitFor(() =>
      expect(createStockCountFinding).toHaveBeenCalledWith("inv-1", {
        kind: "UNREGISTERED_ITEM",
        identification: "Caixa sem etiqueta",
      }),
    );
  });

  it("cancelar explica o que acontece, exige motivo e deixa somente leitura", async () => {
    vi.mocked(cancelStockCount).mockResolvedValue(
      revisao({ status: "CANCELLED", cancelledAt: "2026-09-15T14:00:00.000Z", cancelledByName: "Bruno Produção", cancelReason: "Escopo errado" }),
    );
    abrir();
    await carregado();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar inventário" }));
    const dialogo = await screen.findByRole("alertdialog");
    for (const frase of [
      "Nada é apagado",
      "Nenhuma movimentação de estoque é criada.",
      "As posições ficam livres para outro inventário.",
      "Inventário cancelado não reabre.",
    ]) {
      expect(dialogo).toHaveTextContent(frase);
    }
    const confirmar = within(dialogo).getByRole("button", { name: "Cancelar inventário" });
    expect(confirmar).toBeDisabled();
    fireEvent.change(within(dialogo).getByLabelText(/Motivo do cancelamento/), { target: { value: "Escopo errado" } });
    fireEvent.click(confirmar);

    await waitFor(() => expect(cancelStockCount).toHaveBeenCalledWith("inv-1", { reason: "Escopo errado" }));
    expect(await screen.findByText(/Somente leitura — nada foi apagado/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar inventário" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Contar" })).toBeNull();
  });

  it("concluir mostra a quantidade que falta segundo o servidor e, concluída, revela a revisão", async () => {
    abrir();
    await carregado();
    vi.mocked(closeStockCountFirstRound).mockRejectedValueOnce(
      new StockCountApiError(409, { error: "first_round_incomplete", message: "Faltam contar 3 posições.", pendingCount: 3 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Concluir primeira contagem" }));
    let dialogo = await screen.findByRole("alertdialog");
    expect(dialogo).toHaveTextContent("contagem cega se revela");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Concluir primeira contagem" }));
    expect(await within(dialogo).findByText("Faltam 3 posições sem contagem nem retirada.")).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Contar pendentes" })).toBeInTheDocument();
    fireEvent.click(within(dialogo).getByRole("button", { name: "Voltar" }));

    vi.mocked(closeStockCountFirstRound).mockResolvedValueOnce(
      revisao({
        status: "IN_REVIEW",
        balancesHidden: false,
        divergentCount: 0,
        firstRoundClosedAt: "2026-09-15T15:00:00.000Z",
        firstRoundClosedByName: "Bruno Produção",
        positions: [posicaoContada({ situation: "MATCHES", referenceQuantity: "5", finalDifference: "0" })],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Concluir primeira contagem" }));
    dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Concluir primeira contagem" }));

    expect(await screen.findByText(/Revise as divergências/)).toBeInTheDocument();
    expect(screen.getByText("Em revisão", { selector: ".badge" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Saldo de referência" })).toBeInTheDocument();
    expect(screen.getByText("Confere")).toBeInTheDocument();
  });

  it("linha do tempo só com o que o servidor carimbou", async () => {
    vi.mocked(getStockCount).mockResolvedValue(
      revisao({
        createdAt: "2026-09-15T11:02:00.000Z",
        positions: [
          posicao(),
          posicao({
            id: "p-2",
            sequence: 2,
            situation: "REMOVED",
            removedAt: "2026-09-15T11:30:00.000Z",
            removedByName: "Bruno Produção",
            removeReason: "Lote descartado",
          }),
        ],
        findings: [
          {
            id: "f-1",
            kind: "UNREGISTERED_LOT",
            itemId: "item-1",
            itemCode: "MP-000431",
            itemName: "Vitamina C",
            identification: "Lote do fabricante ABC-123",
            quantity: "2",
            unitCode: "kg",
            note: null,
            createdAt: "2026-09-15T11:45:00.000Z",
            createdByName: "Ana Administradora",
          },
        ],
      }),
    );
    abrir();
    await carregado();
    const linha = screen.getByRole("list", { name: "Linha do tempo do inventário" });
    const eventos = within(linha).getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(eventos).toHaveLength(3);
    expect(eventos[0]).toContain("Inventário iniciado por Ana Administradora.");
    expect(eventos[1]).toContain("retirada por Bruno Produção: Lote descartado.");
    expect(eventos[2]).toContain("Ocorrência registrada por Ana Administradora: Lote sem cadastro — Lote do fabricante ABC-123.");
    expect(eventos.join(" ")).not.toMatch(/encerrado|cancelado|Primeira contagem/);
  });
});
