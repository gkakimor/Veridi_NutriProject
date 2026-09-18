import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  InternalConsumptionAvailabilityDTO,
  InternalConsumptionDTO,
  ItemDTO,
  UserRole,
} from "@veridi/shared";

/**
 * Estoque → Uso e consumo (INTERNAL-CONSUMPTION-01, Fatia 2).
 *
 * O que a tela precisa garantir:
 *
 * - o seletor pede ao SERVIDOR só item de uso e consumo. Filtrar no navegador
 *   ofereceria matéria-prima para a API recusar depois;
 * - o saldo mostrado é o que o servidor confere ao gravar;
 * - depois de confirmar, a pessoa lê quantidade, custo unitário, custo total e
 *   origem do custo — e, sem custo, a FRASE "Custo não disponível", nunca
 *   R$ 0,00. Zero é custo real zero;
 * - erro de saldo aparece como recusa, sem nada gravado;
 * - quem não registra vê o histórico e não vê formulário.
 */

let papel: UserRole = "PURCHASING";

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: papel } }),
  useOptionalAuth: () => ({ user: { id: "u-1", role: papel } }),
}));
vi.mock("../../lib/items-api", () => ({ listItems: vi.fn() }));
vi.mock("../../lib/internal-consumption-api", () => ({
  listInternalConsumptions: vi.fn(),
  getInternalConsumptionAvailability: vi.fn(),
  createInternalConsumption: vi.fn(),
}));

import { listItems } from "../../lib/items-api";
import {
  createInternalConsumption,
  getInternalConsumptionAvailability,
  listInternalConsumptions,
} from "../../lib/internal-consumption-api";
import { InternalConsumptionPage } from "./InternalConsumptionPage";

const LUVA = {
  id: "uc-1",
  code: "UC-000001",
  name: "Luva de procedimento",
  type: "INTERNAL_CONSUMABLE",
  unitCode: "un",
  controlsLot: false,
  active: true,
} as unknown as ItemDTO;

const DETERGENTE = {
  id: "uc-2",
  code: "UC-000002",
  name: "Detergente neutro",
  type: "INTERNAL_CONSUMABLE",
  unitCode: "L",
  controlsLot: true,
  active: true,
} as unknown as ItemDTO;

function saldo(sobre: Partial<InternalConsumptionAvailabilityDTO> = {}): InternalConsumptionAvailabilityDTO {
  return {
    itemId: LUVA.id,
    itemCode: LUVA.code,
    itemName: LUVA.name,
    unitCode: "un",
    controlsLot: false,
    itemActive: true,
    onHand: "40",
    available: "40",
    lots: [],
    ...sobre,
  };
}

function consumo(sobre: Partial<InternalConsumptionDTO> = {}): InternalConsumptionDTO {
  return {
    id: "ci-1",
    code: "CI-000001",
    itemId: LUVA.id,
    itemCode: LUVA.code,
    itemName: LUVA.name,
    itemType: "INTERNAL_CONSUMABLE",
    lotId: null,
    lotCode: null,
    quantity: "10",
    uomCode: "un",
    occurredAt: "2026-09-17T18:00:00.000Z",
    purpose: "Escritório",
    notes: null,
    unitCost: "1.25000000",
    totalCost: "12.5000",
    costSource: "ESTIMATED_30D",
    costDetails: "Média ponderada de 2 recebimento(s) nos últimos 30 dias.",
    inventoryMovementId: "mov-1",
    registeredByUserId: "u-1",
    registeredByName: "Ana Compras",
    createdAt: "2026-09-17T18:00:00.000Z",
    reversedQuantity: "0",
    reversibleQuantity: "10",
    reversedTotalCost: "0",
    netTotalCost: "12.5000",
    reversalStatus: "NOT_REVERSED",
    reversalCount: 0,
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

async function escolher(item: ItemDTO) {
  const campo = document.getElementById("consumo-item") as HTMLInputElement;
  fireEvent.focus(campo);
  fireEvent.mouseDown((await screen.findAllByRole("option", { name: new RegExp(item.code) }))[0]!);
}

async function preencherQuantidade(valor: string) {
  const campo = await waitFor(() => {
    const encontrado = document.getElementById("consumo-quantidade") as HTMLInputElement;
    expect(encontrado).toBeEnabled();
    return encontrado;
  });
  fireEvent.change(campo, { target: { value: valor } });
}

beforeEach(() => {
  vi.clearAllMocks();
  papel = "PURCHASING";
  vi.mocked(listItems).mockResolvedValue({ items: [LUVA, DETERGENTE], page: 1, pageSize: 50, total: 2 });
  vi.mocked(listInternalConsumptions).mockResolvedValue({
    consumptions: [],
    page: 1,
    pageSize: 20,
    total: 0,
  });
  vi.mocked(getInternalConsumptionAvailability).mockResolvedValue(saldo());
});

describe("Uso e consumo — o escopo do seletor", () => {
  it("pede ao servidor somente item de uso e consumo", async () => {
    abrir();

    await waitFor(() => expect(listItems).toHaveBeenCalled());
    for (const chamada of vi.mocked(listItems).mock.calls) {
      expect(chamada[0]).toMatchObject({ type: "INTERNAL_CONSUMABLE" });
    }
  });

  it("a busca digitada mantém o recorte do tipo", async () => {
    abrir();
    const campo = document.getElementById("consumo-item") as HTMLInputElement;
    fireEvent.focus(campo);
    fireEvent.change(campo, { target: { value: "deterg" } });

    await waitFor(() =>
      expect(listItems).toHaveBeenCalledWith(
        expect.objectContaining({ type: "INTERNAL_CONSUMABLE", search: "deterg" }),
      ),
    );
  });
});

describe("Uso e consumo — registrar", () => {
  it("mostra o disponível do item e grava quantidade, data e destino", async () => {
    vi.mocked(createInternalConsumption).mockResolvedValue(consumo());
    abrir();
    await escolher(LUVA);

    expect(await screen.findByText("40 un")).toBeInTheDocument();

    await preencherQuantidade("10");
    fireEvent.change(document.getElementById("consumo-data") as HTMLInputElement, {
      target: { value: "2026-09-16" },
    });
    fireEvent.change(document.getElementById("consumo-destino") as HTMLInputElement, {
      target: { value: "Escritório" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar consumo" }));

    await waitFor(() =>
      expect(createInternalConsumption).toHaveBeenCalledWith({
        itemId: "uc-1",
        quantity: "10",
        occurredOn: "2026-09-16",
        purpose: "Escritório",
      }),
    );
  });

  it("item com lote exige o lote, e o disponível passa a ser o do lote", async () => {
    vi.mocked(getInternalConsumptionAvailability).mockResolvedValue(
      saldo({
        itemId: DETERGENTE.id,
        itemCode: DETERGENTE.code,
        itemName: DETERGENTE.name,
        unitCode: "L",
        controlsLot: true,
        onHand: "30",
        available: "30",
        lots: [
          { lotId: "lote-1", lotCode: "LT-000118", expiryDate: "2027-03-31T00:00:00.000Z", available: "18" },
          { lotId: "lote-2", lotCode: "LT-000140", expiryDate: null, available: "12" },
        ],
      }),
    );
    vi.mocked(createInternalConsumption).mockResolvedValue(consumo({ lotId: "lote-1", lotCode: "LT-000118" }));
    abrir();
    await escolher(DETERGENTE);

    const lotes = await screen.findByRole("group", { name: "Lotes disponíveis" });
    expect(within(lotes).getByRole("radio", { name: /LT-000118/ }).closest("label")).toHaveTextContent(
      "LT-000118 · validade 31/03/2027 · disponível 18 L",
    );

    await preencherQuantidade("5");
    // Sem lote escolhido não há o que confirmar: a baixa precisa dizer de qual.
    expect(screen.getByRole("button", { name: "Confirmar consumo" })).toBeDisabled();

    fireEvent.click(within(lotes).getByRole("radio", { name: /LT-000118/ }));
    expect(screen.getByText("18 L")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar consumo" }));

    await waitFor(() =>
      expect(createInternalConsumption).toHaveBeenCalledWith(
        expect.objectContaining({ itemId: "uc-2", lotId: "lote-1", quantity: "5" }),
      ),
    );
  });

  it("saldo insuficiente aparece como recusa da operação", async () => {
    vi.mocked(createInternalConsumption).mockRejectedValue(
      new Error("Quantidade excede o saldo disponível (40): UC-000001"),
    );
    abrir();
    await escolher(LUVA);
    await preencherQuantidade("90");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar consumo" }));

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Quantidade excede o saldo disponível (40): UC-000001");
    expect(screen.queryByText(/registrado:/)).toBeNull();
  });
});

describe("Uso e consumo — o custo do que saiu", () => {
  it("com custo, mostra unitário, total e a origem", async () => {
    vi.mocked(createInternalConsumption).mockResolvedValue(consumo());
    abrir();
    await escolher(LUVA);
    await preencherQuantidade("10");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar consumo" }));

    const painel = await screen.findByRole("status");
    expect(painel).toHaveTextContent("CI-000001 registrado: 10 un de UC-000001 — Luva de procedimento.");
    expect(painel).toHaveTextContent("Custo unitário R$ 1,25");
    expect(painel).toHaveTextContent("custo total R$ 12,50");
    expect(painel).toHaveTextContent("origem Estimado 30 dias");
  });

  it("sem custo, mostra a frase — nunca R$ 0,00", async () => {
    vi.mocked(createInternalConsumption).mockResolvedValue(
      consumo({ unitCost: null, totalCost: null, costSource: "NO_COST", costDetails: null }),
    );
    abrir();
    await escolher(LUVA);
    await preencherQuantidade("10");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar consumo" }));

    const painel = await screen.findByRole("status");
    expect(painel).toHaveTextContent("Custo não disponível.");
    expect(painel).not.toHaveTextContent("R$ 0,00");
  });

  it("o painel do consumo sobrevive à releitura do saldo", async () => {
    vi.mocked(createInternalConsumption).mockResolvedValue(consumo());
    abrir();
    await escolher(LUVA);
    await preencherQuantidade("10");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar consumo" }));

    await screen.findByRole("status");
    // Confirmar relê o saldo (2ª chamada); o resultado não pode sumir com ela.
    await waitFor(() => expect(getInternalConsumptionAvailability).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent("CI-000001 registrado");
  });
});

describe("Uso e consumo — histórico e permissões", () => {
  it("o histórico traz data, item, quantidade, destino, custo e usuário", async () => {
    vi.mocked(listInternalConsumptions).mockResolvedValue({
      consumptions: [consumo(), consumo({ id: "ci-2", code: "CI-000002", unitCost: null, totalCost: null, costSource: "NO_COST", purpose: null })],
      page: 1,
      pageSize: 20,
      total: 2,
    });
    abrir();

    const comCusto = (await screen.findByText("CI-000001")).closest("tr")!;
    expect(comCusto).toHaveTextContent("Luva de procedimento");
    expect(comCusto).toHaveTextContent("10 un");
    expect(comCusto).toHaveTextContent("Escritório");
    expect(comCusto).toHaveTextContent("R$ 1,25");
    expect(comCusto).toHaveTextContent("Estimado 30 dias");
    expect(comCusto).toHaveTextContent("Ana Compras");

    // A ausência de custo é declarada na coluna, e não um R$ 0,00 silencioso.
    const semCusto = screen.getByText("CI-000002").closest("tr")!;
    expect(semCusto).toHaveTextContent("Não disponível");
    expect(semCusto).not.toHaveTextContent("R$ 0,00");
  });

  it("COMMERCIAL lê o histórico e não vê o formulário", async () => {
    papel = "COMMERCIAL";
    vi.mocked(listInternalConsumptions).mockResolvedValue({
      consumptions: [consumo()],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    abrir();

    expect(
      await screen.findByText(/Quem registra: Administrador, Compras, Produção ou Qualidade\./),
    ).toBeInTheDocument();
    expect(document.getElementById("consumo-item")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar consumo" })).toBeNull();
    expect(screen.getByText("CI-000001")).toBeInTheDocument();
  });

  it("VIEWER também só consulta", async () => {
    papel = "VIEWER";
    abrir();

    expect(await screen.findByText(/Quem registra:/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar consumo" })).toBeNull();
  });
});
