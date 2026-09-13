import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type {
  ProductionOrderDTO,
  ProductionOrderPlanningDTO,
  ProductionOrderScheduleDTO,
} from "@veridi/shared";
import { planProductionProfileSnapshot } from "@veridi/shared";

/**
 * OP-SCHEDULE-STALE-ON-QUANTITY-01 na tela da Ordem de Produção.
 *
 * A programação gravada foi calculada para a quantidade salva. O que estes
 * testes protegem:
 *
 * - a pergunta só aparece quando a quantidade muda DE VERDADE e há programação;
 * - Cancelar fecha a pergunta sem tocar no formulário — a edição continua ali,
 *   pendente, e a guarda de saída ainda a protege;
 * - confirmar envia `confirmScheduleRemoval`, e a frase de sucesso só chega com
 *   a resposta: a programação some da tela, o roteiro fica;
 * - a recusa 409 do servidor (programação que surgiu depois da leitura) abre a
 *   mesma pergunta; qualquer outra recusa é alerta.
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
vi.mock("../../lib/production-schedules-api", () => ({
  getProductionOrderSchedule: vi.fn(),
  unscheduleProductionOrder: vi.fn(),
  previewProductionOrderSchedule: vi.fn(),
  scheduleProductionOrder: vi.fn(),
}));
vi.mock("../../lib/products-api", () => ({
  listProducts: vi.fn(async () => ({ products: [], total: 0 })),
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
  listFormulationVersionsByProduct: vi.fn(async () => ({ versions: [] })),
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

import { getProductionOrder, updateProductionOrder } from "../../lib/production-orders-api";
import { getProductionOrderSchedule } from "../../lib/production-schedules-api";
import { ScheduleRemovalNeedsConfirmationApiError } from "../../lib/api-errors";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import { ProductionOrderPage } from "./ProductionOrderPage";

const getProductionOrderMock = vi.mocked(getProductionOrder);
const updateProductionOrderMock = vi.mocked(updateProductionOrder);
const getProductionOrderScheduleMock = vi.mocked(getProductionOrderSchedule);

// ─────────────────────────────────────────────────────────────── fixtures

const PERGUNTA =
  "Alterar a quantidade removerá a programação atual desta ordem, pois os tempos e recursos precisam ser recalculados.";
const REMOVIDA = "Quantidade atualizada. A programação anterior foi removida e precisa ser refeita.";
const ATUALIZADA = "Ordem de produção atualizada.";
const CONFIRMAR = "Alterar quantidade e remover programação";

/** 1.000 un em 60 min: a conta que a programação gravada guardou. */
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
      name: "Mistura",
      description: null,
      setupDurationMinutes: 0,
      runDurationMinutes: 60,
      scalingMode: "PROPORTIONAL",
      resources: [],
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
    appliedAt: "2026-09-12T11:00:00.000Z",
    appliedBy: "Ana Produção",
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

const AGENDA: ProductionOrderScheduleDTO = {
  productionOrderId: "op-1",
  productionOrderCode: "OP-000001",
  plannedStartAt: "2026-09-14T11:00:00.000Z",
  plannedEndAt: "2026-09-14T12:00:00.000Z",
  workingMinutes: 60,
  steps: [],
  scheduledAt: "2026-09-12T12:00:00.000Z",
  scheduledBy: "Ana Produção",
  updatedAt: "2026-09-12T12:00:00.000Z",
  notes: null,
};

function ordem(overrides: Partial<ProductionOrderDTO> = {}): ProductionOrderDTO {
  return {
    id: "op-1",
    code: "OP-000001",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Produto de Teste",
    finishedItemId: "pa-1",
    finishedItemCode: "PA-000001",
    finishedItemName: "Produto acabado",
    formulationVersionId: "fv-1",
    formulationVersionNumber: 1,
    formulationVersionLabel: "V1",
    plannedQuantity: "1000",
    outputUnitCode: "un",
    productionFactor: "1",
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
    planning: planejamentoAplicado("1000"),
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
    remainingQuantity: "1000",
    reservation: null,
    plannedAt: null,
    plannedBy: null,
    releasedAt: null,
    releasedBy: null,
    createdAt: "2026-09-12T11:00:00.000Z",
    updatedAt: "2026-09-12T11:00:00.000Z",
    ...overrides,
  } as unknown as ProductionOrderDTO;
}

/** A resposta do servidor depois de gravar 2.000 un: outra leitura, outro `updatedAt`. */
const gravadaCom2000 = () =>
  ordem({
    plannedQuantity: "2000",
    remainingQuantity: "2000",
    planning: planejamentoAplicado("2000"),
    updatedAt: "2026-09-12T13:00:00.000Z",
  });

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

async function abrir(agenda: ProductionOrderScheduleDTO | null) {
  getProductionOrderMock.mockResolvedValue(ordem());
  getProductionOrderScheduleMock.mockResolvedValue({ schedule: agenda });
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/producao/ordens/:id" element={<ProductionOrderPage />} />
        <Route path="/estoque" element={<h1>Posição de Estoque</h1>} />
      </Route>,
    ),
    { initialEntries: ["/producao/ordens/op-1"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "OP-000001" });
  await waitFor(() => expect(quantidade()).toHaveValue("1000"));
  if (agenda) await screen.findByRole("group", { name: "Programação da ordem" });
  else await waitFor(() => expect(getProductionOrderScheduleMock).toHaveBeenCalled());
}

const quantidade = () => document.getElementById("op-quantity") as HTMLInputElement;
const observacoes = () => document.getElementById("op-notes") as HTMLTextAreaElement;
const pergunta = () => screen.queryByRole("alertdialog");
const salvar = () => fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));

beforeEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────── testes

describe("OP em rascunho com programação — mudar a quantidade", () => {
  it("pergunta antes de enviar, com a frase e as duas ações — nada vai ao servidor", async () => {
    await abrir(AGENDA);

    fireEvent.change(quantidade(), { target: { value: "2000" } });
    salvar();

    const dialogo = await screen.findByRole("alertdialog");
    expect(dialogo).toHaveTextContent(PERGUNTA);
    expect(within(dialogo).getByRole("button", { name: "Cancelar" })).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: CONFIRMAR })).toBeInTheDocument();
    expect(updateProductionOrderMock).not.toHaveBeenCalled();
  });

  it("Cancelar mantém a quantidade digitada, e a edição continua pendente e protegida", async () => {
    const user = userEvent.setup();
    await abrir(AGENDA);

    fireEvent.change(quantidade(), { target: { value: "2000" } });
    salvar();
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(pergunta()).toBeNull());
    expect(quantidade()).toHaveValue("2000");
    expect(screen.getByRole("status")).toHaveTextContent("Alterações não salvas");
    expect(screen.getByRole("group", { name: "Programação da ordem" })).toBeInTheDocument();
    expect(updateProductionOrderMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("link", { name: "Estoque" }));
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
  });

  it("confirmar envia a flag; a frase e a tela sem programação só chegam com a resposta", async () => {
    const user = userEvent.setup();
    await abrir(AGENDA);
    let responder!: (dto: ProductionOrderDTO) => void;
    updateProductionOrderMock.mockReturnValue(
      new Promise((resolve) => {
        responder = resolve;
      }),
    );
    // Depois de gravar, o servidor já não tem programação para esta ordem.
    getProductionOrderScheduleMock.mockResolvedValue({ schedule: null });

    fireEvent.change(quantidade(), { target: { value: "2000" } });
    salvar();
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: CONFIRMAR }));

    await waitFor(() =>
      expect(updateProductionOrderMock).toHaveBeenCalledWith(
        "op-1",
        expect.objectContaining({ plannedQuantity: "2000", confirmScheduleRemoval: true }),
      ),
    );
    expect(pergunta()).toBeNull();
    expect(screen.getByRole("button", { name: "Salvando…" })).toBeDisabled();
    expect(screen.queryByText(REMOVIDA)).toBeNull();
    expect(screen.getByRole("group", { name: "Programação da ordem" })).toBeInTheDocument();

    responder(gravadaCom2000());

    expect(await screen.findByRole("status")).toHaveTextContent(REMOVIDA);
    await waitFor(() => expect(screen.queryByRole("group", { name: "Programação da ordem" })).toBeNull());
    expect(screen.getByText(/Sem início previsto/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Definir início previsto" })).toBeInTheDocument();
    // O roteiro aplicado continua: é dele que sai a próxima programação.
    expect(screen.getByText("Roteiro de produção aplicado")).toBeInTheDocument();
    expect(quantidade()).toHaveValue("2000");
    expect(updateProductionOrderMock).toHaveBeenCalledTimes(1);

    // Gravou: sair não pergunta mais nada.
    await user.click(screen.getByRole("link", { name: "Estoque" }));
    expect(await screen.findByRole("heading", { name: "Posição de Estoque" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("a programação que surgiu depois da leitura: a recusa 409 abre a mesma pergunta", async () => {
    await abrir(null);
    updateProductionOrderMock
      .mockRejectedValueOnce(
        new ScheduleRemovalNeedsConfirmationApiError(`${PERGUNTA} Confirme para continuar.`),
      )
      .mockResolvedValueOnce(gravadaCom2000());

    fireEvent.change(quantidade(), { target: { value: "2000" } });
    salvar();

    const dialogo = await screen.findByRole("alertdialog");
    expect(updateProductionOrderMock).toHaveBeenCalledTimes(1);
    expect(updateProductionOrderMock.mock.calls[0]![1]).not.toHaveProperty("confirmScheduleRemoval");
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(within(dialogo).getByRole("button", { name: CONFIRMAR }));

    await waitFor(() => expect(updateProductionOrderMock).toHaveBeenCalledTimes(2));
    expect(updateProductionOrderMock.mock.calls[1]![1]).toMatchObject({ confirmScheduleRemoval: true });
    expect(await screen.findByRole("status")).toHaveTextContent(REMOVIDA);
  });

  it("outra recusa vira alerta, nenhum sucesso é anunciado e a edição fica", async () => {
    await abrir(AGENDA);
    updateProductionOrderMock.mockRejectedValue(
      new Error("Após planejada, a ordem de produção só permite alterar observações."),
    );

    fireEvent.change(quantidade(), { target: { value: "2000" } });
    salvar();
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: CONFIRMAR }));

    expect(await screen.findByRole("alert")).toHaveTextContent("só permite alterar observações");
    expect(screen.queryByText(REMOVIDA)).toBeNull();
    expect(screen.queryByText(ATUALIZADA)).toBeNull();
    expect(quantidade()).toHaveValue("2000");
    expect(screen.getByRole("status")).toHaveTextContent("Alterações não salvas");
  });
});

describe("OP em rascunho — quando NÃO se pergunta", () => {
  it("sem pendência na tela, \"Salvando…\" enquanto espera e a frase só com a resposta", async () => {
    /*
     * Salvar sem alteração pendente: aqui "Alterações não salvas" não ocupa o
     * lugar da frase, então uma confirmação adiantada para antes do `await`
     * apareceria — é o caso que prova "sucesso só depois da API".
     */
    await abrir(AGENDA);
    let responder!: (dto: ProductionOrderDTO) => void;
    updateProductionOrderMock.mockReturnValue(
      new Promise((resolve) => {
        responder = resolve;
      }),
    );

    salvar();

    expect(await screen.findByRole("button", { name: "Salvando…" })).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();

    responder(ordem({ updatedAt: "2026-09-12T13:00:00.000Z" }));

    expect(await screen.findByRole("status")).toHaveTextContent(ATUALIZADA);
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeEnabled();
  });

  it("a mesma quantidade escrita de outro jeito não pergunta e não pede remoção", async () => {
    await abrir(AGENDA);
    updateProductionOrderMock.mockResolvedValue(ordem({ updatedAt: "2026-09-12T13:00:00.000Z" }));

    fireEvent.change(quantidade(), { target: { value: "1000,000" } });
    salvar();

    await waitFor(() => expect(updateProductionOrderMock).toHaveBeenCalledTimes(1));
    expect(pergunta()).toBeNull();
    expect(updateProductionOrderMock.mock.calls[0]![1]).not.toHaveProperty("confirmScheduleRemoval");
    expect(await screen.findByRole("status")).toHaveTextContent(ATUALIZADA);
    expect(screen.getByRole("group", { name: "Programação da ordem" })).toBeInTheDocument();
  });

  it("alterar outro campo não pergunta", async () => {
    await abrir(AGENDA);
    updateProductionOrderMock.mockResolvedValue(
      ordem({ notes: "Conferir embalagem", updatedAt: "2026-09-12T13:00:00.000Z" }),
    );

    fireEvent.change(observacoes(), { target: { value: "Conferir embalagem" } });
    salvar();

    await waitFor(() => expect(updateProductionOrderMock).toHaveBeenCalledTimes(1));
    expect(pergunta()).toBeNull();
    expect(updateProductionOrderMock.mock.calls[0]![1]).toMatchObject({
      notes: "Conferir embalagem",
      plannedQuantity: "1000",
    });
    expect(updateProductionOrderMock.mock.calls[0]![1]).not.toHaveProperty("confirmScheduleRemoval");
    expect(await screen.findByRole("status")).toHaveTextContent(ATUALIZADA);
  });

  it("sem programação, a quantidade nova salva direto", async () => {
    await abrir(null);
    updateProductionOrderMock.mockResolvedValue(gravadaCom2000());

    fireEvent.change(quantidade(), { target: { value: "2000" } });
    salvar();

    await waitFor(() => expect(updateProductionOrderMock).toHaveBeenCalledTimes(1));
    expect(pergunta()).toBeNull();
    expect(updateProductionOrderMock.mock.calls[0]![1]).not.toHaveProperty("confirmScheduleRemoval");
    expect(await screen.findByRole("status")).toHaveTextContent(ATUALIZADA);
  });
});

describe("Confirmação da quantidade — 390px", () => {
  it("em tela estreita os botões empilham e o rótulo longo quebra dentro do botão", async () => {
    const css = readFileSync(join(process.cwd(), "src", "pages", "planning", "planning.css"), "utf8");
    const regra = css.slice(css.indexOf(".confirm-dialog:has(.schedule-reset-confirm)"));
    const estreita = regra.slice(regra.indexOf("@media (max-width: 480px)"));
    expect(estreita).toContain("flex-direction: column-reverse");
    expect(estreita).toContain("height: auto");

    await abrir(AGENDA);
    fireEvent.change(quantidade(), { target: { value: "2000" } });
    salvar();
    const dialogo = await screen.findByRole("alertdialog");
    expect(dialogo.classList.contains("confirm-dialog")).toBe(true);
    expect(dialogo.querySelector(".schedule-reset-confirm")).not.toBeNull();
  });
});
