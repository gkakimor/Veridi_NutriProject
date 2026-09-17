import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ProductionOrderDTO } from "@veridi/shared";

/**
 * Componente da formulação inativado depois da ativação da receita —
 * PRODUCTION-INACTIVE-COMPONENT-GATE-01, §116.
 *
 * A ordem mostra a situação REAL de cada necessidade (`itemActive`), lida agora.
 * Rascunho e planejada avisam antes do clique que planejar e liberar vão ser
 * recusados, e nomeiam TODOS os componentes inativos de uma vez; liberada e em
 * execução seguem — só a marca na linha. Nada aqui desabilita botão: quem recusa
 * é a API, e a mensagem dela aparece inteira.
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

import { getProductionOrder, releaseProductionOrder } from "../../lib/production-orders-api";
import { ProductionOrderPage } from "./ProductionOrderPage";
import { PLANEJAMENTO_VAZIO } from "./planejamento-vazio";

type SituacaoDoComponente = { codigo: string; nome: string; ativo: boolean };

function necessidade(componente: SituacaoDoComponente, indice: number) {
  return {
    id: `req-${indice}`,
    itemId: `item-${indice}`,
    itemCode: componente.codigo,
    itemName: componente.nome,
    itemType: "RAW_MATERIAL",
    itemActive: componente.ativo,
    formulaQuantity: "2",
    formulaUnitCode: "kg",
    supplyResponsibility: "VERIDI",
    eligibleOwnerType: "VERIDI",
    eligibleOwnerCustomerId: null,
    eligibleOwnerCustomerName: null,
    requiredQuantity: "2",
    stockUnitCode: "kg",
    position: indice,
    onHand: "100",
    reserved: "0",
    available: "100",
    onOrder: "0",
    shortage: "0",
    availabilityStatus: "AVAILABLE",
    suggestedAllocations: [],
    allocatedQuantity: "0",
    consumedQuantity: "0",
    remainingReservedQuantity: "0",
    reservationLines: [],
    reconciliationStatus: "PENDING",
    unreconciledQuantity: "2",
    varianceReason: null,
    varianceAcceptedBy: null,
    varianceAcceptedAt: null,
  };
}

function ordem(
  status: ProductionOrderDTO["status"],
  componentes: SituacaoDoComponente[],
): ProductionOrderDTO {
  const liberada = status === "RELEASED" || status === "IN_PRODUCTION";
  return {
    id: "op-1",
    code: "OP-000001",
    productId: "prod-9",
    productCode: "PROD-000009",
    productName: "Magnésio 60 caps",
    productActive: true,
    finishedItemId: "pa-9",
    finishedItemCode: "PA-000009",
    finishedItemName: "Magnésio 60 caps",
    finishedItemActive: true,
    formulationVersionId: "fv-1",
    formulationVersionNumber: 2,
    formulationVersionLabel: "V2",
    plannedQuantity: "10",
    outputUnitCode: "un",
    productionFactor: null,
    planning: PLANEJAMENTO_VAZIO,
    status,
    origin: "MANUAL",
    materialsStatus: "AVAILABLE",
    shortageItemCount: 0,
    materialReconciliation: {
      totalRequirements: componentes.length,
      reconciledRequirements: 0,
      pendingRequirements: componentes.length,
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
    requirements: componentes.map(necessidade),
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

const ATIVO = { codigo: "MP-000001", nome: "MALTODEXTRINA", ativo: true };
const INATIVO = { codigo: "MP-000123", nome: "ÁCIDO ASCÓRBICO", ativo: false };
const OUTRO_INATIVO = { codigo: "ME-000045", nome: "POTE PET 500ML", ativo: false };

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
    .queryByText(/^(Componente inativo|Componentes inativos)$/, {
      selector: ".pendency-panel__title",
    })
    ?.closest(".pendency-panel") ?? null;
const marcas = () => screen.queryAllByText("Item inativo", { selector: ".badge.badge--inactive" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OP — componente da formulação inativado depois da ativação", () => {
  it("rascunho com um componente inativo: aviso de que planejar é recusado, com código e nome", async () => {
    vi.mocked(getProductionOrder).mockResolvedValue(ordem("DRAFT", [ATIVO, INATIVO]));
    renderizar();
    await aberta();

    const painel = aviso();
    expect(painel).not.toBeNull();
    expect(within(painel as HTMLElement).getByText("Componente inativo")).toBeInTheDocument();
    expect(painel).toHaveTextContent("MP-000123");
    expect(painel).toHaveTextContent("ÁCIDO ASCÓRBICO");
    expect(painel).toHaveTextContent("não é possível planejar a ordem enquanto o item estiver inativo");
    // O ativo não entra no aviso, e só a linha inativa ganha marca.
    expect(painel).not.toHaveTextContent("MP-000001");
    expect(marcas()).toHaveLength(1);
  });

  it("planejada com dois componentes inativos: o aviso nomeia os dois e fala em liberar", async () => {
    vi.mocked(getProductionOrder).mockResolvedValue(
      ordem("PLANNED", [INATIVO, ATIVO, OUTRO_INATIVO]),
    );
    renderizar();
    await aberta();

    const painel = aviso();
    expect(within(painel as HTMLElement).getByText("Componentes inativos")).toBeInTheDocument();
    expect(painel).toHaveTextContent("MP-000123");
    expect(painel).toHaveTextContent("ME-000045");
    expect(painel).toHaveTextContent("POTE PET 500ML");
    expect(painel).toHaveTextContent("não é possível liberar a ordem enquanto os itens estiverem inativos");
    // Ninguém precisa reativar um para descobrir o outro.
    expect(marcas()).toHaveLength(2);
  });

  it("liberada com componente inativo: segue operável, sem aviso, só com a marca", async () => {
    vi.mocked(getProductionOrder).mockResolvedValue(ordem("RELEASED", [ATIVO, INATIVO]));
    renderizar();
    await aberta();

    expect(aviso()).toBeNull();
    expect(marcas()).toHaveLength(1);
    // O histórico e a execução continuam à mão: nada some por causa da inativação.
    expect(screen.getByRole("link", { name: "Folha de Receita" })).toBeInTheDocument();
    expect(screen.getByText("OP 0001/2026")).toBeInTheDocument();
  });

  it("em execução com componente inativo: nada bloqueia e a marca permanece", async () => {
    vi.mocked(getProductionOrder).mockResolvedValue(ordem("IN_PRODUCTION", [INATIVO]));
    renderizar();
    await aberta();

    expect(aviso()).toBeNull();
    expect(marcas()).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Folha de Receita" })).toBeInTheDocument();
  });

  it("todos os componentes ativos: nenhum aviso nem marca", async () => {
    vi.mocked(getProductionOrder).mockResolvedValue(ordem("PLANNED", [ATIVO]));
    renderizar();
    await aberta();

    expect(aviso()).toBeNull();
    expect(marcas()).toHaveLength(0);
  });

  it("recusa da API na liberação: a mensagem específica do servidor aparece inteira", async () => {
    vi.mocked(getProductionOrder).mockResolvedValue(ordem("PLANNED", [ATIVO, INATIVO]));
    vi.mocked(releaseProductionOrder).mockRejectedValue(
      new Error(
        "a formulação V2 do produto PROD-000009 usa o item MP-000123 — ÁCIDO ASCÓRBICO, que está inativo. Reative o item no cadastro para liberar a ordem.",
      ),
    );
    renderizar();
    await aberta();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Liberar OP" }));
    await user.click(await screen.findByRole("button", { name: "Liberar" }));

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("a formulação V2 do produto PROD-000009");
    expect(alerta).toHaveTextContent("MP-000123 — ÁCIDO ASCÓRBICO");
    expect(alerta).toHaveTextContent("Reative o item no cadastro para liberar a ordem.");
  });
});
