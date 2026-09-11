import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ProductionOrderDTO, ProductionOrderRequirementDTO } from "@veridi/shared";
import { helpHints } from "../../help/help-content";

/**
 * F-07-2 — dois números certos sob o mesmo rótulo.
 *
 * A auditoria viu, no mesmo instante, Cafeína com FÍSICO 15, RESERVADO 12 e
 * **DISPONÍVEL 15** na Ordem de Produção contra **Disponível 3** na Posição de
 * Estoque. A triagem leu o código e concluiu que a diferença é deliberada:
 * `requirement-availability.ts` soma de volta a reserva da própria ordem,
 * porque "a própria OP nunca compete contra si mesma" — senão o compromisso
 * dela viraria falta.
 *
 * Então o defeito nunca foi o número: era o rótulo dizer "Disponível" para
 * duas perguntas diferentes. É isso que este teste protege — a SEMÂNTICA.
 * Exigir que os dois números coincidam seria proteger o defeito oposto:
 * apagaria a regra de que uma ordem não disputa consigo mesma.
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

import { getProductionOrder } from "../../lib/production-orders-api";
import { ProductionOrderPage } from "./ProductionOrderPage";
import { PLANEJAMENTO_VAZIO } from "./planejamento-vazio";

/** A Cafeína exatamente como a auditoria a encontrou depois da liberação. */
function cafeina(): ProductionOrderRequirementDTO {
  return {
    id: "req-1",
    itemId: "item-1",
    itemCode: "MP-000001",
    itemName: "Cafeína anidra",
    itemType: "RAW_MATERIAL",
    formulaQuantity: "12",
    formulaUnitCode: "kg",
    supplyResponsibility: "VERIDI",
    eligibleOwnerType: "VERIDI",
    eligibleOwnerCustomerId: null,
    eligibleOwnerCustomerName: null,
    requiredQuantity: "12",
    stockUnitCode: "kg",
    position: 0,
    onHand: "15",
    reserved: "12",
    // 15, não 3: a reserva desta ordem volta para a conta dela.
    available: "15",
    onOrder: "0",
    shortage: "0",
    availabilityStatus: "AVAILABLE",
    suggestedAllocations: [],
    allocatedQuantity: "12",
    consumedQuantity: "0",
    remainingReservedQuantity: "12",
    reservationLines: [],
    reconciliationStatus: "PENDING_NONE",
    unreconciledQuantity: "12",
    varianceReason: null,
    varianceAcceptedBy: null,
    varianceAcceptedAt: null,
  } as unknown as ProductionOrderRequirementDTO;
}

function ordemLiberada(): ProductionOrderDTO {
  return {
    id: "op-1",
    code: "OP-000001",
    productId: "prod-1",
    productCode: "PROD-000215",
    productName: "Cafeína PT 60 caps",
    finishedItemId: "pa-1",
    finishedItemCode: "PA-000001",
    finishedItemName: "Produto acabado",
    formulationVersionId: "fv-1",
    formulationVersionNumber: 1,
    formulationVersionLabel: "V1",
    plannedQuantity: "1000",
    outputUnitCode: "un",
    productionFactor: "1",
    planning: PLANEJAMENTO_VAZIO,
    status: "RELEASED",
    origin: "MANUAL",
    materialsStatus: "MATERIALS_AVAILABLE",
    shortageItemCount: 0,
    materialReconciliation: {
      totalRequirements: 1,
      reconciledRequirements: 0,
      pendingRequirements: 1,
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
    requirements: [cafeina()],
    outputs: [],
    consumptions: [],
    eligibleFinishedLots: [],
    parts: [],
    producedQuantity: "0",
    remainingQuantity: "1000",
    reservation: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProductionOrder).mockResolvedValue(ordemLiberada());
});

describe("F-07-2 — o rótulo diz de quem é o disponível", () => {
  it("a coluna da ordem se nomeia como contextual, não como o disponível global", async () => {
    renderizar();

    const cabecalho = await screen.findByRole("columnheader", {
      name: /Disponível para esta OP/i,
    });
    expect(cabecalho).toBeTruthy();
    // O rótulo genérico, que era o defeito, não sobra na mesma tabela.
    expect(
      screen.queryByRole("columnheader", { name: /^Disponível$/i }),
    ).toBeNull();
  });

  it("o número da ordem continua o da ordem — a correção foi de rótulo, não de cálculo", async () => {
    renderizar();

    const linha = await screen.findByRole("row", { name: /MP-000001/ });
    // Físico 15, Reservado 12 e Disponível 15 no MESMO instante: é a regra de
    // que a ordem não compete contra a própria reserva, não uma divergência.
    expect(linha.textContent).toContain("15");
    expect(linha.textContent).toContain("12");
  });

  it("a ajuda da coluna explica por que a Posição de Estoque mostra menos", () => {
    const dica = helpHints["ordemProducao.disponivelParaEstaOP"];
    expect(dica.label).toMatch(/para esta OP/i);
    expect(dica.text).toMatch(/reserv/i);
    expect(dica.text).toMatch(/Posição de Estoque/i);
    // A regra que não pode ser reescrita sem passar por aqui.
    expect(dica.text).toMatch(/não compete contra a própria reserva/i);
  });
});
