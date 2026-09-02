import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { helpHints, helpTopics } from "../help/help-content";

/**
 * Ajuda contextual nas telas de negócio — o que se protege aqui é a LIGAÇÃO.
 *
 * O comportamento do painel (abre no teclado, devolve o foco, desenha o
 * fluxo) já tem suíte própria em `components/help/help-kit.test.tsx`. O que
 * pode quebrar sem ninguém perceber é outra coisa: a tela do Faturamento
 * exibindo a explicação da Formulação, o painel nascendo aberto e empurrando
 * a operação para baixo, ou a regra que motivou a ajuda — "reserva não
 * movimenta estoque físico", "não é Contas a Receber" — sendo reescrita até
 * deixar de dizer o que precisava dizer.
 */

vi.mock("../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));
vi.mock("../components/AttachmentsSection", () => ({ AttachmentsSection: () => null }));

vi.mock("../lib/products-api", () => ({
  getProduct: vi.fn(),
  listProducts: () => Promise.resolve({ products: [] }),
}));
vi.mock("../lib/formulations-api", () => ({
  listFormulationVersionsByProduct: vi.fn(),
  createFirstFormulationVersion: vi.fn(),
  createNewFormulationVersion: vi.fn(),
}));
vi.mock("../lib/formulation-templates-api", () => ({ applyTemplateToProduct: vi.fn() }));

vi.mock("../lib/customer-orders-api", () => ({
  getCustomerOrder: vi.fn(),
  getFulfillmentPlan: vi.fn(),
  getPlanPurchaseSourcing: vi.fn(),
  getPurchaseSuggestion: vi.fn(),
  applyFulfillmentPlan: vi.fn(),
  updateCustomerOrder: vi.fn(),
  confirmCustomerOrder: vi.fn(),
  cancelCustomerOrder: vi.fn(),
  createCustomerOrder: vi.fn(),
  generatePurchaseDrafts: vi.fn(),
  createRemainderProductionOrder: vi.fn(),
}));
vi.mock("../lib/customers-api", () => ({ listCustomers: () => Promise.resolve({ customers: [] }) }));
vi.mock("../lib/suppliers-api", () => ({ listSuppliers: () => Promise.resolve({ suppliers: [] }) }));
vi.mock("../lib/shipments-api", () => ({
  createShipmentDraft: vi.fn(),
  getReservationStatus: vi.fn(),
  reallocateReservationLine: vi.fn(),
  reserveAvailable: vi.fn(),
}));

vi.mock("../lib/production-orders-api", () => ({
  getProductionOrder: vi.fn(),
  updateProductionOrder: vi.fn(),
  planProductionOrder: vi.fn(),
  releaseProductionOrder: vi.fn(),
  cancelProductionOrder: vi.fn(),
  completeProductionOrder: vi.fn(),
  confirmPicking: vi.fn(),
  registerConsumption: vi.fn(),
  registerOutput: vi.fn(),
  addExtraReservation: vi.fn(),
  reallocatePickingLine: vi.fn(),
  substituteReservationLine: vi.fn(),
}));
vi.mock("../lib/items-api", () => ({ getItem: () => Promise.resolve(null), listItems: vi.fn() }));
vi.mock("../lib/costs-api", () => ({
  getProductionOrderMaterialCost: () => Promise.resolve(null),
  getItemCostReference: () => Promise.resolve(null),
  setAcquisitionCost: vi.fn(),
}));

vi.mock("../lib/billings-api", () => ({
  getBilling: vi.fn(),
  updateBilling: vi.fn(),
  issueBilling: vi.fn(),
  cancelBilling: vi.fn(),
  overrideBillingPrice: vi.fn(),
}));

vi.mock("../lib/product-cmv-api", () => ({ getProductCmv: vi.fn() }));
vi.mock("../lib/pricing-api", () => ({ getProductPricing: vi.fn() }));
vi.mock("../lib/industrial-costs-api", () => ({
  getProductIndustrialCosts: () => Promise.resolve({ current: null, draft: null }),
}));
vi.mock("../lib/cost-calculation-api", () => ({
  getProductionOrderCost: () => Promise.resolve(null),
  saveIndustrialCostCalculation: vi.fn(),
  discardIndustrialCostCalculation: vi.fn(),
}));

import { getProduct } from "../lib/products-api";
import { listFormulationVersionsByProduct } from "../lib/formulations-api";
import { getCustomerOrder, getFulfillmentPlan } from "../lib/customer-orders-api";
import { getProductionOrder } from "../lib/production-orders-api";
import { getBilling } from "../lib/billings-api";
import { getProductCmv } from "../lib/product-cmv-api";
import { getProductPricing } from "../lib/pricing-api";

import { FormulationDetailPage } from "./formulations/FormulationDetailPage";
import { CustomerOrderPage } from "./customer-orders/CustomerOrderPage";
import { ProductionOrderPage } from "./production-orders/ProductionOrderPage";
import { BillingPage } from "./billings/BillingPage";
import { ProductCmvPage } from "./product-cmv/ProductCmvPage";

function renderRota(path: string, url: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * O contrato do painel, verificado igual nas cinco telas: nasce fechado,
 * abre com o tópico daquela tela e fecha de novo.
 *
 * `regraEsperada` é literal de propósito. Reescrever a frase é permitido —
 * mas não em silêncio: a regra é o motivo pelo qual a ajuda existe, e quem
 * mexer nela precisa passar por aqui.
 */
async function verificaPainel(tituloEsperado: string, regraEsperada: RegExp) {
  const user = userEvent.setup();
  const gatilho = screen.getByRole("button", { name: /Como funciona/ });

  expect(gatilho).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("heading", { name: tituloEsperado })).toBeNull();

  await user.click(gatilho);

  expect(gatilho).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("heading", { name: tituloEsperado })).toBeInTheDocument();
  expect(screen.getByText(regraEsperada)).toBeInTheDocument();

  await user.click(gatilho);

  expect(gatilho).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("heading", { name: tituloEsperado })).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Formulação", () => {
  async function abrir() {
    vi.mocked(getProduct).mockResolvedValue({
      id: "prod-1",
      code: "PROD-000003",
      name: "Whey Protein DEMO",
      finishedProductItem: { id: "pa-1", code: "PA-000008", name: "Whey Protein DEMO" },
    } as never);
    vi.mocked(listFormulationVersionsByProduct).mockResolvedValue({ versions: [] } as never);

    renderRota(
      "/producao/formulacoes/:productId",
      "/producao/formulacoes/prod-1",
      <FormulationDetailPage />,
    );
    await waitFor(() => expect(screen.getByText("Formulação ativa")).toBeInTheDocument());
  }

  it("explica o ciclo da versão — e a explicação começa fechada", async () => {
    await abrir();

    await verificaPainel(
      helpTopics["formulacao.comoFunciona"].title,
      /depois de ativada ela não se altera/,
    );
  });

  it("mostra o fluxo até a precificação, na ordem em que ele acontece", async () => {
    await abrir();

    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    const fluxo = screen.getByRole("list", {
      name: `Fluxo: ${helpTopics["formulacao.comoFunciona"].title}`,
    });
    expect(
      Array.from(fluxo.querySelectorAll("li")).map((item) => item.textContent),
    ).toEqual(["Produto", "Formulação", "Versão ativa", "Estrutura de custos", "Cálculo", "Precificação"]);
  });
});

describe("Plano de Atendimento", () => {
  const MATERIAL = {
    itemId: "mp-1",
    itemCode: "MP-000006",
    itemName: "Celulose microcristalina 101",
    unitCode: "kg",
    requiredQuantity: "6.75",
    onHand: "0.71",
    reserved: "0",
    available: "0.71",
    onOrder: "0",
    shortage: "6.04",
    supplyResponsibility: "VERIDI",
    ownerCustomerId: null,
    ownerCustomerName: null,
    noEligibleOwner: false,
  };

  async function abrir() {
    vi.mocked(getCustomerOrder).mockResolvedValue({
      id: "ped-1",
      code: "PED-000003",
      customerId: "cli-1",
      customerCode: "CLI-000006",
      customerName: "IGEIA BELEZA E NUTRICAO LTDA",
      customerTradeName: "IGEIA",
      customerCnpj: null,
      customerAddress: { city: "SÃO PAULO", state: "SP" },
      orderDate: "2026-08-22T00:00:00.000Z",
      requestedDeliveryDate: null,
      status: "CONFIRMED",
      notes: null,
      lines: [],
      commercialOrigin: null,
      reservation: null,
      generatedProductionOrders: [],
      linkedPurchaseOrders: [],
      shipments: [],
      billings: [],
      billingStatus: "PENDING",
      confirmedAt: "2026-08-22T00:00:00.000Z",
      confirmedBy: "Admin",
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      createdAt: "2026-08-22T00:00:00.000Z",
      createdBy: "Admin",
      updatedAt: "2026-08-22T00:00:00.000Z",
    } as never);
    vi.mocked(getFulfillmentPlan).mockResolvedValue({
      customerOrderId: "ped-1",
      lines: [],
      materialImpact: [MATERIAL],
    } as never);

    renderRota("/comercial/pedidos/:id", "/comercial/pedidos/ped-1", <CustomerOrderPage />);
    await waitFor(() => expect(getFulfillmentPlan).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(/MP-000006/).length).toBeGreaterThan(0));
  }

  it("explica que o Plano é projeção — e a explicação começa fechada", async () => {
    await abrir();

    await verificaPainel(
      helpTopics["planoAtendimento.comoFunciona"].title,
      /Abrir o Plano não reserva nada/,
    );
  });

  it("cada coluna de quantidade do impacto de material tem o seu ⓘ", async () => {
    await abrir();

    // As cinco palavras que decidem a ação — e que não querem dizer a mesma
    // coisa. Sem elas explicadas, "disponível" é lido como "tem em estoque".
    for (const id of [
      "planoAtendimento.fisico",
      "planoAtendimento.reservado",
      "planoAtendimento.disponivel",
      "planoAtendimento.emCompra",
      "planoAtendimento.falta",
    ] as const) {
      expect(
        screen.getByRole("button", { name: `Ajuda sobre ${helpHints[id].label}` }),
      ).toBeInTheDocument();
    }
  });

  it("o ⓘ de Disponível diz que reserva já está descontada", async () => {
    await abrir();

    const dica = helpHints["planoAtendimento.disponivel"];
    expect(screen.queryByText(dica.text)).toBeNull();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: `Ajuda sobre ${dica.label}` }));

    expect(screen.getByText(dica.text)).toBeInTheDocument();
  });
});

describe("Ordem de Produção", () => {
  async function abrir() {
    vi.mocked(getProductionOrder).mockResolvedValue({
      id: "op-1",
      code: "OP-000002",
      officialNumber: "002/26",
      productionOrderRevision: "1",
      status: "IN_PRODUCTION",
      productId: "prod-1",
      productCode: "PROD-000006",
      productName: "Emagry Power Homem 60 cápsulas",
      customerId: null,
      customerCode: null,
      customerName: null,
      customerOrderId: null,
      customerOrderCode: null,
      customerOrderLineId: null,
      formulationVersionId: "fv-1",
      formulationVersionLabel: "V1",
      plannedQuantity: "150",
      producedQuantity: "0",
      outputUnitCode: "un",
      numberOfParts: 1,
      outputItemId: "pa-1",
      outputItemCode: "PA-000007",
      outputItemName: "Emagry Power Homem 60 cápsulas",
      requirements: [],
      consumptions: [],
      outputs: [],
      notes: null,
      plannedAt: null,
      releasedAt: "2026-08-21T01:00:00.000Z",
      completedAt: null,
      completionReason: null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      createdAt: "2026-08-21T00:00:00.000Z",
      createdBy: "Admin",
    } as never);

    renderRota("/producao/ordens/:id", "/producao/ordens/op-1", <ProductionOrderPage />);
    await waitFor(() => expect(getProductionOrder).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText("OP-000002").length).toBeGreaterThan(0));
  }

  it("separa reserva de consumo — e a explicação começa fechada", async () => {
    await abrir();

    await verificaPainel(
      helpTopics["ordemProducao.comoFunciona"].title,
      /Reserva não movimenta estoque físico/,
    );
  });

  it("diz que consumo além do reservado exige motivo registrado", async () => {
    await abrir();

    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    expect(screen.getByText(/consumo extra: é um ato à parte, com motivo obrigatório/)).toBeInTheDocument();
  });
});

describe("CMV", () => {
  async function abrir() {
    vi.mocked(getProductPricing).mockResolvedValue({
      productId: "prod-1",
      productCode: "PROD-000003",
      productName: "Whey Protein DEMO",
      draft: null,
      current: null,
      versions: [],
    } as never);
    vi.mocked(getProductCmv).mockResolvedValue({
      productId: "prod-1",
      productCode: "PROD-000003",
      productName: "Whey Protein DEMO",
      customerName: null,
      outputUomCode: "un",
      formulationVersionId: "form-1",
      formulationVersionNumber: 1,
      basisFormulationVersionId: "form-1",
      basisFormulationVersionNumber: 1,
      industrialCostVersionId: "ec-1",
      industrialCostVersionLabel: "EC-000001 · V1",
      referenceOutputQuantity: "1000",
      referenceOutputUomCode: "un",
      calculationId: null,
      calculationCode: null,
      calculationReferenceDate: null,
      referenceDate: "2026-08-18T00:00:00.000Z",
      live: null,
      simulation: null,
      unavailableReason: null,
      pricing: null,
    } as never);

    renderRota("/produtos/:productId/cmv", "/produtos/prod-1/cmv", <ProductCmvPage />);
    await waitFor(() => expect(getProductCmv).toHaveBeenCalled());
  }

  it("explica de onde o custo vem — e a explicação começa fechada", async () => {
    await abrir();

    await verificaPainel(
      helpTopics["cmv.comoFunciona"].title,
      /Material sem custo conhecido não vira zero/,
    );
  });

  it("diz que material do cliente não entra na aquisição da Veridi", async () => {
    await abrir();

    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    expect(screen.getByText(/fica fora da aquisição da Veridi/)).toBeInTheDocument();
  });
});

describe("Faturamento", () => {
  async function abrir() {
    vi.mocked(getBilling).mockResolvedValue({
      id: "fat-1",
      code: "FAT-000003",
      customerOrderId: "ped-1",
      customerOrderCode: "PED-000003",
      shipmentId: "exp-1",
      shipmentCode: "EXP-000005",
      shipmentDate: "2026-08-22T00:00:00.000Z",
      customerId: "cli-1",
      customerCode: "CLI-000006",
      customerName: "IGEIA BELEZA E NUTRICAO LTDA",
      customerTradeName: "IGEIA",
      customerCnpj: null,
      status: "DRAFT",
      externalReference: null,
      notes: null,
      lines: [],
      totalQuantity: "0",
      totalAmount: null,
      hasCompletePricing: false,
      issuedAt: null,
      issuedBy: null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      createdAt: "2026-08-22T00:00:00.000Z",
      createdBy: "Admin",
      updatedAt: "2026-08-22T00:00:00.000Z",
    } as never);

    renderRota("/comercial/faturamento/:id", "/comercial/faturamento/fat-1", <BillingPage />);
    await waitFor(() => expect(getBilling).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText("FAT-000003").length).toBeGreaterThan(0));
  }

  it("diz que não é Nota Fiscal nem Contas a Receber — e começa fechado", async () => {
    await abrir();

    await verificaPainel(
      helpTopics["faturamento.comoFunciona"].title,
      /Não é Contas a Receber/,
    );
  });

  it("diz que o preço vem do pedido e que alterá-lo exige motivo", async () => {
    await abrir();

    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    expect(screen.getByText(/preço unitário é herdado do pedido/)).toBeInTheDocument();
    expect(screen.getByText(/exige perfil comercial ou administrativo e motivo obrigatório/)).toBeInTheDocument();
  });
});
