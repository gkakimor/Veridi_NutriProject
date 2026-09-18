import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  InternalConsumptionDetailDTO,
  InternalConsumptionDTO,
  InternalConsumptionReversalDTO,
  UserRole,
} from "@veridi/shared";

/**
 * Estoque → Uso e consumo: o ESTORNO (INTERNAL-CONSUMPTION-REVERSAL-01).
 *
 * O que a tela precisa garantir:
 *
 * - só Administrador e Qualidade veem "Estornar", e só em consumo com saldo
 *   estornável — o servidor recusa o resto, e a tela não oferece o que ele
 *   recusaria;
 * - o diálogo lê o consumo na hora e mostra o que a pessoa precisa para
 *   decidir: item, lote, data, destino, original, já estornado, saldo, custo
 *   e fonte, os estornos anteriores e os avisos (lote bloqueado ou vencido,
 *   item inativo, ajuste manual posterior);
 * - a quantidade começa no saldo estornável; parcial é permitido; motivo é
 *   obrigatório; o "já estornado" lido vai junto, para o servidor recusar a
 *   aba velha;
 * - a recusa do servidor aparece INTEIRA — é nela que está o código do
 *   inventário que a causou.
 */

let papel: UserRole = "QUALITY";

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: papel } }),
  useOptionalAuth: () => ({ user: { id: "u-1", role: papel } }),
}));
vi.mock("../../lib/items-api", () => ({ listItems: vi.fn() }));
vi.mock("../../lib/internal-consumption-api", () => ({
  listInternalConsumptions: vi.fn(),
  getInternalConsumptionAvailability: vi.fn(),
  createInternalConsumption: vi.fn(),
  getInternalConsumption: vi.fn(),
  createInternalConsumptionReversal: vi.fn(),
}));

import { listItems } from "../../lib/items-api";
import {
  createInternalConsumptionReversal,
  getInternalConsumption,
  listInternalConsumptions,
} from "../../lib/internal-consumption-api";
import { InternalConsumptionPage } from "./InternalConsumptionPage";

function consumo(sobre: Partial<InternalConsumptionDTO> = {}): InternalConsumptionDTO {
  return {
    id: "ci-123",
    code: "CI-000123",
    itemId: "uc-4",
    itemCode: "UC-000004",
    itemName: "Luva nitrílica M",
    itemType: "INTERNAL_CONSUMABLE",
    lotId: null,
    lotCode: null,
    quantity: "10",
    uomCode: "un",
    occurredAt: "2026-09-15T15:00:00.000Z",
    purpose: "Limpeza",
    notes: null,
    unitCost: "1.25000000",
    totalCost: "12.5000",
    costSource: "ESTIMATED_30D",
    costDetails: "Média ponderada de 2 recebimento(s) nos últimos 30 dias.",
    inventoryMovementId: "mov-1",
    registeredByUserId: "u-9",
    registeredByName: "Ana Compras",
    createdAt: "2026-09-15T15:00:00.000Z",
    reversedQuantity: "2",
    reversibleQuantity: "8",
    reversedTotalCost: "2.5",
    netTotalCost: "10",
    reversalStatus: "PARTIALLY_REVERSED",
    reversalCount: 1,
    ...sobre,
  };
}

function estorno(sobre: Partial<InternalConsumptionReversalDTO> = {}): InternalConsumptionReversalDTO {
  return {
    id: "eci-1",
    code: "ECI-000001",
    originalConsumptionId: "ci-123",
    originalConsumptionCode: "CI-000123",
    quantity: "2",
    uomCode: "un",
    reason: "quantidade digitada errada",
    unitCost: "1.25000000",
    totalCost: "2.5000",
    costSource: "ESTIMATED_30D",
    costDetails: "Média ponderada de 2 recebimento(s) nos últimos 30 dias.",
    inventoryMovementId: "mov-2",
    registeredByUserId: "u-7",
    registeredByName: "Maria Qualidade",
    createdAt: "2026-09-16T17:02:00.000Z",
    ...sobre,
  };
}

function detalhe(sobre: Partial<InternalConsumptionDetailDTO> = {}): InternalConsumptionDetailDTO {
  return {
    ...consumo(),
    reversals: [estorno()],
    itemActive: true,
    lotStatus: null,
    lotExpired: false,
    laterManualAdjustments: [],
    laterManualAdjustmentCount: 0,
    ...sobre,
  };
}

function abrir() {
  return render(
    <MemoryRouter initialEntries={["/estoque/uso-e-consumo"]}>
      <InternalConsumptionPage />
    </MemoryRouter>,
  );
}

async function abrirDialogo(): Promise<HTMLElement> {
  const linha = (await screen.findByText("CI-000123")).closest("tr")!;
  fireEvent.click(within(linha).getByRole("button", { name: "Estornar" }));
  const dialogo = await screen.findByRole("alertdialog", { name: "Estornar CI-000123" });
  await within(dialogo).findByText("Luva nitrílica M", { exact: false });
  return dialogo;
}

function campoQuantidade(): HTMLInputElement {
  return document.getElementById("estorno-quantidade") as HTMLInputElement;
}

function campoMotivo(): HTMLTextAreaElement {
  return document.getElementById("estorno-motivo") as HTMLTextAreaElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  papel = "QUALITY";
  vi.mocked(listItems).mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0 });
  vi.mocked(listInternalConsumptions).mockResolvedValue({
    consumptions: [
      consumo(),
      consumo({
        id: "ci-124",
        code: "CI-000124",
        reversedQuantity: "5",
        reversibleQuantity: "0",
        reversalStatus: "REVERSED",
        quantity: "5",
      }),
      consumo({
        id: "ci-125",
        code: "CI-000125",
        reversedQuantity: "0",
        reversibleQuantity: "10",
        reversedTotalCost: "0",
        netTotalCost: "12.5",
        reversalStatus: "NOT_REVERSED",
        reversalCount: 0,
      }),
    ],
    page: 1,
    pageSize: 20,
    total: 3,
  });
  vi.mocked(getInternalConsumption).mockResolvedValue(detalhe());
});

describe("Estorno — quem vê o botão, e em qual linha", () => {
  it.each(["ADMIN", "QUALITY"] as const)("%s vê Estornar só nas linhas com saldo estornável", async (perfil) => {
    papel = perfil;
    abrir();

    const parcial = (await screen.findByText("CI-000123")).closest("tr")!;
    const inteiro = screen.getByText("CI-000124").closest("tr")!;
    const intacto = screen.getByText("CI-000125").closest("tr")!;
    expect(within(parcial).getByRole("button", { name: "Estornar" })).toBeInTheDocument();
    expect(within(intacto).getByRole("button", { name: "Estornar" })).toBeInTheDocument();
    // Estornado por inteiro: saldo zero, nada a estornar.
    expect(within(inteiro).queryByRole("button", { name: "Estornar" })).toBeNull();
  });

  it.each(["PURCHASING", "PRODUCTION", "COMMERCIAL", "VIEWER"] as const)(
    "%s não vê Estornar, e a tela diz quem estorna",
    async (perfil) => {
      papel = perfil;
      abrir();

      await screen.findByText("CI-000123");
      expect(screen.queryByRole("button", { name: "Estornar" })).toBeNull();
      expect(
        screen.getByText("Consumo lançado errado é estornado por Administrador ou Qualidade, com motivo."),
      ).toBeInTheDocument();
    },
  );

  it("colunas Estornado e Situação no histórico", async () => {
    abrir();

    const parcial = (await screen.findByText("CI-000123")).closest("tr")!;
    expect(parcial).toHaveTextContent("2 un");
    expect(parcial).toHaveTextContent("Estornado parcialmente");
    expect(screen.getByText("CI-000124").closest("tr")).toHaveTextContent("Estornado");
    const intacto = screen.getByText("CI-000125").closest("tr")!;
    expect(within(intacto).getAllByRole("cell").map((celula) => celula.textContent)).toContain("—");
  });
});

describe("Estorno — o diálogo", () => {
  it("mostra item, lote, data, destino, original, já estornado, saldo, custo, fonte e os estornos anteriores", async () => {
    abrir();
    const dialogo = await abrirDialogo();

    expect(getInternalConsumption).toHaveBeenCalledWith("ci-123");
    const texto = (dialogo.textContent ?? "").replace(/\s+/g, " ");
    for (const trecho of [
      "UC-000004 — Luva nitrílica M",
      "Limpeza",
      "Quantidade original10 un",
      "Já estornado2 un",
      "Saldo estornável8 un",
      "R$ 1,25",
      "Estimado 30 dias",
      "O estorno usa o custo deste consumo, nunca o de hoje",
    ]) {
      expect(texto, trecho).toContain(trecho);
    }
    const anteriores = within(dialogo).getByRole("heading", { name: "Estornos anteriores" }).closest("section")!;
    expect(anteriores).toHaveTextContent("ECI-000001");
    expect(anteriores).toHaveTextContent("2 un · Maria Qualidade · “quantidade digitada errada”");
  });

  it("a quantidade começa no saldo estornável; motivo é obrigatório; o total vai com o já estornado lido", async () => {
    vi.mocked(createInternalConsumptionReversal).mockResolvedValue(estorno({ id: "eci-2", code: "ECI-000002", quantity: "8", totalCost: "10.0000" }));
    abrir();
    const dialogo = await abrirDialogo();
    const confirmar = within(dialogo).getByRole("button", { name: "Confirmar estorno" });

    expect(campoQuantidade().value).toBe("8");
    expect(confirmar).toBeDisabled();
    fireEvent.change(campoMotivo(), { target: { value: "  ab  " } });
    expect(confirmar).toBeDisabled();
    fireEvent.change(campoMotivo(), { target: { value: "  Lançado no item errado  " } });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);

    await waitFor(() =>
      expect(createInternalConsumptionReversal).toHaveBeenCalledWith("ci-123", {
        quantity: "8",
        reason: "Lançado no item errado",
        expectedReversedQuantity: "2",
      }),
    );
    // Confirmado: o diálogo fecha, o aviso diz o que voltou, e a lista é relida.
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent(
      "ECI-000002 registrado: 8 un devolvidos ao estoque (estorno de CI-000123).",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Custo estornado R$ 10,00, copiado do consumo original.");
    await waitFor(() => expect(listInternalConsumptions).toHaveBeenCalledTimes(2));
  });

  it("estorno parcial: a quantidade digitada em português vai canônica", async () => {
    vi.mocked(createInternalConsumptionReversal).mockResolvedValue(estorno({ id: "eci-3", code: "ECI-000003", quantity: "2.5" }));
    abrir();
    const dialogo = await abrirDialogo();

    fireEvent.change(campoQuantidade(), { target: { value: "2,5" } });
    fireEvent.change(campoMotivo(), { target: { value: "Sobrou no armário" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar estorno" }));

    await waitFor(() =>
      expect(createInternalConsumptionReversal).toHaveBeenCalledWith("ci-123", {
        quantity: "2.5",
        reason: "Sobrou no armário",
        expectedReversedQuantity: "2",
      }),
    );
  });

  it("a recusa do servidor aparece inteira, e o diálogo continua aberto", async () => {
    const recusa =
      "A posição de CI-000123 foi contada no inventário INV-000031 depois do registro do consumo: a contagem já acertou o saldo, e estornar agora corrigiria duas vezes.";
    vi.mocked(createInternalConsumptionReversal).mockRejectedValue(new Error(recusa));
    abrir();
    const dialogo = await abrirDialogo();

    fireEvent.change(campoMotivo(), { target: { value: "Erro de digitação" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar estorno" }));

    expect(await within(dialogo).findByRole("alert")).toHaveTextContent(recusa);
    expect(screen.getByRole("alertdialog", { name: "Estornar CI-000123" })).toBeInTheDocument();
  });

  it("consumo já estornado por inteiro quando o diálogo abre: não há o que confirmar", async () => {
    vi.mocked(getInternalConsumption).mockResolvedValue(
      detalhe({ reversedQuantity: "10", reversibleQuantity: "0", reversalStatus: "REVERSED" }),
    );
    abrir();
    const dialogo = await abrirDialogo();

    expect(dialogo).toHaveTextContent("Não há quantidade a estornar");
    expect(within(dialogo).queryByRole("button", { name: "Confirmar estorno" })).toBeNull();
    expect(campoQuantidade()).toBeNull();
  });
});

describe("Estorno — os avisos, que não bloqueiam", () => {
  it("lote bloqueado: volta ao lote e continua indisponível", async () => {
    vi.mocked(getInternalConsumption).mockResolvedValue(
      detalhe({ lotId: "lote-1", lotCode: "LT-000118", lotStatus: "BLOCKED" }),
    );
    abrir();
    const dialogo = await abrirDialogo();

    expect(within(dialogo).getByRole("note")).toHaveTextContent(
      "O lote LT-000118 está bloqueado: a quantidade volta a ele e continua indisponível.",
    );
    expect(within(dialogo).getByRole("button", { name: "Confirmar estorno" })).toBeInTheDocument();
  });

  it("lote vencido e item inativo", async () => {
    vi.mocked(getInternalConsumption).mockResolvedValue(
      detalhe({ lotId: "lote-1", lotCode: "LT-000118", lotStatus: "AVAILABLE", lotExpired: true, itemActive: false }),
    );
    abrir();
    const dialogo = await abrirDialogo();

    const avisos = within(dialogo).getByRole("note");
    expect(avisos).toHaveTextContent("O lote LT-000118 está vencido: a quantidade volta a ele e continua indisponível.");
    expect(avisos).toHaveTextContent(
      "Item inativo: o estorno devolve a quantidade mesmo assim — é a anulação de uma saída, não uma entrada nova.",
    );
  });

  it("ajuste manual de entrada depois do consumo: listado, sem bloquear", async () => {
    vi.mocked(getInternalConsumption).mockResolvedValue(
      detalhe({
        laterManualAdjustmentCount: 1,
        laterManualAdjustments: [
          {
            id: "aj-1",
            quantity: "2",
            occurredAt: "2026-09-16T12:00:00.000Z",
            reason: "Achado no armário",
            createdBy: "Carla Produção",
          },
        ],
      }),
    );
    abrir();
    const dialogo = await abrirDialogo();

    const avisos = within(dialogo).getByRole("note");
    expect(avisos).toHaveTextContent("Depois deste consumo houve 1 ajuste manual de entrada nesta posição.");
    expect(avisos).toHaveTextContent("2 un · Carla Produção · “Achado no armário”");
    expect(within(dialogo).getByRole("button", { name: "Confirmar estorno" })).toBeInTheDocument();
  });

  it("sem nada a avisar, nenhum aviso", async () => {
    abrir();
    const dialogo = await abrirDialogo();
    expect(within(dialogo).queryByRole("note")).toBeNull();
  });
});
