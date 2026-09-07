import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  MaterialReservationLineDTO,
  ProductionOrderDTO,
  ProductionOrderRequirementDTO,
} from "@veridi/shared";

/**
 * F-08-1 — o número que a tela mostra tem que poder ser redigitado.
 *
 * A reserva vale `6.122448979592 kg`; `formatQuantity` corta em seis casas
 * com `ROUND_HALF_UP` e escreve `6,122449`. O exibido fica MAIOR que o real,
 * e a validação comparava com o real: o único valor que o operador não podia
 * digitar era o que estava impresso na frente dele.
 *
 * Arredondar o teto para baixo não resolveria — consumir menos deixa resíduo,
 * e `reconciliation.ts` não tem tolerância por decisão. A regra é o
 * round-trip: digitar o exibido significa "usar tudo", e o que vai para o
 * servidor é o valor canônico, com as doze casas.
 *
 * Este é o teste que faltava: nenhum outro monta a tela com uma reserva que
 * PRECISA de mais de seis casas.
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

import { getProductionOrder, recordConsumption } from "../../lib/production-orders-api";
import { ProductionOrderPage } from "./ProductionOrderPage";

const getProductionOrderMock = vi.mocked(getProductionOrder);
const recordConsumptionMock = vi.mocked(recordConsumption);

/** A reserva real da Taurina do cenário E2E-08, com pureza de 98 %. */
const RESERVA_CANONICA = "6.122448979592";
/** O que `formatQuantity` escreve na tela — arredondado para CIMA. */
const RESERVA_EXIBIDA = "6,122449";

function linhaDeReserva(quantidade: string): MaterialReservationLineDTO {
  return {
    id: "res-1",
    itemId: "item-1",
    itemCode: "MP-000167",
    itemName: "Taurina",
    lotId: "lot-1",
    lotCode: "LT-20260907-000002",
    supplierLot: "ACT-TAU-2026",
    expiryDate: null,
    location: null,
    lotStatus: "AVAILABLE",
    quantity: quantidade,
    unitCode: "kg",
    consumedQuantity: "0",
    remainingQuantity: quantidade,
    pickingStatus: "CONFIRMED",
    pickedAt: new Date().toISOString(),
    pickedBy: "Teste",
    releasedAt: null,
    releasedBy: null,
    releaseReason: null,
    replacesLineId: null,
    extraReason: null,
    extraRequestedBy: null,
    extraRequestedAt: null,
    lotFreeQuantity: "10",
  } as MaterialReservationLineDTO;
}

function requisito(quantidade: string): ProductionOrderRequirementDTO {
  return {
    id: "req-1",
    itemId: "item-1",
    itemCode: "MP-000167",
    itemName: "Taurina",
    itemType: "RAW_MATERIAL",
    formulaQuantity: "0.006122448979592",
    formulaUnitCode: "kg",
    supplyResponsibility: "VERIDI",
    eligibleOwnerType: "VERIDI",
    eligibleOwnerCustomerId: null,
    eligibleOwnerCustomerName: null,
    requiredQuantity: quantidade,
    stockUnitCode: "kg",
    position: 0,
    onHand: "7",
    reserved: quantidade,
    available: "7",
    onOrder: "0",
    shortage: "0",
    availabilityStatus: "AVAILABLE",
    suggestedAllocations: [],
    allocatedQuantity: quantidade,
    consumedQuantity: "0",
    remainingReservedQuantity: quantidade,
    reservationLines: [linhaDeReserva(quantidade)],
    reconciliationStatus: "PENDING_NONE",
    unreconciledQuantity: quantidade,
    varianceReason: null,
    varianceAcceptedBy: null,
    varianceAcceptedAt: null,
  } as unknown as ProductionOrderRequirementDTO;
}

function ordem(quantidade: string): ProductionOrderDTO {
  return {
    id: "op-1",
    code: "OP-000001",
    productId: "prod-1",
    productCode: "PROD-000215",
    productName: "Produto de Teste",
    finishedItemId: "pa-1",
    finishedItemCode: "PA-000215",
    finishedItemName: "Produto acabado",
    formulationVersionId: "fv-1",
    formulationVersionNumber: 1,
    formulationVersionLabel: "V1",
    plannedQuantity: "1000",
    outputUnitCode: "un",
    productionFactor: "1000",
    status: "IN_PRODUCTION",
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
    requirements: [requisito(quantidade)],
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
  return render(
    <MemoryRouter initialEntries={["/producao/ordens/op-1"]}>
      <Routes>
        <Route path="/producao/ordens/:id" element={<ProductionOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** A linha da tabela "Consumo Real" — localizada pelo seu próprio botão. */
async function linhaDeConsumo(): Promise<HTMLElement> {
  const botao = await screen.findByRole("button", { name: /^Confirmar consumo$/i });
  return botao.closest("tr") as HTMLElement;
}

/** O campo "Consumir agora" — único campo de texto daquela linha. */
async function campoDeConsumo(): Promise<HTMLInputElement> {
  return within(await linhaDeConsumo()).getByRole("textbox") as HTMLInputElement;
}

function botaoConfirmar(): HTMLButtonElement {
  return screen.getByRole("button", { name: /^Confirmar consumo$/i }) as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  getProductionOrderMock.mockResolvedValue(ordem(RESERVA_CANONICA));
  recordConsumptionMock.mockImplementation(async () => ordem(RESERVA_CANONICA));
});

describe("Consumo real — o valor exibido pode ser redigitado", () => {
  it("a tela mostra a reserva arredondada para seis casas", async () => {
    const { container } = renderizar();
    await waitFor(() => {
      expect(container.textContent).toContain(RESERVA_EXIBIDA);
    });
    // E não mostra as doze casas em lugar nenhum — é essa a premissa do bug.
    expect(container.textContent).not.toContain(RESERVA_CANONICA);
  });

  it("digitar exatamente o valor exibido habilita a confirmação", async () => {
    const usuario = userEvent.setup();
    renderizar();

    const campo = await campoDeConsumo();
    await usuario.type(campo, RESERVA_EXIBIDA);

    await waitFor(() => {
      expect(botaoConfirmar()).toBeEnabled();
    });
    expect(screen.queryByText(/Máximo disponível nesta reserva/i)).toBeNull();
  });

  it("confirmar envia o valor CANÔNICO, não o texto resumido", async () => {
    const usuario = userEvent.setup();
    renderizar();

    const campo = await campoDeConsumo();
    await usuario.type(campo, RESERVA_EXIBIDA);
    await usuario.click(botaoConfirmar());

    await waitFor(() => {
      expect(recordConsumptionMock).toHaveBeenCalledWith("op-1", [
        { reservationLineId: "res-1", quantity: RESERVA_CANONICA },
      ]);
    });
  });

  it("digitar menos continua sendo consumo parcial — não vira o máximo", async () => {
    const usuario = userEvent.setup();
    renderizar();

    const campo = await campoDeConsumo();
    await usuario.type(campo, "6,122448");
    await usuario.click(botaoConfirmar());

    await waitFor(() => {
      expect(recordConsumptionMock).toHaveBeenCalledWith("op-1", [
        { reservationLineId: "res-1", quantity: "6.122448" },
      ]);
    });
  });

  it("digitar o valor cru completo envia exatamente ele", async () => {
    const usuario = userEvent.setup();
    renderizar();

    const campo = await campoDeConsumo();
    await usuario.type(campo, RESERVA_CANONICA);
    await usuario.click(botaoConfirmar());

    await waitFor(() => {
      expect(recordConsumptionMock).toHaveBeenCalledWith("op-1", [
        { reservationLineId: "res-1", quantity: RESERVA_CANONICA },
      ]);
    });
  });

  it("acima do exibido continua bloqueado, com o motivo na linha", async () => {
    const usuario = userEvent.setup();
    renderizar();

    const campo = await campoDeConsumo();
    await usuario.type(campo, "6,122450");

    await waitFor(() => {
      expect(screen.getByText(/Máximo disponível nesta reserva/i)).toBeInTheDocument();
    });
    expect(botaoConfirmar()).toBeDisabled();
    expect(recordConsumptionMock).not.toHaveBeenCalled();
  });

  it("uma casa de 10⁻¹² acima do teto é bloqueada — sem tolerância", async () => {
    const usuario = userEvent.setup();
    renderizar();

    const campo = await campoDeConsumo();
    await usuario.type(campo, "6.122448979593");

    await waitFor(() => {
      expect(botaoConfirmar()).toBeDisabled();
    });
    expect(recordConsumptionMock).not.toHaveBeenCalled();
  });
});
