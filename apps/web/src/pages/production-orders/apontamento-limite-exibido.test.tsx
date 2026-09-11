import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ItemDTO, ProductionOrderDTO } from "@veridi/shared";

/**
 * O mesmo contrato do Consumo Real, agora no APONTAMENTO DE PRODUÇÃO.
 *
 * "Restante" é `planejado - produzido`, calculado em Decimal pelo servidor e
 * exibido com seis casas. A tela recalculava esse número por `Number` e
 * comparava o digitado contra ele — a conta certa refeita em ponto flutuante,
 * ao lado de um teto que o operador não conseguia redigitar.
 *
 * Aqui o teto é `7.000000000001` e a tela escreve `7`.
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

import { getProductionOrder, registerProductionOutput } from "../../lib/production-orders-api";
import { getItem } from "../../lib/items-api";
import { ProductionOrderPage } from "./ProductionOrderPage";
import { PLANEJAMENTO_VAZIO } from "./planejamento-vazio";

const getProductionOrderMock = vi.mocked(getProductionOrder);
const registerProductionOutputMock = vi.mocked(registerProductionOutput);
const getItemMock = vi.mocked(getItem);

const PLANEJADO = "10.000000000001";
const PRODUZIDO = "3";
/** `planejado - produzido`, como o servidor calcula. */
const RESTANTE_CANONICO = "7.000000000001";
/** O que `formatQuantity` escreve: seis casas, os zeros à direita saem. */
const RESTANTE_EXIBIDO = "7";

function itemAcabado(): ItemDTO {
  return {
    id: "pa-1",
    type: "FINISHED_PRODUCT",
    code: "PA-000031",
    name: "Produto acabado de teste",
    unitCode: "un",
    controlsLot: true,
    controlsExpiry: false,
    requiresQualityRelease: false,
    active: true,
  } as unknown as ItemDTO;
}

function ordem(): ProductionOrderDTO {
  return {
    id: "op-1",
    code: "OP-000001",
    productId: "prod-1",
    productCode: "PROD-000031",
    productName: "Produto de Teste",
    finishedItemId: "pa-1",
    finishedItemCode: "PA-000031",
    finishedItemName: "Produto acabado de teste",
    formulationVersionId: "fv-1",
    formulationVersionNumber: 1,
    formulationVersionLabel: "V1",
    plannedQuantity: PLANEJADO,
    outputUnitCode: "un",
    productionFactor: "1",
    planning: PLANEJAMENTO_VAZIO,
    status: "IN_PRODUCTION",
    origin: "MANUAL",
    materialsStatus: "MATERIALS_AVAILABLE",
    shortageItemCount: 0,
    materialReconciliation: {
      totalRequirements: 0,
      reconciledRequirements: 0,
      pendingRequirements: 0,
      canComplete: true,
    },
    notes: null,
    customerId: null,
    customerCode: null,
    customerName: null,
    hasCustomerSuppliedRequirements: false,
    requirements: [],
    outputs: [],
    consumptions: [],
    eligibleFinishedLots: [],
    parts: [],
    producedQuantity: PRODUZIDO,
    remainingQuantity: RESTANTE_CANONICO,
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

async function campoDeProducao(): Promise<HTMLInputElement> {
  return (await screen.findByLabelText(/Quantidade produzida/i)) as HTMLInputElement;
}

function botaoRegistrar(): HTMLButtonElement {
  return screen.getByRole("button", { name: /^Registrar produção$/i }) as HTMLButtonElement;
}

/** O lote é obrigatório para o botão acender — não é o que este teste mede. */
async function preencherLoteObrigatorio(usuario: ReturnType<typeof userEvent.setup>) {
  const lote = await screen.findByLabelText(/Lote Veridi/i);
  await usuario.type(lote, "LT-TESTE-001");
}

beforeEach(() => {
  vi.clearAllMocks();
  getProductionOrderMock.mockResolvedValue(ordem());
  getItemMock.mockResolvedValue(itemAcabado());
  registerProductionOutputMock.mockImplementation(async () => ordem());
});

describe("Apontamento de produção — o restante exibido pode ser redigitado", () => {
  it("a tela mostra o restante arredondado, não as doze casas", async () => {
    const { container } = renderizar();
    await campoDeProducao();
    // O bloco "Produção" escreve Planejado, Produzido e Restante pelo
    // `formatQuantity`: nenhum dos três aparece com as doze casas.
    expect(container.textContent).not.toContain(RESTANTE_CANONICO);
    expect(container.textContent).not.toContain(PLANEJADO);
  });

  it("digitar o restante exibido envia o valor canônico", async () => {
    const usuario = userEvent.setup();
    renderizar();

    const campo = await campoDeProducao();
    await usuario.type(campo, RESTANTE_EXIBIDO);
    await preencherLoteObrigatorio(usuario);

    await waitFor(() => expect(botaoRegistrar()).toBeEnabled());
    await usuario.click(botaoRegistrar());

    await waitFor(() => {
      expect(registerProductionOutputMock).toHaveBeenCalledWith(
        "op-1",
        expect.objectContaining({ quantity: RESTANTE_CANONICO }),
      );
    });
  });

  it("apontar menos continua sendo produção parcial — não vira o máximo", async () => {
    const usuario = userEvent.setup();
    renderizar();

    const campo = await campoDeProducao();
    await usuario.type(campo, "6,5");
    await preencherLoteObrigatorio(usuario);
    await usuario.click(botaoRegistrar());

    await waitFor(() => {
      expect(registerProductionOutputMock).toHaveBeenCalledWith(
        "op-1",
        expect.objectContaining({ quantity: "6.5" }),
      );
    });
  });

  it("acima do restante é bloqueado, com o máximo escrito por extenso", async () => {
    const usuario = userEvent.setup();
    renderizar();

    const campo = await campoDeProducao();
    await usuario.type(campo, "7,000001");

    await waitFor(() => {
      expect(screen.getByText(/Máximo 7 un/i)).toBeInTheDocument();
    });
    expect(botaoRegistrar()).toBeDisabled();
    expect(registerProductionOutputMock).not.toHaveBeenCalled();
  });

  it("uma casa de 10⁻¹² acima do restante é bloqueada — sem tolerância", async () => {
    const usuario = userEvent.setup();
    renderizar();

    const campo = await campoDeProducao();
    await usuario.type(campo, "7.000000000002");

    await waitFor(() => expect(botaoRegistrar()).toBeDisabled());
    expect(registerProductionOutputMock).not.toHaveBeenCalled();
  });
});
