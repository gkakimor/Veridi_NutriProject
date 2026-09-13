import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { ProductionOrderDTO, ProductionOrderPlanningDTO } from "@veridi/shared";
import { planProductionProfileSnapshot } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-01 na Ordem de Produção.
 *
 * A OP em rascunho tem seis campos que se editam e se enviam: produto,
 * formulação, quantidade planejada, partes, rótulo e observações. São esses —
 * e só esses — que a guarda de saída considera.
 *
 * O Planejamento previsto fica FORA de propósito. Ele é cópia congelada do
 * Perfil mais uma projeção derivada da quantidade, refeita pelo servidor a
 * cada leitura: contá-lo seria contar a mesma edição duas vezes e transformar
 * uma releitura do servidor em pendência do usuário.
 */

vi.mock("../../lib/production-orders-api", () => ({
  listProductionOrders: vi.fn(),
  getProductionOrder: vi.fn(),
  createProductionOrder: vi.fn(),
  updateProductionOrder: vi.fn(),
  applyProductionProfile: vi.fn(),
  planProductionOrder: vi.fn(),
  releaseProductionOrder: vi.fn(),
  cancelProductionOrder: vi.fn(),
  confirmPicking: vi.fn(),
  substituteReservationLine: vi.fn(),
  recordConsumption: vi.fn(),
  registerProductionOutput: vi.fn(),
  acceptMaterialVariance: vi.fn(),
  completeProductionOrder: vi.fn(),
  addExtraReservation: vi.fn(),
}));
vi.mock("../../lib/products-api", () => ({
  listProducts: vi.fn(async () => ({ products: [PRODUTO], total: 1 })),
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  setProductActive: vi.fn(),
}));
vi.mock("../../lib/items-api", () => ({
  listItems: vi.fn(async () => ({ items: [], total: 0 })),
  getItem: vi.fn(async () => null),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  setItemActive: vi.fn(),
}));
vi.mock("../../lib/formulations-api", () => ({
  listFormulations: vi.fn(),
  listFormulationVersionsByProduct: vi.fn(async () => []),
  getFormulationVersion: vi.fn(),
  createFirstFormulationVersion: vi.fn(),
  updateFormulationVersion: vi.fn(),
  activateFormulationVersion: vi.fn(),
  getFormulationActivationImpact: vi.fn(),
  createNewFormulationVersion: vi.fn(),
}));
vi.mock("../../lib/costs-api", () => ({
  setAcquisitionCost: vi.fn(),
  getItemCostReference: vi.fn(),
  getFormulationCostEstimate: vi.fn(),
  getProductionOrderMaterialCost: vi.fn(async () => null),
}));
vi.mock("../../lib/cost-calculation-api", () => ({
  calculateIndustrialCost: vi.fn(),
  saveIndustrialCostCalculation: vi.fn(),
  getIndustrialCostCalculation: vi.fn(),
  listProductCostCalculations: vi.fn(),
  getProductionOrderCost: vi.fn(async () => null),
  discardIndustrialCostCalculation: vi.fn(),
}));

import {
  createProductionOrder,
  getProductionOrder,
  updateProductionOrder,
} from "../../lib/production-orders-api";
import { ProductionOrderPage } from "./ProductionOrderPage";
import { PLANEJAMENTO_VAZIO } from "./planning-fixture";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

const PRODUTO = {
  id: "prod-1",
  code: "PROD-000001",
  name: "Produto de Teste",
  finishedProductItem: { id: "pa-1", code: "PA-000001", name: "Produto acabado" },
};

/** Uma cópia congelada de verdade: é dela que sai a projeção do planejamento. */
const SNAPSHOT: NonNullable<ProductionOrderPlanningDTO["snapshot"]> = {
  sourceProfileId: "ppr-1",
  sourceProfileCode: "PPR-000012",
  sourceProfileName: "Cápsulas 500 mg",
  sourceVersionId: "ver-3",
  sourceVersionNumber: 3,
  referenceQuantity: "1000",
  referenceUomCode: "un",
  steps: [
    {
      sequence: 1,
      name: "Pesagem",
      description: null,
      setupDurationMinutes: 10,
      runDurationMinutes: 10,
      scalingMode: "PROPORTIONAL",
      resources: [
        {
          industrialResourceId: "res-operador",
          resourceCode: "RIN-000001",
          resourceName: "Mão de obra — Produção",
          resourceType: "LABOR",
          resourceQuantity: 1,
        },
      ],
    },
  ],
};

function planejamentoAplicado(quantidade: string): ProductionOrderPlanningDTO {
  return {
    snapshot: SNAPSHOT,
    plan: planProductionProfileSnapshot(SNAPSHOT, quantidade),
    quantityInReferenceUom: quantidade,
    conversionUnits: [{ code: "un", dimension: "COUNT", toBaseFactor: "1" }],
    planBlockedReason: null,
    appliedAt: "2026-09-11T12:00:00.000Z",
    appliedBy: "Admin",
    applicationSource: "AUTO_PRODUCT_DEFAULT",
    applicationReason: null,
    productDefaultProfile: null,
    productDefaultCompatible: false,
    availableProfile: null,
    canApply: false,
    canChoose: true,
    canUpdate: false,
    requiresLegacyRepair: false,
    routePending: false,
  };
}

function ordem(overrides: Partial<ProductionOrderDTO> = {}): ProductionOrderDTO {
  return {
    id: "op-1",
    code: "OP-000001",
    productId: PRODUTO.id,
    productCode: PRODUTO.code,
    productName: PRODUTO.name,
    finishedItemId: "pa-1",
    finishedItemCode: "PA-000001",
    finishedItemName: "Produto acabado",
    formulationVersionId: "fv-1",
    formulationVersionNumber: 1,
    formulationVersionLabel: "V1",
    plannedQuantity: "3000.000000",
    outputUnitCode: "un",
    productionFactor: "3",
    status: "DRAFT",
    origin: "MANUAL",
    materialsStatus: "MATERIALS_AVAILABLE",
    shortageItemCount: 0,
    materialReconciliation: {
      totalRequirements: 0,
      reconciledRequirements: 0,
      pendingRequirements: 0,
      canComplete: true,
    },
    planning: PLANEJAMENTO_VAZIO,
    notes: null,
    numberOfParts: 1,
    labelInstructions: null,
    shelfLifeMonths: null,
    suggestedBusinessLotNumber: null,
    productionOrderRevision: null,
    recipeSheetRevision: null,
    customerId: null,
    customerCode: null,
    customerName: null,
    customerCnpj: null,
    customerTradeName: null,
    customerZipCode: null,
    customerStreet: null,
    customerNumber: null,
    customerComplement: null,
    customerDistrict: null,
    customerCity: null,
    customerState: null,
    hasCustomerSuppliedRequirements: false,
    requirements: [],
    outputs: [],
    consumptions: [],
    eligibleFinishedLots: [],
    producedQuantity: "0",
    remainingQuantity: "3000",
    reservation: null,
    plannedAt: null,
    plannedBy: null,
    releasedAt: null,
    releasedBy: null,
    createdAt: "2026-09-11T12:00:00.000Z",
    updatedAt: "2026-09-11T12:00:00.000Z",
    ...overrides,
  } as unknown as ProductionOrderDTO;
}

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <nav id="sidebar">
        <Link to="/estoque">Estoque</Link>
      </nav>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

function montar(entradas: string[], indice?: number) {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/producao/ordens/nova" element={<ProductionOrderPage />} />
        <Route path="/producao/ordens/:id" element={<ProductionOrderPage />} />
        <Route path="/estoque" element={<h1>Posição de Estoque</h1>} />
      </Route>,
    ),
    { initialEntries: entradas, ...(indice === undefined ? {} : { initialIndex: indice }) },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function abrirNova() {
  montar(["/producao/ordens/nova"]);
  await screen.findByRole("heading", { name: "Nova ordem de produção" });
}

async function abrirGravada(dto = ordem()) {
  vi.mocked(getProductionOrder).mockResolvedValue(dto);
  montar(["/producao/ordens/op-1"]);
  await screen.findByRole("heading", { name: "OP-000001" });
  await waitFor(() => expect(quantidade()).toHaveValue("3000.000000"));
}

const pergunta = () => screen.queryByRole("alertdialog");
const menuEstoque = () => screen.getByRole("link", { name: "Estoque" });
const quantidade = () => document.getElementById("op-quantity") as HTMLInputElement;
const partes = () => document.getElementById("op-parts") as HTMLInputElement;
const rotulo = () => document.getElementById("op-label-instructions") as HTMLTextAreaElement;

/** Sem produto a OP nem é criada: o salvamento para antes de chamar a API. */
async function escolherProduto() {
  const user = userEvent.setup();
  await user.click(document.getElementById("op-product") as HTMLInputElement);
  await user.click(await screen.findByText(new RegExp(PRODUTO.code)));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OP nova — guarda de alterações não salvas", () => {
  it("aberta e não tocada, sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrirNova();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("alterar a quantidade planejada pergunta antes de sair", async () => {
    const user = userEvent.setup();
    await abrirNova();

    fireEvent.change(quantidade(), { target: { value: "3000" } });
    await user.click(menuEstoque());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas nesta ordem de produção/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Posição de Estoque" })).toBeNull();
  });

  it("salvar limpa a pendência antes de trocar de endereço", async () => {
    const user = userEvent.setup();
    vi.mocked(createProductionOrder).mockResolvedValue(ordem());
    vi.mocked(getProductionOrder).mockResolvedValue(ordem());
    await abrirNova();

    await escolherProduto();
    fireEvent.change(quantidade(), { target: { value: "3000" } });
    await user.click(screen.getByRole("button", { name: /Salvar rascunho/ }));

    await waitFor(() => expect(createProductionOrder).toHaveBeenCalledTimes(1));
    expect(pergunta()).toBeNull();
    await screen.findByRole("heading", { name: "OP-000001" });
  });
});

describe("OP gravada — guarda de alterações não salvas", () => {
  it("carregada e não tocada, sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrirGravada();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("com Planejamento previsto aplicado, carregar continua limpo", async () => {
    const user = userEvent.setup();
    await abrirGravada(ordem({ planning: planejamentoAplicado("3000") }));

    // A cópia do Perfil e a projeção vieram do servidor: não são edição.
    expect(screen.getByText(/PPR-000012/)).toBeInTheDocument();

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("mudar a quantidade com planejamento aplicado dá UMA pergunta, não duas", async () => {
    const user = userEvent.setup();
    await abrirGravada(ordem({ planning: planejamentoAplicado("3000") }));

    /*
     * A projeção do planejamento acompanha a quantidade. Se ela fosse uma
     * fonte própria, a mesma edição contaria duas vezes — e a foundation
     * responderia com dois diálogos empilhados sobre a mesma decisão.
     */
    fireEvent.change(quantidade(), { target: { value: "4000" } });
    await user.click(menuEstoque());

    expect(await screen.findAllByText("Sair sem salvar?")).toHaveLength(1);
  });

  it("alteração estrutural — partes e rótulo — também pergunta", async () => {
    const user = userEvent.setup();
    await abrirGravada();

    fireEvent.change(partes(), { target: { value: "3" } });
    await user.click(menuEstoque());
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(pergunta()).toBeNull());

    fireEvent.change(partes(), { target: { value: "1" } });
    fireEvent.change(rotulo(), { target: { value: "Rótulo especial" } });
    await user.click(menuEstoque());
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
  });

  it("reescrever o MESMO decimal não é alteração", async () => {
    const user = userEvent.setup();
    await abrirGravada();

    fireEvent.change(quantidade(), { target: { value: "3000" } });
    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("salvar limpa a pendência", async () => {
    const user = userEvent.setup();
    vi.mocked(updateProductionOrder).mockResolvedValue(ordem({ plannedQuantity: "4000.000000" }));
    await abrirGravada();

    fireEvent.change(quantidade(), { target: { value: "4000" } });
    await user.click(screen.getByRole("button", { name: /Salvar rascunho/ }));
    await waitFor(() => expect(updateProductionOrder).toHaveBeenCalledTimes(1));

    await user.click(menuEstoque());

    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("voltar pelo navegador com alteração pendente também pergunta", async () => {
    const user = userEvent.setup();
    vi.mocked(getProductionOrder).mockResolvedValue(ordem());
    const router = montar(["/estoque", "/producao/ordens/op-1"], 1);
    await screen.findByRole("heading", { name: "OP-000001" });
    await waitFor(() => expect(quantidade()).toHaveValue("3000.000000"));

    fireEvent.change(quantidade(), { target: { value: "4000" } });
    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
  });
});

/**
 * SAVE-FEEDBACK-REMAINING-01: o botão de gravar da OP acorda com a pendência
 * da guarda — a mesma que a faixa "Alterações não salvas" mostra — e dorme
 * quando não há o que gravar. A frase de sucesso só com a resposta.
 */
describe("OP — salvar só com alteração pendente", () => {
  const salvarRascunho = () => screen.getByRole("button", { name: "Salvar rascunho" });
  const salvarObservacoes = () => screen.getByRole("button", { name: "Salvar observações" });
  const observacoes = () => document.getElementById("op-notes") as HTMLTextAreaElement;

  it("nova e não tocada: nada a gravar", async () => {
    await abrirNova();

    expect(salvarRascunho()).toBeDisabled();
    fireEvent.change(quantidade(), { target: { value: "3000" } });
    expect(salvarRascunho()).toBeEnabled();
  });

  it("gravada: sem alteração desabilitado, alterar habilita, salvar desabilita de novo", async () => {
    vi.mocked(updateProductionOrder).mockResolvedValue(ordem({ numberOfParts: 3 }));
    await abrirGravada();

    expect(salvarRascunho()).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.change(partes(), { target: { value: "3" } });
    expect(salvarRascunho()).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("Alterações não salvas");

    fireEvent.click(salvarRascunho());

    expect(await screen.findByRole("status")).toHaveTextContent("Ordem de produção atualizada.");
    expect(salvarRascunho()).toBeDisabled();
    expect(updateProductionOrder).toHaveBeenCalledTimes(1);
  });

  it("desfazer a alteração devolve o botão ao descanso", async () => {
    await abrirGravada();

    fireEvent.change(rotulo(), { target: { value: "Rótulo especial" } });
    expect(salvarRascunho()).toBeEnabled();
    fireEvent.change(rotulo(), { target: { value: "" } });

    expect(salvarRascunho()).toBeDisabled();
  });

  it("clique duplo grava uma vez só", async () => {
    let responder!: (dto: ProductionOrderDTO) => void;
    vi.mocked(updateProductionOrder).mockReturnValue(
      new Promise((resolve) => {
        responder = resolve;
      }),
    );
    await abrirGravada();

    fireEvent.change(partes(), { target: { value: "3" } });
    fireEvent.click(salvarRascunho());
    fireEvent.click(screen.getByRole("button", { name: "Salvando…" }));

    expect(screen.getByRole("button", { name: "Salvando…" })).toBeDisabled();
    expect(updateProductionOrder).toHaveBeenCalledTimes(1);

    responder(ordem({ numberOfParts: 3 }));
    expect(await screen.findByText("Ordem de produção atualizada.")).toBeInTheDocument();
    expect(updateProductionOrder).toHaveBeenCalledTimes(1);
  });

  it("recusa vira alerta e nunca sucesso — nem depois de desfazer a edição", async () => {
    /*
     * Com a pendência na tela a frase fica escondida; desfazer a edição tira a
     * pendência. Uma confirmação posta antes do `await` apareceria aqui.
     */
    vi.mocked(updateProductionOrder).mockRejectedValue(new Error("Falha de rede ao gravar a OP"));
    await abrirGravada();

    fireEvent.change(partes(), { target: { value: "3" } });
    fireEvent.click(salvarRascunho());

    expect(await screen.findByRole("alert")).toHaveTextContent("Falha de rede ao gravar a OP");
    // A edição fica, e a pendência também.
    expect(partes()).toHaveValue(3);
    expect(screen.getByRole("status")).toHaveTextContent("Alterações não salvas");
    expect(salvarRascunho()).toBeEnabled();

    fireEvent.change(partes(), { target: { value: "1" } });

    expect(screen.queryByText("Ordem de produção atualizada.")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("OP planejada: Salvar observações segue a mesma pendência", async () => {
    vi.mocked(updateProductionOrder).mockResolvedValue(
      ordem({ status: "PLANNED", notes: "Conferir embalagem" }),
    );
    // Planejada não tem campo de quantidade: a abertura espera o próprio botão.
    vi.mocked(getProductionOrder).mockResolvedValue(ordem({ status: "PLANNED" }));
    montar(["/producao/ordens/op-1"]);
    await screen.findByRole("button", { name: "Salvar observações" });

    expect(salvarObservacoes()).toBeDisabled();
    fireEvent.change(observacoes(), { target: { value: "Conferir embalagem" } });
    expect(salvarObservacoes()).toBeEnabled();

    fireEvent.click(salvarObservacoes());

    expect(await screen.findByRole("status")).toHaveTextContent("Ordem de produção atualizada.");
    expect(salvarObservacoes()).toBeDisabled();
    expect(vi.mocked(updateProductionOrder).mock.calls[0]![1]).toEqual({ notes: "Conferir embalagem" });
  });
});
