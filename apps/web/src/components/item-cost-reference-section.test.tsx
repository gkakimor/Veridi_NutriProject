import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ItemCostReferencesResponse } from "@veridi/shared";

/**
 * Custo de referência do Item — os três estados que a tela não pode
 * confundir e a regra que ela precisa dizer.
 *
 * "Não informado" nunca vira R$ 0,00; a referência existe mas pode não ser a
 * fonte usada (compra real vence); alterar cria vigência nova, e a anterior
 * aparece no histórico como "Histórica", nunca some.
 */

vi.mock("../lib/items-api", () => ({
  getItemCostReferences: vi.fn(),
  createItemCostReference: vi.fn(),
}));
vi.mock("../lib/units-api", () => ({
  listUnits: () =>
    Promise.resolve([
      { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
      { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
      { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    ]),
}));
vi.mock("../app/AuthProvider", () => ({ useAuth: vi.fn() }));

import { useAuth } from "../app/AuthProvider";
import { createItemCostReference, getItemCostReferences } from "../lib/items-api";
import { ItemCostReferenceSection } from "./ItemCostReferenceSection";

function resposta(overrides: Partial<ItemCostReferencesResponse> = {}): ItemCostReferencesResponse {
  return {
    itemId: "item-1",
    itemCode: "MP-000001",
    itemName: "Coenzima Q10",
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
    ...overrides,
  };
}

const referencia = {
  id: "ref-2",
  itemId: "item-1",
  unitCost: "1200",
  currencyCode: "BRL",
  uomCode: "kg",
  effectiveFrom: "2026-09-01T00:00:00.000Z",
  note: "Cotação verbal",
  createdAt: "2026-09-01T10:00:00.000Z",
  createdByName: "Ana",
  current: true,
};

beforeEach(() => {
  vi.mocked(getItemCostReferences).mockReset();
  vi.mocked(createItemCostReference).mockReset();
  vi.mocked(useAuth).mockReturnValue({
    user: { role: "ADMIN" },
  } as unknown as ReturnType<typeof useAuth>);
});

describe("ItemCostReferenceSection", () => {
  it("sem referência mostra 'Não informado' — nunca R$ 0,00 — e a fonte de hoje", async () => {
    vi.mocked(getItemCostReferences).mockResolvedValue(resposta());
    render(<ItemCostReferenceSection itemId="item-1" />);

    expect(await screen.findByText("Não informado")).toBeInTheDocument();
    expect(screen.getByText("Sem referência de custo")).toBeInTheDocument();
    expect(screen.queryByText(/R\$\s?0,00/)).not.toBeInTheDocument();
    expect(screen.getByText(/seleciona automaticamente a melhor fonte/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Definir referência" })).toBeInTheDocument();
  });

  it("referência existente que NÃO é a fonte usada: a compra real vence, e a tela diz isso", async () => {
    vi.mocked(getItemCostReferences).mockResolvedValue(
      resposta({
        current: referencia,
        history: [referencia],
        automatic: {
          unitCost: "1050.000000",
          unitCode: "kg",
          source: "WEIGHTED_AVG_30D",
          details: "Média ponderada de 2 recebimento(s) nos últimos 30 dias.",
          referenceDate: "2026-09-04T12:00:00.000Z",
        },
      }),
    );
    render(<ItemCostReferenceSection itemId="item-1" />);

    expect(await screen.findByText("R$ 1.200,00")).toBeInTheDocument();
    expect(screen.getByText("Compra real · média 30 dias")).toBeInTheDocument();
    expect(screen.getByText(/hoje não é usada/)).toBeInTheDocument();
    expect(screen.getByText("Cotação verbal")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alterar referência" })).toBeInTheDocument();
  });

  it("alterar cria vigência nova, com a anterior no histórico", async () => {
    const antiga = { ...referencia, id: "ref-1", unitCost: "1000", current: false, effectiveFrom: "2026-08-01T00:00:00.000Z" };
    vi.mocked(getItemCostReferences).mockResolvedValue(
      resposta({ current: referencia, history: [referencia, antiga] }),
    );
    vi.mocked(createItemCostReference).mockResolvedValue(
      resposta({
        current: { ...referencia, id: "ref-3", unitCost: "1300" },
        history: [{ ...referencia, id: "ref-3", unitCost: "1300" }, { ...referencia, current: false }, antiga],
      }),
    );
    render(<ItemCostReferenceSection itemId="item-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Alterar referência" }));
    fireEvent.change(document.getElementById("cost-reference-value")!, { target: { value: "1.300" } });
    fireEvent.change(document.getElementById("cost-reference-note")!, { target: { value: "Tabela nova" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar referência" }));

    await waitFor(() => expect(createItemCostReference).toHaveBeenCalled());
    const [, input] = vi.mocked(createItemCostReference).mock.calls[0]!;
    // Vírgula/ponto lidos como casa decimal; unidade padrão é a do item.
    expect(input).toMatchObject({ unitCost: "1.300", uomCode: "kg", note: "Tabela nova" });

    expect(await screen.findByText("R$ 1.300,00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Histórico \(3\)/ }));
    expect(screen.getByText("Vigente")).toBeInTheDocument();
    expect(screen.getAllByText("Histórica")).toHaveLength(2);
  });

  it("quem não negocia lê a referência, mas não a define", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { role: "PRODUCTION" },
    } as unknown as ReturnType<typeof useAuth>);
    vi.mocked(getItemCostReferences).mockResolvedValue(resposta({ current: referencia, history: [referencia] }));
    render(<ItemCostReferenceSection itemId="item-1" />);

    expect(await screen.findByText("R$ 1.200,00")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /referência$/ })).not.toBeInTheDocument();
  });
});
