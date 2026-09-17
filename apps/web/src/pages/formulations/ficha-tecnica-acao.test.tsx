import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import type { FormulationVersionDTO } from "@veridi/shared";

/**
 * FORMULATION-TECHNICAL-SHEET-PDF-01 — a ação na bancada.
 *
 * O documento em si é provado em `pdf/documents/technical-sheet-*.test.tsx`.
 * O que esta suíte cobre é a porta: o botão existe junto das ações da versão,
 * leva à ficha DAQUELA versão e aparece tanto no rascunho quanto na versão
 * ativa — uma ficha marcada como rascunho é melhor que nenhuma ficha.
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
vi.mock("../../app/AuthProvider", () => ({ useOptionalAuth: () => null, useAuth: () => ({ user: { role: "ADMIN" } }) }));

import { getFormulationVersion } from "../../lib/formulations-api";
import { FormulationVersionPage } from "./FormulationVersionPage";

function versao(overrides: Partial<FormulationVersionDTO> = {}): FormulationVersionDTO {
  return {
    id: "fv-9",
    productId: "prod-9",
    productCode: "PROD-000174",
    productName: "Exemplo - Ácido Fólico PT 120 Caps",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    basisQuantity: "1",
    calculationMode: "PER_DOSE",
    dosesPerPackage: 120,
    dosageForm: "CAPSULE",
    presentationType: "POT",
    capsulesPerDose: 1,
    capsulesPerPackage: 120,
    doseAmount: null,
    doseUomCode: null,
    packageContentAmount: null,
    packageContentUomCode: null,
    expectedLossPercent: null,
    productProfile: {
      dosageForm: "CAPSULE",
      presentationType: "POT",
      capsulesPerDose: 1,
      doseAmount: null,
      doseUomCode: null,
      dosesPerPackage: 120,
      targetAgeGroup: null,
      minimumBatchQuantity: null,
      unitsPerShippingBox: null,
    },
    outputItemId: "pa-9",
    outputItemCode: "PA-000174",
    outputItemName: "Exemplo - Ácido Fólico PT 120 Caps",
    outputUnitCode: "un",
    notes: null,
    components: [],
    componentIssues: [],
    createdAt: new Date().toISOString(),
    createdBy: "Teste",
    activatedAt: null,
    activatedBy: null,
    inactivatedAt: null,
    inactivatedBy: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    originTemplateVersionId: null,
    originTemplateCode: null,
    originTemplateVersionNumber: null,
    originTemplateName: null,
    ...overrides,
  } as FormulationVersionDTO;
}

/** A rota do documento, representada pelo endereço que ela recebeu. */
function FichaTecnicaStub() {
  const { productId, versionId } = useParams();
  return <p>ficha de {`${productId}/${versionId}`}</p>;
}

async function abrir(dto: FormulationVersionDTO = versao()) {
  vi.mocked(getFormulationVersion).mockResolvedValue(dto);
  render(
    <MemoryRouter initialEntries={["/producao/formulacoes/prod-9/versoes/fv-9"]}>
      <Routes>
        <Route
          path="/producao/formulacoes/:productId/versoes/:versionId"
          element={<FormulationVersionPage />}
        />
        <Route
          path="/producao/formulacoes/:productId/versoes/:versionId/ficha-tecnica"
          element={<FichaTecnicaStub />}
        />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getAllByText(/PROD-000174/).length).toBeGreaterThan(0));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Formulação — Ficha técnica (PDF)", () => {
  it("a ação fica junto das ações da versão, no cabeçalho", async () => {
    await abrir();
    const botao = screen.getByRole("button", { name: "Ficha técnica (PDF)" });
    expect(botao.closest(".doc-header")).not.toBeNull();
  });

  it("leva à ficha DESTA versão", async () => {
    await abrir();
    fireEvent.click(screen.getByRole("button", { name: "Ficha técnica (PDF)" }));
    expect(await screen.findByText("ficha de prod-9/fv-9")).toBeInTheDocument();
  });

  it("existe também na versão ativa, que é somente leitura", async () => {
    await abrir(versao({ status: "ACTIVE", activatedAt: new Date().toISOString() }));
    expect(screen.getByRole("button", { name: "Ficha técnica (PDF)" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Salvar rascunho" })).toBeNull();
  });
});
