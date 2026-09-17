import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ProductionOrderDTO } from "@veridi/shared";

/**
 * Produto e item de produto acabado inativos na Ordem de Produção —
 * PRODUCT-INACTIVE-COMMERCIAL-GATE-01, §108.
 *
 * A ordem mostra a situação REAL que a leitura traz (`productActive`,
 * `finishedItemActive`). Rascunho e planejada avisam antes do clique que planejar
 * e liberar vão ser recusados; liberada e em execução seguem — só a marca.
 */

vi.mock("../../lib/production-orders-api", () => ({
  listProductionOrders: vi.fn(),
  getProductionOrder: vi.fn(),
  createProductionOrder: vi.fn(),
  updateProductionOrder: vi.fn(),
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
  // A lista de ativos não traz o produto inativado da ordem.
  listProducts: vi.fn(async () => ({ products: [], total: 0, page: 1, pageSize: 50 })),
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

import { getProductionOrder } from "../../lib/production-orders-api";
import { ProductionOrderPage } from "./ProductionOrderPage";
import { PLANEJAMENTO_VAZIO } from "./planejamento-vazio";

function ordem(
  status: ProductionOrderDTO["status"],
  situacao: { productActive: boolean; finishedItemActive: boolean | null },
): ProductionOrderDTO {
  const liberada = status === "RELEASED" || status === "IN_PRODUCTION";
  return {
    id: "op-1",
    code: "OP-000001",
    productId: "prod-9",
    productCode: "PROD-000009",
    productName: "Magnésio 60 caps",
    finishedItemId: "pa-9",
    finishedItemCode: "PA-000009",
    finishedItemName: "Magnésio 60 caps",
    ...situacao,
    formulationVersionId: null,
    formulationVersionNumber: null,
    formulationVersionLabel: null,
    plannedQuantity: "10",
    outputUnitCode: "un",
    productionFactor: null,
    planning: PLANEJAMENTO_VAZIO,
    status,
    origin: "MANUAL",
    materialsStatus: "NOT_EVALUATED",
    shortageItemCount: 0,
    materialReconciliation: {
      totalRequirements: 0,
      reconciledRequirements: 0,
      pendingRequirements: 0,
      canComplete: false,
    },
    notes: null,
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
    officialNumber: liberada ? "OP 0001/2026" : null,
    numberOfParts: 1,
    labelInstructions: null,
    shelfLifeMonths: null,
    suggestedBusinessLotNumber: null,
    productionOrderRevision: null,
    recipeSheetRevision: null,
    requirements: [],
    plannedAt: status === "DRAFT" ? null : "2026-09-10T12:00:00.000Z",
    plannedBy: status === "DRAFT" ? null : "Produção",
    releasedAt: liberada ? "2026-09-11T12:00:00.000Z" : null,
    releasedBy: liberada ? "Produção" : null,
    reservation: null,
    startedAt: null,
    startedBy: null,
    consumptions: [],
    outputs: [],
    eligibleFinishedLots: [],
    parts: [],
    producedQuantity: "0",
    remainingQuantity: "10",
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-09T12:00:00.000Z",
    updatedAt: "2026-09-10T12:00:00.000Z",
  } as unknown as ProductionOrderDTO;
}

function renderizar() {
  render(
    <MemoryRouter initialEntries={["/producao/ordens/op-1"]}>
      <Routes>
        <Route path="/producao/ordens/:id" element={<ProductionOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const aberta = () => screen.findByRole("heading", { level: 1, name: /OP-000001/ });
const aviso = () =>
  screen
    .queryByText(/^(Produto inativo|Item de produto acabado inativo|Produto e item de produto acabado inativos)$/, {
      selector: ".pendency-panel__title",
    })
    ?.closest(".pendency-panel") ?? null;
const marcas = (texto: string) => screen.queryAllByText(texto, { selector: ".badge.badge--inactive" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OP — produto ou PA inativado depois que a ordem nasceu", () => {
  it("planejada com produto inativo: marca real e aviso de que liberar é recusado", async () => {
    vi.mocked(getProductionOrder).mockResolvedValue(ordem("PLANNED", { productActive: false, finishedItemActive: true }));
    renderizar();
    await aberta();

    const painel = aviso();
    expect(painel).not.toBeNull();
    expect(within(painel as HTMLElement).getByText("Produto inativo")).toBeInTheDocument();
    expect(painel).toHaveTextContent("não é possível liberar a ordem enquanto o produto estiver inativo.");
    expect(marcas("Inativo")).toHaveLength(1);
  });

  it("planejada com PA inativo: aviso e marca próprios do item", async () => {
    vi.mocked(getProductionOrder).mockResolvedValue(ordem("PLANNED", { productActive: true, finishedItemActive: false }));
    renderizar();
    await aberta();

    const painel = aviso();
    expect(within(painel as HTMLElement).getByText("Item de produto acabado inativo")).toBeInTheDocument();
    expect(painel).toHaveTextContent("PA-000009 Magnésio 60 caps (de PROD-000009)");
    expect(painel).toHaveTextContent("não é possível liberar a ordem até reativá-lo");
    expect(marcas("Item de produto acabado inativo")).toHaveLength(1);
    expect(marcas("Inativo")).toHaveLength(0);
  });

  it("rascunho com produto inativo: o aviso fala em planejar, e a opção do campo diz a situação", async () => {
    vi.mocked(getProductionOrder).mockResolvedValue(ordem("DRAFT", { productActive: false, finishedItemActive: true }));
    renderizar();
    await aberta();

    expect(aviso()).toHaveTextContent("não é possível planejar a ordem enquanto o produto estiver inativo.");
    const user = userEvent.setup();
    await user.click(document.getElementById("op-product") as HTMLInputElement);
    const opcao = await screen.findByRole("option", { name: /PROD-000009/ });
    expect(within(opcao).getByText("Inativo")).toBeInTheDocument();
  });

  it("liberada com produto e PA inativos: segue sem aviso, com as duas marcas", async () => {
    vi.mocked(getProductionOrder).mockResolvedValue(ordem("RELEASED", { productActive: false, finishedItemActive: false }));
    renderizar();
    await aberta();

    expect(aviso()).toBeNull();
    expect(marcas("Inativo")).toHaveLength(1);
    expect(marcas("Item de produto acabado inativo")).toHaveLength(1);
  });

  it("planejada com tudo ativo: nenhum aviso nem marca", async () => {
    vi.mocked(getProductionOrder).mockResolvedValue(ordem("PLANNED", { productActive: true, finishedItemActive: true }));
    renderizar();
    await aberta();

    expect(aviso()).toBeNull();
    expect(marcas("Inativo")).toHaveLength(0);
  });
});
