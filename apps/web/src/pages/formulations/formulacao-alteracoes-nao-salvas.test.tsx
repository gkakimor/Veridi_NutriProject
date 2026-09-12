import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { FormulationComponentDTO, FormulationVersionDTO } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-FOUNDATION-01 na versão de formulação.
 *
 * A tela já sabia dizer o que está pendente — ela usa isso para prender
 * "Salvar rascunho" e "Ativar versão". A guarda de saída reusa a MESMA
 * resposta, e o que se protege aqui é ela não inventar pendência nem perder
 * uma:
 *
 * - página recém-carregada, sem ninguém ter tocado em nada, sai sem pergunta.
 *   A comparação parte de uma string vazia, então antes da primeira leitura
 *   TUDO difere dela — o falso positivo é o modo de falha natural aqui;
 * - receita editada pergunta;
 * - ajuste configurado e ainda não aplicado também pergunta, pela mesma
 *   pergunta: é pendência tanto quanto a receita.
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
      { code: "g", label: "grama", dimension: "MASS", toBaseFactor: "0.001" },
      { code: "kg", label: "quilograma", dimension: "MASS", toBaseFactor: "1" },
    ]),
}));
vi.mock("../../lib/costs-api", () => ({
  getFormulationCostEstimate: () => Promise.resolve(null),
}));
vi.mock("../../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));

import { getFormulationVersion } from "../../lib/formulations-api";
import { FormulationVersionPage } from "./FormulationVersionPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

function componente(): FormulationComponentDTO {
  return {
    id: "cmp-1",
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Ativo",
    itemType: "RAW_MATERIAL",
    itemActive: true,
    quantity: "220",
    unitCode: "g",
    basis: "FIXED_BASIS",
    supplyResponsibility: "VERIDI",
    purityPercentApplied: "98",
    overagePercent: null,
    quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
    applyPurityAdjustment: true,
    applyOverageAdjustment: false,
    legacyTotalQuantity: null,
    legacyTotalUnitCode: null,
    legacyBatchUnits: null,
    theoreticalPerUnit: null,
    physicalPerUnit: null,
    stockUnitCode: "kg",
    notes: null,
    position: 0,
  } as FormulationComponentDTO;
}

function versao(): FormulationVersionDTO {
  return {
    id: "fv-1",
    productId: "prod-1",
    productCode: "PROD-000005",
    productName: "Produto de teste",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    basisQuantity: "1",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    outputItemId: "pa-1",
    outputItemCode: "PA-000005",
    outputItemName: "Produto de teste",
    outputUnitCode: "un",
    notes: null,
    components: [componente()],
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
  };
}

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <nav id="sidebar">
        <Link to="/comercial/pedidos">Pedidos</Link>
      </nav>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

async function abrir() {
  vi.mocked(getFormulationVersion).mockResolvedValue(versao());
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route
          path="/producao/formulacoes/:productId/versoes/:versionId"
          element={<FormulationVersionPage />}
        />
        <Route path="/comercial/pedidos" element={<h1>Pedidos</h1>} />
      </Route>,
    ),
    { initialEntries: ["/producao/formulacoes/prod-1/versoes/fv-1"] },
  );
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getAllByText(/PROD-000005/).length).toBeGreaterThan(0));
  await waitFor(() =>
    expect(document.querySelectorAll("tbody tr select option").length).toBeGreaterThan(1),
  );
}

const pergunta = () => screen.queryByRole("alertdialog");
const menuPedidos = () => screen.getByRole("link", { name: "Pedidos" });
/*
 * Busca pelo `id` e não pelo rótulo: o rótulo carrega o ⓘ de ajuda, e o texto
 * dele bate em mais de um nó.
 */
const base = () => document.getElementById("version-basis") as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Formulação — guarda de alterações não salvas", () => {
  it("versão recém-carregada, sem edição, sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("receita editada pergunta antes de sair", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(base(), { target: { value: "2" } });
    await user.click(menuPedidos());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas nesta formulação/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("ajuste configurado e não aplicado usa a MESMA pergunta", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(screen.getByRole("button", { name: /Calculada/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Pureza aplicada" }), {
      target: { value: "95" },
    });

    await user.click(menuPedidos());

    expect(await screen.findAllByText("Sair sem salvar?")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });
});
