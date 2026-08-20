import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FormulationVersionDTO } from "@veridi/shared";

/**
 * Doses por embalagem no editor de formulação.
 *
 * O campo existia na API e não existia na tela: só aparecia quando o MODO
 * da versão era "Por dose". A formulação auditada tinha modo "Base fixa"
 * com quatro componentes "Por dose" — o campo ficava escondido, as doses
 * ficavam nulas, e todo o material saía com quantidade zero sem que nada
 * na interface dissesse o que faltava.
 *
 * Quem manda é a base do COMPONENTE.
 */

vi.mock("../../lib/formulations-api", () => ({
  getFormulationVersion: vi.fn(),
  updateFormulationVersion: vi.fn(),
  activateFormulationVersion: vi.fn(),
  createNewFormulationVersion: vi.fn(),
  getFormulationActivationImpact: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../../lib/items-api", () => ({ listItems: () => Promise.resolve({ items: [] }) }));
vi.mock("../../lib/units-api", () => ({ listUnits: () => Promise.resolve([]) }));
vi.mock("../../lib/costs-api", () => ({
  getFormulationCostEstimate: () => Promise.resolve(null),
}));
vi.mock("../../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));

import { getFormulationVersion } from "../../lib/formulations-api";
import { FormulationVersionPage } from "./FormulationVersionPage";

function componente(basis: FormulationVersionDTO["components"][number]["basis"]) {
  return {
    id: "cmp-1",
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Cafeína",
    itemType: "RAW_MATERIAL" as const,
    itemActive: true,
    quantity: "200",
    unitCode: "mg",
    basis,
    supplyResponsibility: "VERIDI" as const,
    purityPercentApplied: "90",
    overagePercent: null,
    legacyTotalQuantity: null,
    legacyTotalUnitCode: null,
    legacyBatchUnits: null,
    theoreticalPerUnit: null,
    physicalPerUnit: null,
    stockEquivalentQuantity: "0.0002",
    stockUnitCode: "kg",
    notes: null,
    position: 0,
  };
}

function versao(overrides: Partial<FormulationVersionDTO> = {}): FormulationVersionDTO {
  return {
    id: "fv-1",
    productId: "prod-1",
    productCode: "PROD-000005",
    productName: "Cafeína 60 cápsulas",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    basisQuantity: "1",
    // O arranjo exato da auditoria.
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    outputItemId: "pa-1",
    outputItemCode: "PA-000005",
    outputItemName: "Cafeína 60 cápsulas",
    outputUnitCode: "un",
    notes: null,
    components: [componente("PER_DOSE")],
    componentIssues: [],
    createdAt: new Date().toISOString(),
    createdBy: "Teste",
    activatedAt: null,
    ...overrides,
  } as FormulationVersionDTO;
}

async function abrir(dto: FormulationVersionDTO) {
  vi.mocked(getFormulationVersion).mockResolvedValue(dto);
  render(
    <MemoryRouter initialEntries={["/producao/formulacoes/prod-1/versoes/fv-1"]}>
      <Routes>
        <Route
          path="/producao/formulacoes/:productId/versoes/:versionId"
          element={<FormulationVersionPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getAllByText(/PROD-000005/).length).toBeGreaterThan(0));
}

describe("Doses por embalagem", () => {
  it("aparece em modo Base fixa quando há componente por dose", async () => {
    await abrir(versao());
    expect(screen.getByLabelText(/Doses por embalagem/)).toBeTruthy();
  });

  it("explica para que serve, sem falar de implementação", async () => {
    await abrir(versao());
    expect(
      screen.getByText(/quantidade total de componentes definidos por dose/i),
    ).toBeTruthy();
  });

  it("avisa que a formulação não ativa enquanto o número faltar", async () => {
    await abrir(versao());
    expect(screen.getByText(/não pode ser\s+ativada/i)).toBeTruthy();
  });

  it("some o aviso quando a premissa é informada", async () => {
    await abrir(versao());
    fireEvent.change(screen.getByLabelText(/Doses por embalagem/), { target: { value: "60" } });
    await waitFor(() =>
      expect(screen.queryByText(/não pode ser\s+ativada/i)).toBeNull(),
    );
  });

  it("não aparece quando nenhum componente depende de dose", async () => {
    await abrir(versao({ components: [componente("FIXED_BASIS")] }));
    expect(screen.queryByLabelText(/Doses por embalagem/)).toBeNull();
  });

  it("continua visível quando já existe valor gravado, mesmo sem componente por dose", async () => {
    // Campo que some levando o número junto esconde a premissa em vez de
    // simplificar a tela.
    await abrir(versao({ components: [componente("FIXED_BASIS")], dosesPerPackage: 60 }));
    expect(screen.getByLabelText(/Doses por embalagem/)).toBeTruthy();
  });

  it("quantidade sem premissa aparece como '—', nunca como zero", async () => {
    // Versão ativa: a linha é leitura pura, sem os campos do rascunho.
    await abrir(versao({ status: "ACTIVE", activatedAt: new Date().toISOString() }));
    const linha = screen.getAllByText(/MP-000003/)[0]?.closest("tr");
    expect(linha?.textContent).not.toMatch(/0 kg/);
    expect(linha?.textContent).toContain("—");
  });
});
