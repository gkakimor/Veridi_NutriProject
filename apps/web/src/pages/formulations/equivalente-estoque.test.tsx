import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FormulationVersionDTO } from "@veridi/shared";

/**
 * "Equivalente estoque" significa a MESMA coisa em rascunho e em versão ativa
 * — F-02-1.
 *
 * A célula tem dois números lado a lado: equivalente e físico por unidade. Em
 * rascunho, o equivalente vinha da prévia, que é o teórico POR UNIDADE ACABADA
 * calculado pelo motor. Em versão gravada, caía num campo diferente do DTO —
 * a quantidade declarada apenas convertida de unidade, sem o fator da base.
 *
 * Numa fórmula de 60 doses os dois valores diferem por 60. Mesma tela, mesma
 * coluna, mesmo rótulo, e ativar a versão mudava o número em 60 vezes sem que
 * nada tivesse mudado na receita.
 *
 * O rótulo não foi renomeado para o número parecer certo: o número passou a ser
 * um só, e vem do campo autoritativo da API.
 */

vi.mock("../../lib/formulations-api", () => ({
  getFormulationVersion: vi.fn(),
  updateFormulationVersion: vi.fn(),
  activateFormulationVersion: vi.fn(),
  createNewFormulationVersion: vi.fn(),
  getFormulationActivationImpact: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../../lib/items-api", () => ({ listItems: () => Promise.resolve({ items: [] }) }));
vi.mock("../../lib/units-api", () => ({
  listUnits: () =>
    Promise.resolve([
      { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
      { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
    ]),
}));
vi.mock("../../lib/costs-api", () => ({
  getFormulationCostEstimate: () => Promise.resolve(null),
}));
vi.mock("../../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));

import { getFormulationVersion } from "../../lib/formulations-api";
import { FormulationVersionPage } from "./FormulationVersionPage";

/**
 * 200 mg por dose, 60 doses por embalagem, item estocado em kg.
 *
 * Teórico por unidade acabada = 200 mg × 60 = 12 000 mg = 0,012 kg.
 * A quantidade declarada só convertida seria 0,0002 kg — sessenta vezes menos.
 */
const TEORICO_POR_UNIDADE = "0.012";
const DECLARADA_CONVERTIDA = "0,0002";

function componente() {
  return {
    id: "cmp-1",
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Cafeína",
    itemType: "RAW_MATERIAL" as const,
    itemActive: true,
    quantity: "200",
    unitCode: "mg",
    basis: "PER_DOSE" as const,
    supplyResponsibility: "VERIDI" as const,
    purityPercentApplied: null,
    overagePercent: null,
    quantityMode: "PHYSICAL_DIRECT" as const,
    applyPurityAdjustment: false,
    applyOverageAdjustment: false,
    legacyTotalQuantity: null,
    legacyTotalUnitCode: null,
    legacyBatchUnits: null,
    theoreticalPerUnit: TEORICO_POR_UNIDADE,
    physicalPerUnit: TEORICO_POR_UNIDADE,
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
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: 60,
    outputItemId: "pa-1",
    outputItemCode: "PA-000005",
    outputItemName: "Cafeína 60 cápsulas",
    outputUnitCode: "un",
    notes: null,
    components: [componente()],
    componentIssues: [],
    createdAt: new Date().toISOString(),
    createdBy: "Teste",
    activatedAt: null,
    ...overrides,
  } as FormulationVersionDTO;
}

async function abrir(dto: FormulationVersionDTO) {
  vi.mocked(getFormulationVersion).mockResolvedValue(dto);
  const view = render(
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
  return view;
}

/** O texto da célula "Equivalente estoque" da linha do componente. */
function equivalenteExibido(container: HTMLElement): string {
  const celula = container.querySelector(".estoque-valor--equivalente");
  expect(celula, "célula do equivalente estoque não encontrada").toBeTruthy();
  return celula!.textContent!.trim();
}

describe("Equivalente estoque — mesma grandeza em rascunho e em versão ativa", () => {
  it("rascunho mostra o teórico por unidade acabada, com o fator das doses aplicado", async () => {
    const { container } = await abrir(versao());
    expect(equivalenteExibido(container)).toBe("0,012 kg");
  });

  it("versão ativa mostra o mesmo número — ativar não muda a grandeza", async () => {
    const { container } = await abrir(
      versao({ status: "ACTIVE", activatedAt: new Date().toISOString() }),
    );
    expect(equivalenteExibido(container)).toBe("0,012 kg");
  });

  it("rascunho e ativa exibem o MESMO valor para o MESMO componente", async () => {
    const rascunho = await abrir(versao());
    const doRascunho = equivalenteExibido(rascunho.container);
    rascunho.unmount();

    const ativa = await abrir(versao({ status: "ACTIVE", activatedAt: new Date().toISOString() }));
    expect(equivalenteExibido(ativa.container)).toBe(doRascunho);
  });

  it("nenhum dos dois estados cai na quantidade declarada só convertida", async () => {
    for (const dto of [versao(), versao({ status: "ACTIVE", activatedAt: new Date().toISOString() })]) {
      const view = await abrir(dto);
      expect(equivalenteExibido(view.container)).not.toContain(DECLARADA_CONVERTIDA);
      view.unmount();
    }
  });

  it("sem premissa para quantificar, a versão gravada mostra travessão — nunca zero", async () => {
    const semPremissa = versao({
      status: "ACTIVE",
      activatedAt: new Date().toISOString(),
      dosesPerPackage: null,
      components: [{ ...componente(), theoreticalPerUnit: null, physicalPerUnit: null }],
    } as Partial<FormulationVersionDTO>);
    const { container } = await abrir(semPremissa);
    expect(equivalenteExibido(container)).toBe("—");
  });
});
