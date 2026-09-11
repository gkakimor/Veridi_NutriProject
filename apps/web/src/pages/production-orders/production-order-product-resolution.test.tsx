import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ProductDTO, ProductionOrderDTO } from "@veridi/shared";

/**
 * Resolução do Produto na tela da Ordem de Produção.
 *
 * A tela carrega UMA página de 50 produtos para alimentar o campo de escolha.
 * Isso é carga de OPÇÕES. Durante muito tempo ela também era usada como fonte
 * de verdade: `activeProducts.find(p => p.id === productId)`. Com 214 produtos
 * aprovados no cadastro, 164 deles — 77% — ficam fora dessa primeira página
 * sob a ordenação por código. Abrir uma OP de qualquer um deles devolvia
 * `undefined`, o campo Produto aparecia vazio e a tela concluía "Produto sem
 * item de produto acabado válido" para uma ordem perfeitamente válida.
 *
 * O que estes testes protegem é a distinção: "não achei na página que
 * carreguei" nunca pode virar um veredito de domínio. A OP conhece o próprio
 * produto por identidade — `productId`, `productCode`, `productName` e
 * `finishedItemId` vêm no DTO dela —, e é dali que a tela responde. O bloqueio
 * verdadeiro (produto sem item de produto acabado) continua aparecendo.
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

import { getProductionOrder } from "../../lib/production-orders-api";
import { getProduct, listProducts } from "../../lib/products-api";
import { NotFoundApiError } from "../../lib/api-errors";
import { ProductionOrderPage } from "./ProductionOrderPage";
import { PLANEJAMENTO_VAZIO } from "./planejamento-vazio";

const getProductionOrderMock = vi.mocked(getProductionOrder);
const listProductsMock = vi.mocked(listProducts);
const getProductMock = vi.mocked(getProduct);

const MENSAGEM_SEM_PA = "Produto sem item de produto acabado válido.";

/** Código sequencial no formato do cadastro — a ordenação da listagem é por `code asc`. */
function codigo(posicao: number): string {
  return `PROD-${String(posicao).padStart(6, "0")}`;
}

function produto(posicao: number, comItemDeProdutoAcabado = true): ProductDTO {
  return {
    id: `prod-${posicao}`,
    code: codigo(posicao),
    name: `Produto ${posicao}`,
    customerId: null,
    customer: null,
    lifecycle: "APPROVED",
    originProjectId: null,
    originProjectCode: null,
    finishedProductItemId: comItemDeProdutoAcabado ? `pa-${posicao}` : null,
    finishedProductItem: comItemDeProdutoAcabado
      ? { id: `pa-${posicao}`, code: `PA-${String(posicao).padStart(6, "0")}`, name: `PA ${posicao}`, unitCode: "un" }
      : null,
    dosageForm: null,
    presentationType: null,
    capsulesPerDose: null,
    doseAmount: null,
    doseUomCode: null,
    dosesPerPackage: null,
    unitsPerShippingBox: null,
    targetAgeGroup: null,
    shelfLifeMonths: null,
    businessLotCode: null,
    minimumBatchQuantity: null,
    activeFormulationVersionId: null,
    activeFormulationVersionLabel: null,
    externalCode: null,
    notes: null,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as ProductDTO;
}

/** A primeira página real da tela: 50 produtos, posições 1..50. */
const PRIMEIRA_PAGINA = Array.from({ length: 50 }, (_, indice) => produto(indice + 1));

function ordemRascunho(alvo: { posicao: number; comItemDeProdutoAcabado?: boolean }): ProductionOrderDTO {
  const comPA = alvo.comItemDeProdutoAcabado ?? true;
  return {
    id: "op-1",
    code: "OP-000001",
    productId: `prod-${alvo.posicao}`,
    productCode: codigo(alvo.posicao),
    productName: `Produto ${alvo.posicao}`,
    finishedItemId: comPA ? `pa-${alvo.posicao}` : null,
    finishedItemCode: comPA ? `PA-${String(alvo.posicao).padStart(6, "0")}` : null,
    finishedItemName: comPA ? `PA ${alvo.posicao}` : null,
    formulationVersionId: null,
    formulationVersionNumber: null,
    formulationVersionLabel: null,
    plannedQuantity: "10",
    outputUnitCode: "un",
    productionFactor: null,
    planning: PLANEJAMENTO_VAZIO,
    status: "DRAFT",
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
    officialNumber: null,
    numberOfParts: 1,
    labelInstructions: null,
    shelfLifeMonths: null,
    suggestedBusinessLotNumber: null,
    productionOrderRevision: null,
    recipeSheetRevision: null,
    requirements: [],
    plannedAt: null,
    plannedBy: null,
    releasedAt: null,
    releasedBy: null,
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
  listProductsMock.mockResolvedValue({
    products: PRIMEIRA_PAGINA,
    total: 214,
    page: 1,
    pageSize: 50,
  } as Awaited<ReturnType<typeof listProducts>>);
});

describe("OP — Produto resolvido por identidade, não por página da listagem", () => {
  it("produto na posição 51 (fora da primeira página) não é acusado de estar sem item de produto acabado", async () => {
    getProductionOrderMock.mockResolvedValue(ordemRascunho({ posicao: 51 }));

    renderizar();

    expect(await screen.findByDisplayValue(`${codigo(51)} · Produto 51`)).toBeTruthy();
    expect(screen.queryByText(MENSAGEM_SEM_PA)).toBeNull();
  });

  it("produto na posição 214 — a quantidade de produtos no cadastro não muda o resultado", async () => {
    getProductionOrderMock.mockResolvedValue(ordemRascunho({ posicao: 214 }));

    renderizar();

    expect(await screen.findByDisplayValue(`${codigo(214)} · Produto 214`)).toBeTruthy();
    expect(screen.queryByText(MENSAGEM_SEM_PA)).toBeNull();
  });

  it("produto dentro da primeira página continua funcionando", async () => {
    getProductionOrderMock.mockResolvedValue(ordemRascunho({ posicao: 7 }));

    renderizar();

    expect(await screen.findByDisplayValue(`${codigo(7)} · Produto 7`)).toBeTruthy();
    expect(screen.queryByText(MENSAGEM_SEM_PA)).toBeNull();
  });

  it("resolve por ID, não por nome nem por código: nenhuma busca por texto é disparada", async () => {
    getProductionOrderMock.mockResolvedValue(ordemRascunho({ posicao: 51 }));

    renderizar();

    await screen.findByDisplayValue(`${codigo(51)} · Produto 51`);
    for (const chamada of listProductsMock.mock.calls) {
      expect(chamada[0]?.search).toBeUndefined();
    }
  });

  it("não faz requisição adicional de produto para o que a OP já sabe", async () => {
    getProductionOrderMock.mockResolvedValue(ordemRascunho({ posicao: 51 }));

    renderizar();

    await screen.findByDisplayValue(`${codigo(51)} · Produto 51`);
    expect(getProductMock).not.toHaveBeenCalled();
    // Uma única carga de opções — nunca uma varredura de páginas do catálogo.
    expect(listProductsMock).toHaveBeenCalledTimes(1);
    expect(listProductsMock.mock.calls[0]?.[0]?.pageSize).toBe(50);
  });
});

describe("OP — troca de produto no rascunho", () => {
  it("produto trocado por um achado na busca vale pelo registro escolhido, não pelo da ordem", async () => {
    const usuario = userEvent.setup();
    // A ordem aponta para um produto COM item de produto acabado; o escolhido
    // na busca não tem. O veredito tem que seguir o escolhido.
    getProductionOrderMock.mockResolvedValue(ordemRascunho({ posicao: 51 }));
    listProductsMock.mockImplementation(async (params) =>
      params?.search
        ? ({ products: [produto(198, false)], total: 1, page: 1, pageSize: 50 } as Awaited<
            ReturnType<typeof listProducts>
          >)
        : ({ products: PRIMEIRA_PAGINA, total: 214, page: 1, pageSize: 50 } as Awaited<
            ReturnType<typeof listProducts>
          >),
    );

    renderizar();

    const campo = await screen.findByDisplayValue(`${codigo(51)} · Produto 51`);
    await usuario.clear(campo);
    await usuario.type(campo, "Produto 198");
    await usuario.click(await screen.findByText(codigo(198)));

    expect(await screen.findByText(MENSAGEM_SEM_PA)).toBeTruthy();
  });
});

describe("OP — bloqueio verdadeiro preservado", () => {
  it("produto realmente sem item de produto acabado continua bloqueado", async () => {
    getProductionOrderMock.mockResolvedValue(
      ordemRascunho({ posicao: 51, comItemDeProdutoAcabado: false }),
    );

    renderizar();

    expect(await screen.findByText(MENSAGEM_SEM_PA)).toBeTruthy();
  });
});

describe("OP — estados distintos, nunca colapsados em 'produto inválido'", () => {
  it("enquanto carrega, a tela não emite veredito sobre o produto", async () => {
    let liberar: (order: ProductionOrderDTO) => void = () => {};
    getProductionOrderMock.mockReturnValue(
      new Promise<ProductionOrderDTO>((resolve) => {
        liberar = resolve;
      }),
    );

    renderizar();

    expect(screen.getByText("Carregando…")).toBeTruthy();
    expect(screen.queryByText(MENSAGEM_SEM_PA)).toBeNull();

    liberar(ordemRascunho({ posicao: 51 }));
    await screen.findByDisplayValue(`${codigo(51)} · Produto 51`);
  });

  it("ordem inexistente diz que a ORDEM não foi encontrada — não fala de produto", async () => {
    getProductionOrderMock.mockRejectedValue(new NotFoundApiError("Registro não encontrado."));

    renderizar();

    expect(await screen.findByText("Ordem de produção não encontrada")).toBeTruthy();
    expect(screen.queryByText(MENSAGEM_SEM_PA)).toBeNull();
  });

  it("falha de rede não vira 'ordem não encontrada' nem veredito sobre o produto", async () => {
    getProductionOrderMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderizar();

    expect(await screen.findByText("Não foi possível carregar a ordem de produção")).toBeTruthy();
    expect(screen.queryByText("Ordem de produção não encontrada")).toBeNull();
    expect(screen.queryByText(MENSAGEM_SEM_PA)).toBeNull();
  });

  it("erro de rede na carga de opções não bloqueia a OP já conhecida", async () => {
    getProductionOrderMock.mockResolvedValue(ordemRascunho({ posicao: 51 }));
    listProductsMock.mockRejectedValue(new TypeError("Failed to fetch"));

    renderizar();

    expect(await screen.findByDisplayValue(`${codigo(51)} · Produto 51`)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(MENSAGEM_SEM_PA)).toBeNull());
  });
});
