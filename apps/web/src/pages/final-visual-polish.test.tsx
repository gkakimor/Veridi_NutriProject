import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { IndustrialResourceDetailDTO, SupplierItemDetailDTO } from "@veridi/shared";

/**
 * As três observações visuais que a auditoria deixou registradas, e a
 * variante da mesma família encontrada nas telas vizinhas.
 *
 * Nenhuma regra de negócio muda aqui: o que muda é o que a tela devolve para
 * quem está olhando.
 */

vi.mock("../lib/supplier-items-api", () => ({
  getSupplierItem: vi.fn(),
  updateSupplierItem: vi.fn(),
  setSupplierItemPreferred: vi.fn(),
  changeSupplierItemQualification: vi.fn(),
  createSupplierItemOffer: vi.fn(),
}));
vi.mock("../lib/units-api", () => ({ listUnits: () => Promise.resolve([]) }));
vi.mock("../lib/industrial-resources-api", () => ({
  getIndustrialResource: vi.fn(),
  updateIndustrialResource: vi.fn(),
  createIndustrialResourceRate: vi.fn(),
}));
vi.mock("../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));

import { getSupplierItem, updateSupplierItem } from "../lib/supplier-items-api";
import { getIndustrialResource, updateIndustrialResource } from "../lib/industrial-resources-api";
import { SupplierItemDetailModal } from "./supplier-items/SupplierItemDetailModal";
import { IndustrialResourceDetailPage } from "./industrial-resources/IndustrialResourceDetailPage";

const NOTA_DA_OFERTA = "LEGADO precos_fornecedores.csv. Auditoria VAL-LEG-01.";
const NOTA_COMERCIAL = "Preço LEGADO R$ 272/kg; pedido mínimo 1. Fonte: precos_fornecedores.csv.";

function relacao(overrides: Partial<SupplierItemDetailDTO> = {}): SupplierItemDetailDTO {
  return {
    id: "si-1",
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Cafeína/1,3,7-Trimethylxanthine",
    itemExternalCode: null,
    itemUnitCode: "kg",
    itemType: "RAW_MATERIAL",
    itemFamily: null,
    supplierId: "for-1",
    supplierCode: "FOR-000003",
    supplierName: "SWEETMIX",
    supplierActive: true,
    supplierItemCode: null,
    qualificationStatus: "APPROVED",
    preferred: true,
    active: true,
    commercialNotes: NOTA_COMERCIAL,
    currentOffer: null,
    latestLegacyOffer: null,
    offerCount: 1,
    createdAt: "2026-08-19T22:52:07.000Z",
    createdByName: "Admin (demo)",
    updatedAt: "2026-08-19T23:22:54.000Z",
    updatedByName: "Admin (demo)",
    offers: [
      {
        id: "of-1",
        supplierItemId: "si-1",
        unitPrice: "272",
        currencyCode: "BRL",
        priceUomCode: "kg",
        minimumOrderQuantity: "1",
        minimumOrderUomCode: "kg",
        effectiveAt: null,
        validUntil: null,
        source: "MANUAL",
        notes: NOTA_DA_OFERTA,
        createdAt: "2026-08-19T22:52:07.000Z",
        createdByName: "Admin (demo)",
        isCurrent: false,
      },
    ],
    qualificationHistory: [],
    ...overrides,
  };
}

async function abrirRelacao(dto: SupplierItemDetailDTO = relacao()) {
  vi.mocked(getSupplierItem).mockResolvedValue(dto);
  render(
    <MemoryRouter>
      <SupplierItemDetailModal supplierItemId="si-1" onClose={() => {}} />
    </MemoryRouter>,
  );
  await waitFor(() => expect(getSupplierItem).toHaveBeenCalled());
}

describe("Item × Fornecedor — observações legíveis", () => {
  it("a observação da oferta aparece na tabela — era gravada e não voltava para ninguém", async () => {
    await abrirRelacao();

    await screen.findByText("Ofertas / preços");
    expect(screen.getByText(NOTA_DA_OFERTA)).toBeTruthy();
  });

  it("o texto completo é lido, não cortado em reticências nem escondido em title", async () => {
    await abrirRelacao();

    const celula = await screen.findByText(NOTA_DA_OFERTA);
    // O conteúdo está no texto do elemento, não num atributo que só o mouse alcança.
    expect(celula.textContent).toBe(NOTA_DA_OFERTA);
    expect(celula.getAttribute("title")).toBeNull();
  });

  it("oferta sem observação não inventa conteúdo", async () => {
    await abrirRelacao(
      relacao({ offers: [{ ...relacao().offers[0]!, notes: null }] }),
    );

    await screen.findByText("Ofertas / preços");
    expect(screen.queryByText(NOTA_DA_OFERTA)).toBeNull();
  });

  it("observações comerciais continuam em campo multilinha, com o texto inteiro", async () => {
    await abrirRelacao();

    const campo = (await screen.findByLabelText("Observações comerciais")) as HTMLTextAreaElement;
    expect(campo.tagName).toBe("TEXTAREA");
    expect(campo.value).toBe(NOTA_COMERCIAL);
  });
});

describe("Inativar relação — peso e confirmação", () => {
  it("usa a variante destrutiva existente e fica separada das ações de rotina", async () => {
    await abrirRelacao();

    const inativar = (await screen.findByRole("button", {
      name: "Inativar relação",
    })) as HTMLButtonElement;
    expect(inativar.className).toContain("btn--danger");
    expect(inativar.className).toContain("btn--set-apart");

    // Nenhuma ação de rotina do painel parece mais forte que ela.
    const preferencial = screen.getByRole("button", { name: "Remover preferencial" });
    expect(preferencial.className).not.toContain("btn--accent");
    expect(preferencial.className).not.toContain("btn--danger");
  });

  it("pergunta antes, explica a consequência e não fala em apagar", async () => {
    await abrirRelacao();

    fireEvent.click(await screen.findByRole("button", { name: "Inativar relação" }));

    const dialogo = await screen.findByText("Inativar esta relação?");
    expect(dialogo).toBeTruthy();
    expect(screen.getByText(/sai do sourcing/)).toBeTruthy();
    expect(screen.getByText(/pode ser reativada depois/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Excluir|Remover permanentemente|Apagar/);
    // Não inativa sem confirmar.
    expect(updateSupplierItem).not.toHaveBeenCalled();
  });

  it("relação já inativa oferece reativar, e reativar não é destrutivo", async () => {
    await abrirRelacao(relacao({ active: false, preferred: false }));

    const reativar = (await screen.findByRole("button", {
      name: "Reativar relação",
    })) as HTMLButtonElement;
    expect(reativar.className).not.toContain("btn--danger");
  });
});

describe("Modal de trabalho — um único controle de fechar", () => {
  it("a composição oferece um controle textual de fechar, e o nome visível é o acessível", async () => {
    await abrirRelacao();

    await screen.findByText("Ofertas / preços");
    const fechar = screen
      .getAllByRole("button")
      .filter((botao) => /^\s*✕?\s*fechar\s*$/i.test(botao.textContent ?? ""));
    expect(fechar).toHaveLength(1);
    // aria-label trocava o nome acessível por outro texto: quem navega por
    // voz dizia "Fechar" e nada acontecia.
    expect(fechar[0]!.getAttribute("aria-label")).toBeNull();
    expect(screen.getByRole("button", { name: /Fechar/ })).toBeTruthy();
  });
});

function recurso(overrides: Partial<IndustrialResourceDetailDTO> = {}): IndustrialResourceDetailDTO {
  return {
    id: "rec-1",
    code: "REC-000001",
    name: "Encapsuladora automática",
    type: "EQUIPMENT",
    unitCode: "hora",
    powerKw: "3",
    notes: null,
    active: true,
    currentRate: null,
    rates: [],
    createdAt: "2026-08-19T00:00:00.000Z",
    createdByName: "Admin",
    updatedAt: "2026-08-19T00:00:00.000Z",
    updatedByName: "Admin",
    ...overrides,
  } as IndustrialResourceDetailDTO;
}

async function abrirRecurso(dto: IndustrialResourceDetailDTO = recurso()) {
  vi.mocked(getIndustrialResource).mockResolvedValue(dto);
  render(
    <MemoryRouter initialEntries={["/gestao/recursos-industriais/rec-1"]}>
      <Routes>
        <Route
          path="/gestao/recursos-industriais/:id"
          element={<IndustrialResourceDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(getIndustrialResource).toHaveBeenCalled());
}

describe("Inativar recurso — a mesma família, na tela vizinha", () => {
  it("inativar deixou de ser ação de rotina e passou a perguntar", async () => {
    await abrirRecurso();

    const inativar = (await screen.findByRole("button", {
      name: "Inativar recurso",
    })) as HTMLButtonElement;
    expect(inativar.className).toContain("btn--danger");

    fireEvent.click(inativar);
    await screen.findByText("Inativar este recurso?");
    // A consequência real: estruturas que usam o recurso não podem mais ser ativadas.
    expect(screen.getByText(/pendência bloqueante/)).toBeTruthy();
    expect(screen.getByText(/pode ser reativado depois/)).toBeTruthy();
    expect(updateIndustrialResource).not.toHaveBeenCalled();
  });

  it("recurso inativo oferece reativar sem tom destrutivo", async () => {
    await abrirRecurso(recurso({ active: false }));

    const reativar = (await screen.findByRole("button", {
      name: "Reativar recurso",
    })) as HTMLButtonElement;
    expect(reativar.className).not.toContain("btn--danger");
  });
});
