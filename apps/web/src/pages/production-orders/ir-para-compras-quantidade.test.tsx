import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet, Route, RouterProvider, createMemoryRouter, createRoutesFromElements } from "react-router-dom";
import type { ItemDTO, ProductionOrderDTO, ProductionOrderRequirementDTO, PurchaseOrderDTO } from "@veridi/shared";

/**
 * "Ir para compras" leva a falta da OP à OC nova — VERIDI-AUDIT-QUICK-FIXES-01, D2.
 *
 * O atalho montava a URL com `formatQuantity(shortage)`, o número de LEITURA:
 * 1500 viajava como `1.500`, e a OC lia a URL como valor de máquina — ponto é
 * separador decimal —, então a linha nascia com 1,5. Falta de 1.000 ou mais
 * chegava à OC mil vezes menor, sem aviso.
 *
 * Ponta a ponta na web: a OP calcula a falta, o clique navega, a OC nova lê a
 * URL, e o que importa é o que a OC GRAVA — o `orderedQuantity` do payload.
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
  getItem: vi.fn(),
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
vi.mock("../../lib/purchase-orders-api", () => ({
  getPurchaseOrder: vi.fn(),
  updatePurchaseOrder: vi.fn(),
  createPurchaseOrder: vi.fn(),
  confirmPurchaseOrder: vi.fn(),
  cancelPurchaseOrder: vi.fn(),
}));
vi.mock("../../lib/suppliers-api", () => ({
  listSuppliers: () =>
    Promise.resolve({
      suppliers: [{ id: "for-1", code: "FOR-000001", legalName: "Fornecedor Teste", tradeName: null, active: true }],
    }),
}));
vi.mock("../../lib/supplier-items-api", () => ({
  listSupplierItems: () => Promise.resolve({ supplierItems: [] }),
}));

import { getItem } from "../../lib/items-api";
import { getProductionOrder } from "../../lib/production-orders-api";
import { createPurchaseOrder, getPurchaseOrder } from "../../lib/purchase-orders-api";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import { PurchaseOrderPage } from "../purchase-orders/PurchaseOrderPage";
import { ProductionOrderPage } from "./ProductionOrderPage";
import { PLANEJAMENTO_VAZIO } from "./planejamento-vazio";

/** A falta como a API a entrega: texto decimal canônico, nunca formatado. */
function requisito(shortage: string, unitCode: string): ProductionOrderRequirementDTO {
  return {
    id: "req-1",
    itemId: "item-1",
    itemCode: "MP-000001",
    itemName: "Colágeno hidrolisado",
    itemType: "RAW_MATERIAL",
    formulaQuantity: shortage,
    formulaUnitCode: unitCode,
    supplyResponsibility: "VERIDI",
    eligibleOwnerType: "VERIDI",
    eligibleOwnerCustomerId: null,
    eligibleOwnerCustomerName: null,
    requiredQuantity: shortage,
    stockUnitCode: unitCode,
    position: 0,
    onHand: "0",
    reserved: "0",
    available: "0",
    onOrder: "0",
    shortage,
    availabilityStatus: "SHORTAGE",
    suggestedAllocations: [],
    allocatedQuantity: "0",
    consumedQuantity: "0",
    remainingReservedQuantity: "0",
    reservationLines: [],
    reconciliationStatus: "PENDING_NONE",
    unreconciledQuantity: "0",
    varianceReason: null,
    varianceAcceptedBy: null,
    varianceAcceptedAt: null,
  } as unknown as ProductionOrderRequirementDTO;
}

/** OP planejada SEM Pedido: é o caso em que o atalho vai direto à OC nova. */
function ordemPlanejada(shortage: string, unitCode: string): ProductionOrderDTO {
  return {
    id: "op-1",
    code: "OP-000001",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Colágeno 300 g",
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
    status: "PLANNED",
    origin: "MANUAL",
    materialsStatus: "MATERIAL_SHORTAGE",
    shortageItemCount: 1,
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
    customerOrderId: null,
    hasCustomerSuppliedRequirements: false,
    requirements: [requisito(shortage, unitCode)],
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

function itemDaFalta(unitCode: string): ItemDTO {
  return {
    id: "item-1",
    code: "MP-000001",
    name: "Colágeno hidrolisado",
    unitCode,
    active: true,
  } as unknown as ItemDTO;
}

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

function abrirOp() {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/producao/ordens/:id" element={<ProductionOrderPage />} />
        <Route path="/compras/ordens/nova" element={<PurchaseOrderPage />} />
        <Route path="/compras/ordens/:id" element={<PurchaseOrderPage />} />
      </Route>,
    ),
    { initialEntries: ["/producao/ordens/op-1"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

function escolherFornecedor() {
  const campo = document.getElementById("po-supplier") as HTMLInputElement;
  fireEvent.focus(campo);
  fireEvent.change(campo, { target: { value: "Fornecedor Teste" } });
  fireEvent.mouseDown(screen.getAllByRole("option", { name: /Fornecedor Teste/ })[0]!);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createPurchaseOrder).mockResolvedValue({
    id: "oc-1",
    code: "OC-000001",
    status: "DRAFT",
    lines: [],
  } as unknown as PurchaseOrderDTO);
  vi.mocked(getPurchaseOrder).mockResolvedValue({
    id: "oc-1",
    code: "OC-000001",
    supplierId: "for-1",
    supplierCode: "FOR-000001",
    supplierName: "Fornecedor Teste",
    supplierActive: true,
    orderDate: "2026-09-19T00:00:00.000Z",
    expectedDeliveryDate: null,
    status: "DRAFT",
    notes: null,
    lines: [],
    orderTotal: null,
    origin: "MANUAL",
    receipts: [],
  } as unknown as PurchaseOrderDTO);
});

describe("D2 — a falta chega à OC com o valor de máquina, nunca o de leitura", () => {
  it.each([
    { caso: "999 (sem milhar)", shortage: "999", unidade: "kg", esperado: "999" },
    { caso: "1000", shortage: "1000", unidade: "kg", esperado: "1000" },
    { caso: "1500", shortage: "1500", unidade: "kg", esperado: "1500" },
    { caso: "10000", shortage: "10000", unidade: "kg", esperado: "10000" },
    { caso: "decimal legítimo", shortage: "12.5", unidade: "kg", esperado: "12.5" },
    { caso: "decimal com milhar", shortage: "1234.567", unidade: "kg", esperado: "1234.567" },
    { caso: "unidade COUNT", shortage: "2000", unidade: "un", esperado: "2000" },
    { caso: "unidade MASS em grama", shortage: "1500", unidade: "g", esperado: "1500" },
  ])("$caso: falta $shortage $unidade vira linha da OC com $esperado", async ({ shortage, unidade, esperado }) => {
    vi.mocked(getProductionOrder).mockResolvedValue(ordemPlanejada(shortage, unidade));
    vi.mocked(getItem).mockResolvedValue(itemDaFalta(unidade));
    const router = abrirOp();

    await userEvent.setup().click(await screen.findByRole("button", { name: "Ir para compras" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/compras/ordens/nova"));
    const naUrl = new URLSearchParams(router.state.location.search).get("quantidade");

    await screen.findByRole("textbox", { name: "Quantidade de MP-000001" });
    escolherFornecedor();
    await userEvent.setup().click(screen.getByRole("button", { name: /Salvar rascunho/ }));

    await waitFor(() => expect(createPurchaseOrder).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(createPurchaseOrder).mock.calls[0]![0] as { lines: { itemId: string; orderedQuantity: string }[] };
    // O que a OC grava: a falta inteira, na unidade da OP.
    expect(payload.lines, `OC gravada para a falta ${shortage} ${unidade}`).toEqual([
      { itemId: "item-1", orderedQuantity: esperado },
    ]);
    // A URL carrega o número que a API calculou, sem agrupamento de milhar.
    expect(naUrl, `URL para a falta ${shortage} ${unidade}`).toBe(shortage);
  });
});
