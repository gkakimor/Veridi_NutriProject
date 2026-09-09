import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SupplierItemDetailDTO, SupplierItemOfferDTO } from "@veridi/shared";
import { SUPPLIER_OFFER_AMBIGUITY_MESSAGE, hojeComercial } from "@veridi/shared";

/**
 * COST-SOURCE-01 — a tela de Item × Fornecedor explica o custo.
 *
 * O cadastro sempre pôde alimentar o custo; o que faltava era a tela dizer
 * quando ele alimenta e, principalmente, quando não alimenta. Quem via cinco
 * preços cadastrados e um CMV sem custo não tinha como ligar as duas telas —
 * e a resposta ("nenhuma dessas ofertas tem vigência") já existia dentro do
 * motor, calada.
 *
 * O que estes casos protegem não é aparência: é a frase certa no lugar em
 * que a decisão é tomada.
 */

vi.mock("../../lib/supplier-items-api", () => ({
  getSupplierItem: vi.fn(),
  updateSupplierItem: vi.fn(),
  setSupplierItemPreferred: vi.fn(),
  changeSupplierItemQualification: vi.fn(),
  createSupplierItemOffer: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({
  listUnits: () =>
    Promise.resolve([
      { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    ]),
}));
vi.mock("../../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));

import {
  createSupplierItemOffer,
  getSupplierItem,
  setSupplierItemPreferred,
} from "../../lib/supplier-items-api";
import { SupplierItemDetailModal } from "./SupplierItemDetailModal";

function oferta(overrides: Partial<SupplierItemOfferDTO> = {}): SupplierItemOfferDTO {
  return {
    id: "of-1",
    supplierItemId: "si-1",
    unitPrice: "272",
    currencyCode: "BRL",
    priceUomCode: "kg",
    minimumOrderQuantity: null,
    minimumOrderUomCode: null,
    effectiveAt: "2026-09-01T12:00:00.000Z",
    validUntil: null,
    source: "MANUAL",
    notes: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    createdByName: "Admin (demo)",
    isCurrent: true,
    eligibility: "ELIGIBLE",
    ...overrides,
  };
}

function relacao(overrides: Partial<SupplierItemDetailDTO> = {}): SupplierItemDetailDTO {
  return {
    id: "si-1",
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Cafeína",
    itemExternalCode: null,
    itemUnitCode: "kg",
    itemType: "RAW_MATERIAL",
    itemFamily: null,
    supplierId: "for-1",
    supplierCode: "FOR-000001",
    supplierName: "PURIFARMA",
    supplierActive: true,
    supplierItemCode: null,
    qualificationStatus: "APPROVED",
    preferred: false,
    active: true,
    commercialNotes: null,
    currentOffer: null,
    latestLegacyOffer: null,
    offerCount: 1,
    costSourceAmbiguous: false,
    createdAt: "2026-09-01T12:00:00.000Z",
    createdByName: "Admin (demo)",
    updatedAt: "2026-09-01T12:00:00.000Z",
    updatedByName: "Admin (demo)",
    offers: [oferta()],
    qualificationHistory: [],
    costSourceToday: {
      source: "SUPPLIER_OFFER_SINGLE_APPROVED",
      unitCost: "272.00000000",
      unitCode: "kg",
      details: "Oferta válida de PURIFARMA (R$ 272/kg), único fornecedor homologado.",
      referenceDate: "2026-09-09T12:00:00.000Z",
    },
    ...overrides,
  };
}

async function abrir(dto: SupplierItemDetailDTO = relacao()) {
  vi.mocked(getSupplierItem).mockResolvedValue(dto);
  render(
    <MemoryRouter>
      <SupplierItemDetailModal supplierItemId="si-1" onClose={() => {}} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(getSupplierItem).toHaveBeenCalled());
  await screen.findByText("Ofertas / preços");
}

describe("Item × Fornecedor — a oferta explica o próprio papel no custo", () => {
  it("oferta importada sem vigência aparece como histórico e diz que não entra no custo", async () => {
    await abrir(
      relacao({
        offers: [oferta({ effectiveAt: null, source: "LEGACY_IMPORT", isCurrent: false, eligibility: "NO_VALIDITY" })],
        costSourceToday: {
          source: "NO_COST",
          unitCost: null,
          unitCode: "kg",
          details: null,
          referenceDate: "2026-09-09T12:00:00.000Z",
        },
      }),
    );

    expect(screen.getByText("Sem vigência")).toBeTruthy();
    // Não é "inválida": é histórico, e a frase diz o que fazer.
    expect(screen.getByText(/Importada sem vigência/)).toBeTruthy();
    expect(screen.getByText(/Registre uma oferta nova/)).toBeTruthy();
  });

  it("moeda estrangeira é recusada com o motivo, e nunca convertida", async () => {
    await abrir(
      relacao({
        offers: [oferta({ currencyCode: "USD", isCurrent: false, eligibility: "FOREIGN_CURRENCY" })],
      }),
    );

    expect(screen.getByText("Moeda estrangeira")).toBeTruthy();
    expect(screen.getByText(/não converte moeda/)).toBeTruthy();
  });

  it("vigente, futura e vencida são três estados diferentes na mesma tabela", async () => {
    await abrir(
      relacao({
        offers: [
          oferta({ id: "a", unitPrice: "10", eligibility: "ELIGIBLE" }),
          oferta({ id: "b", unitPrice: "20", isCurrent: false, eligibility: "NOT_YET_EFFECTIVE" }),
          oferta({ id: "c", unitPrice: "30", isCurrent: false, eligibility: "EXPIRED" }),
        ],
      }),
    );

    expect(screen.getByText("Serve de referência")).toBeTruthy();
    expect(screen.getByText("Ainda não vigente")).toBeTruthy();
    expect(screen.getByText("Vencida")).toBeTruthy();
  });

  it("a fonte de custo do item aparece, e uma compra real vencendo a oferta é dita em voz alta", async () => {
    await abrir(
      relacao({
        costSourceToday: {
          source: "WEIGHTED_AVG_30D",
          unitCost: "1050.00000000",
          unitCode: "kg",
          details: "Média ponderada de 1 recebimento(s) nos últimos 30 dias.",
          referenceDate: "2026-09-09T12:00:00.000Z",
        },
      }),
    );

    // A oferta continua "serve de referência" — e o item continua custando
    // pela compra real. As duas frases convivem porque são perguntas
    // diferentes, e confundi-las é a leitura errada mais provável da tela.
    expect(screen.getByText("Serve de referência")).toBeTruthy();
    expect(screen.getByText("Compra real · média 30 dias")).toBeTruthy();
    expect(screen.getByText(/Média ponderada de 1 recebimento/)).toBeTruthy();
  });
});

describe("Item × Fornecedor — preferencial e ambiguidade", () => {
  it("vários fornecedores sem preferencial: a tela diz o que fazer, em português", async () => {
    await abrir(
      relacao({
        costSourceAmbiguous: true,
        costSourceToday: {
          source: "AMBIGUOUS_SUPPLIER_REFERENCE",
          unitCost: null,
          unitCode: "kg",
          details: "Existem várias ofertas válidas de fornecedor e nenhuma está definida como preferencial.",
          referenceDate: "2026-09-09T12:00:00.000Z",
        },
      }),
    );

    expect(screen.getByText(SUPPLIER_OFFER_AMBIGUITY_MESSAGE)).toBeTruthy();
    // O enum técnico nunca aparece.
    expect(screen.queryByText(/AMBIGUOUS_SUPPLIER_REFERENCE/)).toBeNull();
  });

  it("marcar como preferencial é uma ação visível, e o estado muda na tela", async () => {
    const antes = relacao({ costSourceAmbiguous: true });
    const depois = relacao({ preferred: true, costSourceAmbiguous: false });
    vi.mocked(setSupplierItemPreferred).mockResolvedValue(depois);
    await abrir(antes);

    const botao = screen.getByRole("button", { name: "Marcar como preferencial" });
    vi.mocked(getSupplierItem).mockResolvedValue(depois);
    fireEvent.click(botao);

    await waitFor(() => expect(setSupplierItemPreferred).toHaveBeenCalledWith("si-1", true));
    await screen.findByRole("button", { name: "Remover preferencial" });
    expect(screen.getByText("Fornecedor preferencial")).toBeTruthy();
    expect(screen.queryByText(SUPPLIER_OFFER_AMBIGUITY_MESSAGE)).toBeNull();
  });
});

describe("Item × Fornecedor — oferta nova exige vigência", () => {
  it('"Válida a partir de" nasce sugerida com hoje, e o registro a envia sempre', async () => {
    vi.mocked(createSupplierItemOffer).mockResolvedValue(relacao());
    await abrir();

    const vigencia = screen.getByLabelText("Válida a partir de *") as HTMLInputElement;
    // Sugerida, não imposta: o campo está preenchido e continua editável.
    expect(vigencia.value).toBe(hojeComercial());
    expect(vigencia.disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("Preço"), { target: { value: "300" } });
    fireEvent.change(vigencia, { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar preço" }));

    await waitFor(() => expect(createSupplierItemOffer).toHaveBeenCalled());
    const payload = vi.mocked(createSupplierItemOffer).mock.calls[0]![1];
    expect(payload.effectiveAt).toBeTruthy();
    // A data escolhida, não o instante do clique.
    expect(new Date(payload.effectiveAt).toISOString().slice(0, 10)).toBe("2026-09-01");
  });

  it("sem vigência o registro não acontece — a tela para antes do servidor recusar", async () => {
    await abrir();

    fireEvent.change(screen.getByLabelText("Preço"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("Válida a partir de *"), { target: { value: "" } });

    const registrar = screen.getByRole("button", { name: "Registrar preço" }) as HTMLButtonElement;
    expect(registrar.disabled).toBe(true);
  });
});
