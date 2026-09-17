import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  StockCountDetailDTO,
  StockCountPositionDTO,
  StockCountPositionMovementDTO,
  UserRole,
} from "@veridi/shared";
import { detalhe, emularCelular, posicao, posicaoContada } from "./testing/inventario-fixtures";

/**
 * Estoque → Inventário Físico → revisão, decisão e encerramento
 * (INVENTORY-PHYSICAL-COUNT-01, Fatia 2B).
 *
 * O que estes testes seguram:
 *
 * - a revisão mostra o que o servidor revelou — confere, divergente,
 *   recontagem pedida, decidida, com movimentação — e a seleção é caixa a
 *   caixa, pelo id da posição;
 * - recontagem e decisão mandam exatamente os ids escolhidos; motivo é
 *   obrigatório; movimentação durante o inventário pede confirmação marcada à
 *   mão, e a tela nunca a manda sozinha;
 * - o encerramento mostra a consequência por unidade, em `Decimal`, sem somar
 *   unidades diferentes, e manda os ajustes que mostrou; recusado, nada foi
 *   gravado e cada posição traz as ações que a resolvem;
 * - abaixo de 640px a revisão é cartão e o diálogo ocupa a tela.
 */

let papel: UserRole = "QUALITY";

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: papel } }),
  useOptionalAuth: () => ({ user: { id: "u-1", role: papel } }),
}));
vi.mock("../../lib/units-api", () => ({ listUnits: vi.fn(async () => []) }));
vi.mock("../../lib/items-api", () => ({ listItems: vi.fn(async () => ({ items: [], page: 1, pageSize: 50, total: 0 })) }));
vi.mock("../../lib/stock-counts-api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/stock-counts-api")>();
  return {
    ...original,
    getStockCount: vi.fn(),
    requestStockCountRecount: vi.fn(),
    decideStockCountPositions: vi.fn(),
    completeStockCount: vi.fn(),
    getStockCountPositionMovements: vi.fn(),
  };
});

import {
  StockCountApiError,
  completeStockCount,
  decideStockCountPositions,
  getStockCount,
  getStockCountPositionMovements,
  requestStockCountRecount,
} from "../../lib/stock-counts-api";
import { StockCountDetailPage } from "./StockCountDetailPage";

function contada(
  id: string,
  sequence: number,
  sobre: Partial<StockCountPositionDTO>,
  numeros: { contado: string; esperado: string; rodada?: number },
): StockCountPositionDTO {
  const diferenca = String(Number(numeros.contado) - Number(numeros.esperado));
  return posicaoContada(
    {
      id,
      sequence,
      positionKey: `item-${id}:lote-${id}`,
      lotId: `lote-${id}`,
      lotCode: `LT-${sequence}`,
      finalDifference: diferenca,
      hasConcurrentMovement: false,
      currentRound: numeros.rodada ?? 1,
      ...sobre,
    },
    {
      id: `e-${id}`,
      round: numeros.rodada ?? 1,
      countedQuantity: numeros.contado,
      expectedQuantity: numeros.esperado,
      difference: diferenca,
    },
  );
}

const CONFERE = contada("p-1", 1, { situation: "MATCHES", referenceQuantity: "5", itemCode: "MP-000001" }, { contado: "5", esperado: "5" });
const DIVERGENTE = contada(
  "p-2",
  2,
  { situation: "DIVERGENT", referenceQuantity: "12.5", itemCode: "MP-000002", itemName: "Vitamina D" },
  { contado: "12", esperado: "12.5" },
);
const COM_MOVIMENTACAO = contada(
  "p-3",
  3,
  { situation: "DIVERGENT", referenceQuantity: "10", itemCode: "MP-000003", itemName: "Colágeno", hasConcurrentMovement: true },
  { contado: "7", esperado: "8" },
);
const RECONTAGEM: StockCountPositionDTO = {
  ...contada("p-4", 4, { situation: "RECOUNT_REQUESTED", referenceQuantity: "3", itemCode: "MP-000004" }, { contado: "2", esperado: "3" }),
  currentRound: 2,
  lastEntryId: null,
  recountRequestedRound: 2,
  recountRequestedAt: "2026-09-15T16:00:00.000Z",
  recountRequestedByName: "Bruno Produção",
};
const DECIDIDA = contada(
  "p-5",
  5,
  {
    situation: "DECIDED",
    referenceQuantity: "20",
    itemCode: "ME-000005",
    itemName: "Pote PET",
    unitCode: "un",
    lotId: null,
    lotCode: null,
    positionKey: "item-p-5",
    decision: "ADJUST",
    decisionReason: "Quebra",
    decidedByName: "Carla Qualidade",
    decidedAt: "2026-09-15T16:30:00.000Z",
  },
  { contado: "8", esperado: "20" },
);

function emRevisao(overrides: Partial<StockCountDetailDTO> = {}): StockCountDetailDTO {
  return detalhe({
    view: "review",
    status: "IN_REVIEW",
    balancesHidden: false,
    firstRoundClosedAt: "2026-09-15T15:00:00.000Z",
    firstRoundClosedByName: "Bruno Produção",
    divergentCount: 3,
    positions: [CONFERE, DIVERGENTE, COM_MOVIMENTACAO, RECONTAGEM, DECIDIDA],
    ...overrides,
  });
}

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

const caixa = (numero: number) => screen.getByRole("checkbox", { name: `Selecionar a posição ${numero}` });
const barra = () => screen.getByRole("region", { name: "Ações nas posições selecionadas" });

beforeEach(() => {
  vi.clearAllMocks();
  papel = "QUALITY";
  emularCelular(false);
  vi.mocked(getStockCount).mockResolvedValue(emRevisao());
});

afterEach(() => {
  emularCelular(false);
});

describe("revisão — o que o servidor revelou e a seleção por id", () => {
  it("situações reveladas, marca de movimentação e recortes com a quantidade de cada um", async () => {
    abrir();
    await carregado();
    const recortes = screen.getByRole("group", { name: "Recorte da revisão" });
    for (const nome of ["Divergentes · 2", "Com movimentação · 1", "Recontagem pedida · 1", "Decididas · 1", "Conferem · 1"]) {
      expect(within(recortes).getByRole("button", { name: nome })).toBeInTheDocument();
    }
    expect(screen.getByText("Confere")).toBeInTheDocument();
    expect(screen.getAllByText("Divergente")).toHaveLength(2);
    expect(screen.getByText("Recontagem pedida", { selector: ".badge" })).toBeInTheDocument();
    expect(screen.getByText("Decidida")).toBeInTheDocument();
    expect(screen.getByText("Com movimentação", { selector: ".badge" })).toBeInTheDocument();
    expect(screen.getByText(/Ajustar — Saída de 12 un: Quebra · Carla Qualidade/)).toBeInTheDocument();
    expect(screen.getByText(/Pedida por Bruno Produção/)).toBeInTheDocument();

    fireEvent.click(within(recortes).getByRole("button", { name: "Com movimentação · 1" }));
    const tabela = screen.getByRole("columnheader", { name: "Saldo de referência" }).closest("table") as HTMLElement;
    const linhas = within(tabela).getAllByRole("row").slice(1);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toHaveTextContent("MP-000003");
  });

  it("recontagem pedida não se seleciona; conferir só permite recontar; ações valem para todas as escolhidas", async () => {
    abrir();
    await carregado();
    expect(caixa(4)).toBeDisabled();

    fireEvent.click(caixa(1));
    expect(within(barra()).getByText("1 posição selecionada")).toBeInTheDocument();
    expect(within(barra()).getByRole("button", { name: "Pedir recontagem" })).toBeEnabled();
    expect(within(barra()).getByRole("button", { name: "Ajustar" })).toBeDisabled();
    expect(within(barra()).getByRole("button", { name: "Não ajustar" })).toBeDisabled();
    expect(within(barra()).getByText(/1 posição selecionada confere/)).toBeInTheDocument();

    fireEvent.click(caixa(1));
    fireEvent.click(caixa(2));
    fireEvent.click(caixa(5));
    expect(within(barra()).getByRole("button", { name: "Ajustar" })).toBeEnabled();
    expect(within(barra()).getByRole("button", { name: "Pedir recontagem" })).toBeEnabled();
  });

  it("quem não opera lê a revisão sem seleção, sem ações e sem encerrar", async () => {
    papel = "VIEWER";
    abrir();
    await carregado();
    expect(screen.getByText("Divergentes · 2", { selector: "button" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("region", { name: "Ações nas posições selecionadas" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Encerrar inventário" })).toBeNull();
  });
});

describe("recontagem e decisão", () => {
  it("pedir recontagem manda os ids escolhidos, explica a cegueira e a decisão apagada", async () => {
    vi.mocked(requestStockCountRecount).mockResolvedValue(emRevisao());
    abrir();
    await carregado();
    fireEvent.click(caixa(2));
    fireEvent.click(caixa(5));
    fireEvent.click(within(barra()).getByRole("button", { name: "Pedir recontagem" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(dialogo).toHaveTextContent("Pedir recontagem de 2 posições?");
    expect(dialogo).toHaveTextContent("quem reconta não vê a contagem anterior, o saldo nem a diferença");
    expect(dialogo).toHaveTextContent("A decisão já tomada numa delas é apagada");
    expect(dialogo).toHaveTextContent("Nenhum ajuste de estoque é feito agora.");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Pedir recontagem" }));

    await waitFor(() =>
      expect(requestStockCountRecount).toHaveBeenCalledWith("inv-1", { positionIds: ["p-2", "p-5"] }),
    );
    expect(await screen.findByText('Recontagem pedida para 2 posições. Quem conta usa "Contar pendentes".')).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("Ajustar exige motivo, mostra o ajuste de cada diferença e não manda confirmação que ninguém marcou", async () => {
    vi.mocked(decideStockCountPositions).mockResolvedValue(emRevisao());
    abrir();
    await carregado();
    fireEvent.click(caixa(2));
    fireEvent.click(within(barra()).getByRole("button", { name: "Ajustar" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByRole("radio", { name: "Ajustar" })).toBeChecked();
    expect(dialogo).toHaveTextContent("Diferença -0,5 kg · Saída de 0,5 kg");
    const confirmar = within(dialogo).getByRole("button", { name: "Ajustar 1 posição" });
    expect(confirmar).toBeDisabled();
    fireEvent.change(within(dialogo).getByLabelText(/Motivo/), { target: { value: "ok" } });
    expect(confirmar).toBeDisabled();
    fireEvent.change(within(dialogo).getByLabelText(/Motivo/), { target: { value: "Avaria na embalagem" } });
    fireEvent.click(confirmar);

    await waitFor(() =>
      expect(decideStockCountPositions).toHaveBeenCalledWith("inv-1", {
        decisions: [{ positionId: "p-2", decision: "ADJUST", reason: "Avaria na embalagem" }],
      }),
    );
    expect(await screen.findByText("Decisão registrada em 1 posição.")).toBeInTheDocument();
  });

  it("movimentação durante o inventário: lista os movimentos e só decide com a confirmação marcada à mão", async () => {
    const movimento = (sobre: Partial<StockCountPositionMovementDTO>): StockCountPositionMovementDTO =>
      ({
        id: "m-1",
        itemId: "item-p-3",
        itemCode: "MP-000003",
        itemName: "Colágeno",
        unitCode: "kg",
        lotId: "lote-p-3",
        lotCode: "LT-3",
        type: "PRODUCTION_CONSUMPTION",
        quantity: "2",
        occurredAt: "2026-09-15T13:10:00.000Z",
        sourceType: "PRODUCTION_CONSUMPTION",
        sourceId: "op-1",
        receiptId: null,
        receiptCode: null,
        purchaseOrderId: null,
        purchaseOrderCode: null,
        shipmentId: null,
        shipmentCode: null,
        productionOrderId: "op-1",
        productionOrderCode: "OP-2026-0031",
        projectSampleId: null,
        projectSampleCode: null,
        stockCountId: null,
        stockCountCode: null,
        reason: null,
        createdBy: "Bruno Produção",
        createdAt: "2026-09-15T13:10:00.000Z",
        afterCount: false,
        retroactive: false,
        ...sobre,
      }) as StockCountPositionMovementDTO;
    vi.mocked(getStockCountPositionMovements).mockResolvedValue({
      positionId: "p-3",
      referenceAt: "2026-09-15T11:02:00.000Z",
      countedAt: "2026-09-15T13:15:00.000Z",
      balancesHidden: false,
      movements: [
        movimento({}),
        movimento({
          id: "m-2",
          type: "RECEIPT_IN",
          quantity: "5",
          sourceType: "RECEIPT",
          productionOrderId: null,
          productionOrderCode: null,
          occurredAt: "2026-09-15T12:00:00.000Z",
          createdAt: "2026-09-15T14:00:00.000Z",
          afterCount: true,
          retroactive: true,
        }),
      ],
      total: 2,
    });
    vi.mocked(decideStockCountPositions).mockResolvedValue(emRevisao());
    abrir();
    await carregado();
    fireEvent.click(caixa(2));
    fireEvent.click(caixa(3));
    fireEvent.click(within(barra()).getByRole("button", { name: "Não ajustar" }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByRole("radio", { name: "Não ajustar" })).toBeChecked();
    expect(dialogo).toHaveTextContent("Movimentação durante o inventário.");
    fireEvent.change(within(dialogo).getByLabelText(/Motivo/), { target: { value: "Etiqueta trocada" } });
    const confirmar = within(dialogo).getByRole("button", { name: "Não ajustar 2 posições" });
    expect(confirmar).toBeDisabled();
    expect(dialogo).toHaveTextContent("Falta confirmar a movimentação de 1 posição");

    fireEvent.click(within(dialogo).getByRole("button", { name: "Ver movimentos" }));
    const lista = await within(dialogo).findByRole("list", { name: "Movimentos depois do início do inventário" });
    expect(lista).toHaveTextContent("−2 kg");
    expect(lista).toHaveTextContent("OP-2026-0031");
    expect(lista).toHaveTextContent("+5 kg");
    expect(within(lista).getByText("Lançamento retroativo: ocorreu antes da contagem")).toBeInTheDocument();
    expect(getStockCountPositionMovements).toHaveBeenCalledWith("inv-1", "p-3");

    fireEvent.click(
      within(dialogo).getByRole("checkbox", { name: /Confirmo que os movimentos da posição 3 não invalidam a contagem/ }),
    );
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);

    await waitFor(() =>
      expect(decideStockCountPositions).toHaveBeenCalledWith("inv-1", {
        decisions: [
          { positionId: "p-2", decision: "NO_ADJUSTMENT", reason: "Etiqueta trocada" },
          { positionId: "p-3", decision: "NO_ADJUSTMENT", reason: "Etiqueta trocada", confirmConcurrentMovement: true },
        ],
      }),
    );
  });
});

describe("encerramento", () => {
  const ENTRADA = contada(
    "a",
    1,
    { situation: "DECIDED", decision: "ADJUST", decisionReason: "Sobra", itemId: "item-1", lotId: "lote-a" },
    { contado: "10.5", esperado: "10" },
  );
  const SAIDA = contada(
    "b",
    2,
    { situation: "DECIDED", decision: "ADJUST", decisionReason: "Avaria", itemId: "item-1", lotId: "lote-b" },
    { contado: "8.75", esperado: "10" },
  );
  const SAIDA_EM_UN = contada(
    "c",
    3,
    { situation: "DECIDED", decision: "ADJUST", decisionReason: "Quebra", itemId: "item-2", lotId: null, lotCode: null, unitCode: "un" },
    { contado: "8", esperado: "20" },
  );
  const SEM_AJUSTE = contada(
    "d",
    4,
    { situation: "DECIDED", decision: "NO_ADJUSTMENT", decisionReason: "Lote trocado", itemId: "item-3", lotId: "lote-d" },
    { contado: "3", esperado: "5" },
  );
  const CONFERE_ENC = contada("e", 5, { situation: "MATCHES", itemId: "item-4", lotId: "lote-e" }, { contado: "1", esperado: "1" });

  function paraEncerrar(overrides: Partial<StockCountDetailDTO> = {}) {
    return emRevisao({
      positions: [ENTRADA, SAIDA, SAIDA_EM_UN, SEM_AJUSTE, CONFERE_ENC],
      findings: [
        {
          id: "f-1",
          kind: "OTHER",
          itemId: null,
          itemCode: null,
          itemName: null,
          identification: "Caixa sem etiqueta",
          quantity: null,
          unitCode: null,
          note: null,
          createdAt: "2026-09-15T14:00:00.000Z",
          createdByName: "Ana Administradora",
        },
      ],
      ...overrides,
    });
  }

  it("mostra entradas, saídas e somas por unidade em Decimal — nunca somando kg com un — e manda os ajustes vistos", async () => {
    vi.mocked(getStockCount).mockResolvedValue(paraEncerrar());
    vi.mocked(completeStockCount).mockResolvedValue(
      paraEncerrar({
        status: "COMPLETED",
        completedAt: "2026-09-15T18:00:00.000Z",
        completedByName: "Carla Qualidade",
        positions: [
          { ...ENTRADA, adjustmentMovementId: "m-a" },
          { ...SAIDA, adjustmentMovementId: "m-b" },
          { ...SAIDA_EM_UN, adjustmentMovementId: "m-c" },
          SEM_AJUSTE,
          CONFERE_ENC,
        ],
      }),
    );
    abrir();
    await carregado();
    fireEvent.click(screen.getByRole("button", { name: "Encerrar inventário" }));

    const dialogo = await screen.findByRole("alertdialog");
    await within(dialogo).findByText(/Serão gerados 3 ajustes de estoque/);
    expect(dialogo).toHaveTextContent("Serão gerados 3 ajustes de estoque: 1 entrada · 2 saídas · 2 itens · 2 lotes.");
    const unidades = within(dialogo).getByRole("list", { name: "Ajustes por unidade" });
    const linhas = within(unidades).getAllByRole("listitem").map((linha) => linha.textContent);
    expect(linhas).toEqual(["kg: entradas +0,5 · saídas −1,25", "un: saídas −12"]);
    expect(dialogo.textContent).not.toMatch(/13,25|12,75|11,5/);
    expect(dialogo).toHaveTextContent("1 posição decidida Não ajustar · 1 confere · 1 ocorrência (não geram ajuste)");

    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar encerramento" }));
    await waitFor(() =>
      expect(completeStockCount).toHaveBeenCalledWith("inv-1", {
        expectedAdjustments: [
          { positionId: "a", entryId: "e-a" },
          { positionId: "b", entryId: "e-b" },
          { positionId: "c", entryId: "e-c" },
        ],
      }),
    );
    expect(await screen.findByText("INV-000014 encerrado: 3 ajustes de estoque gerados.")).toBeInTheDocument();
    expect(screen.getByText("Encerrado", { selector: ".badge" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Encerrar inventário" })).toBeNull();
  });

  it("recusado: nada gravado, cada posição com saldo, ajuste, reservado, motivo e a ação que resolve", async () => {
    const REDUZIDA = contada(
      "p-2",
      2,
      { situation: "DECIDED", decision: "ADJUST", decisionReason: "Avaria", itemCode: "MP-000002", itemName: "Vitamina D", lotCode: "LT-2" },
      { contado: "7", esperado: "10" },
    );
    vi.mocked(getStockCount).mockResolvedValue(emRevisao({ positions: [REDUZIDA, COM_MOVIMENTACAO] }));
    vi.mocked(completeStockCount).mockRejectedValue(
      new StockCountApiError(409, {
        error: "stock_count_close_blocked",
        message: "O encerramento foi recusado em 2 posições. Revise a lista.",
        issues: [
          { positionId: "p-2", sequence: 2, itemCode: "MP-000002", lotCode: "LT-2", issue: "BELOW_RESERVED", balance: "5", adjustment: "-3", reserved: "4" },
          { positionId: "p-3", sequence: 3, itemCode: "MP-000003", lotCode: "LT-3", issue: "UNDECIDED", balance: null, adjustment: null, reserved: null },
        ],
      }),
    );
    abrir();
    await carregado();
    fireEvent.click(screen.getByRole("button", { name: "Encerrar inventário" }));
    let dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(await within(dialogo).findByRole("button", { name: "Confirmar encerramento" }));

    expect(await within(dialogo).findByText("Encerramento do INV-000014 recusado")).toBeInTheDocument();
    expect(dialogo).toHaveTextContent("Nada foi gravado: nenhum ajuste, nenhuma decisão mudou");
    const recusas = within(dialogo).getAllByRole("listitem").filter((item) => item.className === "inv-recusa");
    expect(recusas).toHaveLength(2);
    expect(recusas[0]).toHaveTextContent("Posição 2 · MP-000002 · Vitamina D · lote LT-2");
    expect(recusas[0]).toHaveTextContent("O ajuste deixaria o saldo abaixo do reservado");
    expect(recusas[0]).toHaveTextContent("Saldo agora5 kgAjuste-3 kgReservado4 kg");
    expect(recusas[1]).toHaveTextContent("Divergência sem decisão");
    expect(within(recusas[0]!).getByRole("button", { name: "Recontar a posição 2" })).toBeInTheDocument();
    expect(within(recusas[1]!).getByRole("button", { name: "Redecidir a posição 3" })).toBeInTheDocument();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Voltar à revisão" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByText(/Encerramento recusado em 2 posições/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recusadas no encerramento · 2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Recusada no encerramento: O ajuste deixaria o saldo abaixo do reservado")).toBeInTheDocument();

    // Redecidir a partir da recusa abre a decisão daquela posição, com a decisão que ela tinha.
    fireEvent.click(screen.getByRole("button", { name: "Encerrar inventário" }));
    dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(await within(dialogo).findByRole("button", { name: "Confirmar encerramento" }));
    fireEvent.click(await within(dialogo).findByRole("button", { name: "Redecidir a posição 2" }));
    const decisao = await screen.findByRole("alertdialog");
    expect(decisao).toHaveTextContent("Decidir 1 posição");
    expect(within(decisao).getByRole("radio", { name: "Ajustar" })).toBeChecked();
    expect(decisao).toHaveTextContent("2 · MP-000002 · Vitamina D · lote LT-2");
  });

  it("ajustes que mudaram depois de abrir: recusa sem gravar e só confirma de novo com o resumo atualizado", async () => {
    vi.mocked(getStockCount).mockResolvedValue(paraEncerrar());
    vi.mocked(completeStockCount).mockRejectedValueOnce(
      new StockCountApiError(409, {
        error: "stock_count_changed",
        message: "O inventário mudou desde que você abriu o encerramento: os ajustes a gerar já não são os mostrados.",
      }),
    );
    abrir();
    await carregado();
    fireEvent.click(screen.getByRole("button", { name: "Encerrar inventário" }));
    const dialogo = await screen.findByRole("alertdialog");
    const confirmar = await within(dialogo).findByRole("button", { name: "Confirmar encerramento" });
    await within(dialogo).findByText(/Serão gerados 3 ajustes/);
    fireEvent.click(confirmar);

    expect(await within(dialogo).findByText(/O inventário mudou desde que você abriu o encerramento/)).toBeInTheDocument();
    expect(confirmar).toBeDisabled();
    const leiturasAntes = vi.mocked(getStockCount).mock.calls.length;
    fireEvent.click(within(dialogo).getByRole("button", { name: "Atualizar o resumo" }));
    await waitFor(() => expect(vi.mocked(getStockCount).mock.calls.length).toBe(leiturasAntes + 1));
    await waitFor(() => expect(within(dialogo).getByRole("button", { name: "Confirmar encerramento" })).toBeEnabled());
  });
});

describe("abaixo de 640px", () => {
  it("a revisão vira cartões e a decisão abre no diálogo de tela cheia", async () => {
    emularCelular(true);
    abrir();
    await carregado();
    expect(screen.queryByRole("columnheader", { name: "Saldo de referência" })).toBeNull();
    const cartoes = screen.getByRole("list", { name: "Posições da revisão" });
    expect(within(cartoes).getAllByRole("listitem")).toHaveLength(5);
    const cartao = within(cartoes).getAllByRole("listitem")[1]!;
    expect(cartao).toHaveTextContent("Posição 2");
    expect(cartao).toHaveTextContent("Diferença-0,5 kg");

    fireEvent.click(within(cartao).getByRole("checkbox", { name: "Selecionar a posição 2" }));
    fireEvent.click(within(barra()).getByRole("button", { name: "Ajustar" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(dialogo.querySelector(".inv-dialogo-largo")).not.toBeNull();
  });
});

describe("contagem pendente na revisão", () => {
  it("posição sem contagem aparece no recorte próprio e o cabeçalho leva a contar", async () => {
    vi.mocked(getStockCount).mockResolvedValue(
      emRevisao({ positions: [DIVERGENTE, posicao({ id: "p-9", sequence: 9, origin: "ADDED", situation: "PENDING", entries: [] })] }),
    );
    abrir();
    await carregado();
    expect(screen.getByRole("button", { name: "Sem contagem · 1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contar pendentes" })).toHaveAttribute("href", "/estoque/inventario/inv-1/contagem");
  });
});
