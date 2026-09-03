import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ProductionOrderDTO, ProductionOrderRequirementDTO } from "@veridi/shared";

/**
 * Reconciliação de material na tela da Ordem de Produção.
 *
 * O que estes testes protegem não é o layout, é a decisão: enquanto houver
 * material sem consumo e sem justificativa, a ordem não fecha — e a pessoa
 * precisa saber disso ANTES de clicar, com os nomes dos materiais à vista.
 *
 * A `OP-000001` da validação fechou com seis requisitos e um consumo porque a
 * tela oferecia o botão e o servidor aceitava. Aqui os dois lados dizem não.
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

import {
  acceptMaterialVariance,
  completeProductionOrder,
  getProductionOrder,
} from "../../lib/production-orders-api";
import { ProductionOrderPage } from "./ProductionOrderPage";

const getProductionOrderMock = vi.mocked(getProductionOrder);
const completeProductionOrderMock = vi.mocked(completeProductionOrder);
const acceptMaterialVarianceMock = vi.mocked(acceptMaterialVariance);

function requisito(
  overrides: Partial<ProductionOrderRequirementDTO> & { id: string; itemCode: string },
): ProductionOrderRequirementDTO {
  return {
    itemId: `item-${overrides.id}`,
    itemName: `Material ${overrides.itemCode}`,
    itemType: "RAW_MATERIAL",
    formulaQuantity: "2",
    formulaUnitCode: "kg",
    supplyResponsibility: "VERIDI",
    eligibleOwnerType: "VERIDI",
    eligibleOwnerCustomerId: null,
    eligibleOwnerCustomerName: null,
    requiredQuantity: "2",
    stockUnitCode: "kg",
    position: 0,
    onHand: "100",
    reserved: "2",
    available: "98",
    onOrder: "0",
    shortage: "0",
    availabilityStatus: "AVAILABLE",
    suggestedAllocations: [],
    allocatedQuantity: "2",
    consumedQuantity: "0",
    remainingReservedQuantity: "2",
    reservationLines: [],
    reconciliationStatus: "PENDING_NONE",
    unreconciledQuantity: "2",
    varianceReason: null,
    varianceAcceptedBy: null,
    varianceAcceptedAt: null,
    ...overrides,
  } as ProductionOrderRequirementDTO;
}

function ordem(requirements: ProductionOrderRequirementDTO[]): ProductionOrderDTO {
  const pendentes = requirements.filter(
    (requirement) =>
      requirement.reconciliationStatus === "PENDING_NONE" ||
      requirement.reconciliationStatus === "PENDING_PARTIAL",
  ).length;
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
    plannedQuantity: "10",
    outputUnitCode: "un",
    productionFactor: "1",
    status: "IN_PRODUCTION",
    origin: "MANUAL",
    materialsStatus: "MATERIALS_AVAILABLE",
    shortageItemCount: 0,
    materialReconciliation: {
      totalRequirements: requirements.length,
      reconciledRequirements: requirements.length - pendentes,
      pendingRequirements: pendentes,
      canComplete: pendentes === 0,
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
    requirements,
    outputs: [
      {
        id: "out-1",
        lotId: "lot-1",
        lotCode: "LT-20260903-000007",
        quantity: "10",
        producedAt: new Date().toISOString(),
        producedBy: "Teste",
        notes: null,
      },
    ],
    consumptions: [],
    eligibleFinishedLots: [],
    parts: [],
    producedQuantity: "10",
    remainingQuantity: "0",
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Ordem de Produção — reconciliação na tela", () => {
  it("mostra quais materiais faltam antes de qualquer clique", async () => {
    getProductionOrderMock.mockResolvedValue(
      ordem([
        requisito({ id: "1", itemCode: "MP-000001", consumedQuantity: "2", unreconciledQuantity: "0", reconciliationStatus: "RECONCILED" }),
        requisito({ id: "2", itemCode: "MP-000002" }),
        requisito({ id: "3", itemCode: "MP-000003" }),
      ]),
    );

    const { container } = renderizar();

    await waitFor(() => {
      expect(container.textContent).toContain("Falta reconciliar 2 materiais");
    });
    // Os nomes, não só a contagem: dizer quantos manda procurar, dizer quais
    // manda resolver.
    expect(container.textContent).toContain("MP-000002, MP-000003");
  });

  it("desabilita Concluir OP enquanto houver material pendente", async () => {
    getProductionOrderMock.mockResolvedValue(
      ordem([requisito({ id: "1", itemCode: "MP-000001" })]),
    );

    renderizar();

    const botao = await screen.findByRole("button", { name: "Concluir OP" });
    expect(botao).toBeDisabled();
  });

  it("libera Concluir OP quando tudo está reconciliado", async () => {
    getProductionOrderMock.mockResolvedValue(
      ordem([
        requisito({
          id: "1",
          itemCode: "MP-000001",
          consumedQuantity: "2",
          unreconciledQuantity: "0",
          reconciliationStatus: "RECONCILED",
        }),
      ]),
    );

    renderizar();

    const botao = await screen.findByRole("button", { name: "Concluir OP" });
    expect(botao).toBeEnabled();
  });

  it("mostra o progresso da reconciliação", async () => {
    getProductionOrderMock.mockResolvedValue(
      ordem([
        requisito({ id: "1", itemCode: "MP-000001", consumedQuantity: "2", unreconciledQuantity: "0", reconciliationStatus: "RECONCILED" }),
        requisito({ id: "2", itemCode: "MP-000002" }),
      ]),
    );

    renderizar();

    await waitFor(() => {
      expect(screen.getByText(/1 de 2 materiais reconciliados/)).toBeInTheDocument();
    });
  });

  it("distingue sem consumo de consumo parcial", async () => {
    getProductionOrderMock.mockResolvedValue(
      ordem([
        requisito({ id: "1", itemCode: "MP-000001" }),
        requisito({
          id: "2",
          itemCode: "MP-000002",
          consumedQuantity: "1",
          unreconciledQuantity: "1",
          reconciliationStatus: "PENDING_PARTIAL",
        }),
      ]),
    );

    const { container } = renderizar();

    await waitFor(() => {
      expect(container.textContent).toContain("Sem consumo");
    });
    expect(container.textContent).toContain("Consumo parcial");
  });

  it("mostra a justificativa aceita com quem aceitou", async () => {
    getProductionOrderMock.mockResolvedValue(
      ordem([
        requisito({
          id: "1",
          itemCode: "MP-000001",
          consumedQuantity: "1",
          unreconciledQuantity: "1",
          reconciliationStatus: "VARIANCE_ACCEPTED",
          varianceReason: "Sobra devolvida ao lote de origem",
          varianceAcceptedBy: "Ana",
          varianceAcceptedAt: new Date().toISOString(),
        }),
      ]),
    );

    const { container } = renderizar();

    await waitFor(() => {
      expect(container.textContent).toContain("Divergência justificada");
    });
    expect(container.textContent).toContain("Sobra devolvida ao lote de origem — Ana");
  });

  it("a ação de justificar é por linha e envia o motivo daquele material", async () => {
    const user = userEvent.setup();
    getProductionOrderMock.mockResolvedValue(
      ordem([
        requisito({ id: "1", itemCode: "MP-000001" }),
        requisito({ id: "2", itemCode: "MP-000002" }),
      ]),
    );
    acceptMaterialVarianceMock.mockResolvedValue(
      ordem([
        requisito({ id: "1", itemCode: "MP-000001", consumedQuantity: "2", unreconciledQuantity: "0", reconciliationStatus: "RECONCILED" }),
        requisito({ id: "2", itemCode: "MP-000002", consumedQuantity: "2", unreconciledQuantity: "0", reconciliationStatus: "RECONCILED" }),
      ]),
    );

    renderizar();

    // Uma ação por linha pendente — não uma ação de seção.
    const acoes = await screen.findAllByRole("button", { name: "Justificar diferença" });
    expect(acoes).toHaveLength(2);

    await user.click(acoes[1]!);
    expect(await screen.findByRole("heading", { name: /Justificar diferença em MP-000002/ })).toBeInTheDocument();

    // `fireEvent.change` em vez de digitar tecla a tecla: o diálogo devolve o
    // foco ao montar, e a digitação simulada perde o campo no meio da frase.
    // O que este teste prova é o envio do motivo daquela linha, não o
    // comportamento de foco.
    fireEvent.change(screen.getByLabelText(/Motivo da diferença/), {
      target: { value: "Perda no processo" },
    });
    await user.click(screen.getByRole("button", { name: "Registrar justificativa" }));

    await waitFor(() => {
      expect(acceptMaterialVarianceMock).toHaveBeenCalledWith("op-1", "2", "Perda no processo");
    });
  });

  it("o erro do servidor aparece dentro do diálogo de conclusão, não atrás dele", async () => {
    const user = userEvent.setup();
    getProductionOrderMock.mockResolvedValue(
      ordem([
        requisito({
          id: "1",
          itemCode: "MP-000001",
          consumedQuantity: "2",
          unreconciledQuantity: "0",
          reconciliationStatus: "RECONCILED",
        }),
      ]),
    );
    completeProductionOrderMock.mockRejectedValue(
      new Error("Existem materiais sem consumo confirmado: MP-000001 Material MP-000001."),
    );

    renderizar();

    await user.click(await screen.findByRole("button", { name: "Concluir OP" }));
    const dialogo = await screen.findByRole("alertdialog");
    await user.click(within(dialogo).getByRole("button", { name: "Concluir OP" }));

    // A mensagem tem que estar DENTRO do diálogo que continua aberto.
    await waitFor(() => {
      expect(within(dialogo).getByRole("alert")).toHaveTextContent(
        /Existem materiais sem consumo confirmado/,
      );
    });
  });
});
