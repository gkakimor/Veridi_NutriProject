import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FormulationComponentDTO, FormulationVersionDTO } from "@veridi/shared";

/**
 * UX-ACTIONS-FEEDBACK-WAVE-02 — a Formulação diz o que acabou de gravar.
 *
 * "Salvar rascunho" já dizia "Salvando…" — e dizia também durante a ativação
 * e a criação de versão, que usam o mesmo freio de clique duplo. Sucesso não
 * dizia nada. A regra de ativação (grava antes, e só ativa se gravou) é a da
 * suíte `ativar-com-rascunho`; aqui fica só o que a barra responde.
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

import {
  activateFormulationVersion,
  getFormulationVersion,
  updateFormulationVersion,
} from "../../lib/formulations-api";
import { FormulationVersionPage } from "./FormulationVersionPage";

function componente(): FormulationComponentDTO {
  return {
    id: "cmp-1",
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Cafeína",
    itemType: "RAW_MATERIAL",
    itemActive: true,
    quantity: "200",
    unitCode: "mg",
    basis: "FIXED_BASIS",
    supplyResponsibility: "VERIDI",
    purityPercentApplied: null,
    overagePercent: null,
    quantityMode: "PHYSICAL_DIRECT",
    applyPurityAdjustment: false,
    applyOverageAdjustment: false,
    legacyTotalQuantity: null,
    legacyTotalUnitCode: null,
    legacyBatchUnits: null,
    theoreticalPerUnit: null,
    physicalPerUnit: null,
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
    basisQuantity: "1000",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
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

async function abrir() {
  vi.mocked(getFormulationVersion).mockResolvedValue(versao());
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

function editarBase(valor: string) {
  const campo = document.getElementById("version-basis") as HTMLInputElement;
  fireEvent.change(campo, { target: { value: valor } });
}

const botao = (nome: string | RegExp) => screen.getByRole("button", { name: nome });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Formulação — Salvar rascunho responde", () => {
  it("pendência na barra; Salvando… só no botão de salvar; Rascunho salvo. só com a resposta", async () => {
    let gravar: (dto: FormulationVersionDTO) => void = () => {};
    vi.mocked(updateFormulationVersion).mockReturnValue(
      new Promise((resolve) => {
        gravar = resolve;
      }) as ReturnType<typeof updateFormulationVersion>,
    );
    await abrir();

    editarBase("2500");
    const pendencia = screen.getByText("Alterações não salvas");
    expect(pendencia).toHaveAttribute("role", "status");
    expect(pendencia.closest(".doc-actions__primary")).toContainElement(botao("Salvar rascunho"));

    fireEvent.click(botao("Salvar rascunho"));

    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    // O vizinho recusa o clique, mas não rouba o rótulo.
    expect(botao("Ativar versão")).toBeDisabled();
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();

    gravar(versao({ basisQuantity: "2500" }));

    expect(await screen.findByText("Rascunho salvo.")).toHaveAttribute("role", "status");
    expect(screen.getAllByText("Rascunho salvo.")).toHaveLength(1);
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(updateFormulationVersion).toHaveBeenCalledTimes(1);
  });

  it("falha na gravação fica em role=alert e nunca vira Rascunho salvo.", async () => {
    vi.mocked(updateFormulationVersion).mockRejectedValue(new Error("Falha de rede"));
    await abrir();

    editarBase("2500");
    fireEvent.click(botao("Salvar rascunho"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Falha de rede");
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
  });

  it("ativar diz Ativando… no próprio botão e confirma Versão ativada. — o diálogo continua", async () => {
    const user = userEvent.setup();
    let ativar: (dto: FormulationVersionDTO) => void = () => {};
    vi.mocked(activateFormulationVersion).mockReturnValue(
      new Promise((resolve) => {
        ativar = resolve;
      }) as ReturnType<typeof activateFormulationVersion>,
    );
    await abrir();

    await user.click(botao("Ativar versão"));
    // A decisão continua passando pelo diálogo.
    await screen.findByRole("alertdialog");
    await user.click(botao("Ativar"));

    expect(await screen.findByRole("button", { name: "Ativando…" })).toBeDisabled();
    // "Salvando…" é do salvamento, não da ativação.
    expect(botao("Salvar rascunho")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Salvando…" })).toBeNull();

    ativar(versao({ status: "ACTIVE", activatedAt: new Date().toISOString() }));

    expect(await screen.findByText("Versão ativada.")).toHaveAttribute("role", "status");
    expect(screen.queryByText("Rascunho salvo.")).toBeNull();
    expect(updateFormulationVersion).not.toHaveBeenCalled();
  });
});
