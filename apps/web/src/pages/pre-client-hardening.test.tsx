import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { BillingDTO, BillingLineDTO, ReceiptDTO } from "@veridi/shared";

/**
 * Hardening pré-cliente — o que os três casos reais deixaram para trás.
 *
 * Cada teste aqui existe porque um número aparecia errado na tela, uma ação
 * era oferecida onde não deveria existir, ou um dado gravado não tinha onde
 * ser visto.
 */

vi.mock("../lib/billings-api", () => ({
  getBilling: vi.fn(),
  updateBilling: vi.fn(),
  issueBilling: vi.fn(),
  cancelBilling: vi.fn(),
  overrideBillingPrice: vi.fn(),
}));
vi.mock("../lib/receiving-api", () => ({ getReceipt: vi.fn() }));
vi.mock("../lib/costs-api", () => ({
  setAcquisitionCost: vi.fn(),
  getProductionOrderMaterialCost: () => Promise.resolve(null),
  getItemCostReference: () => Promise.resolve(null),
}));
vi.mock("../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));
vi.mock("../components/AttachmentsSection", () => ({ AttachmentsSection: () => null }));
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
  reserveAvailableFinishedGoods: vi.fn(),
  reallocateReservationLine: vi.fn(),
}));
vi.mock("../lib/customers-api", () => ({ listCustomers: () => Promise.resolve({ customers: [] }) }));
vi.mock("../lib/products-api", () => ({ listProducts: () => Promise.resolve({ products: [] }) }));
vi.mock("../lib/suppliers-api", () => ({ listSuppliers: () => Promise.resolve({ suppliers: [] }) }));
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
}));
vi.mock("../lib/cost-calculation-api", () => ({ getProductionOrderCost: () => Promise.resolve(null) }));
vi.mock("../lib/formulations-api", () => ({ listFormulationVersionsByProduct: () => Promise.resolve([]) }));
vi.mock("../lib/items-api", () => ({ getItem: () => Promise.resolve(null) }));
vi.mock("../lib/shipments-api", () => ({
  createShipmentDraft: vi.fn(),
  listShipments: vi.fn(),
}));

import { getBilling } from "../lib/billings-api";
import { getReceipt } from "../lib/receiving-api";
import { BillingPage } from "./billings/BillingPage";
import { ReceiptDetailPage } from "./receiving/ReceiptDetailPage";
import { getCustomerOrder, getFulfillmentPlan, getPlanPurchaseSourcing } from "../lib/customer-orders-api";
import { CustomerOrderPage } from "./customer-orders/CustomerOrderPage";
import { getProductionOrder } from "../lib/production-orders-api";
import { ProductionOrderPage } from "./production-orders/ProductionOrderPage";

function linhaDeFaturamento(overrides: Partial<BillingLineDTO> = {}): BillingLineDTO {
  return {
    id: "bl-1",
    shipmentLineId: "sl-1",
    customerOrderLineId: "col-1",
    productId: "prod-1",
    productCode: "PROD-000007",
    productName: "VAL-LEG-03 · Coenzima Q10 60 cápsulas",
    itemId: "item-1",
    itemCode: "PA-000008",
    itemName: "VAL-LEG-03 · Coenzima Q10 60 cápsulas",
    lotId: "lot-1",
    lotCode: "LT-20260822-000018",
    businessLotNumber: "L003-26",
    quantity: "300",
    unitCode: "un",
    // O acordado guarda 4 casas; a tela mostra 2.
    agreedUnitPrice: "5.5909",
    unitPrice: "5.5909",
    lineTotal: "1677.27",
    priceOverridden: false,
    overrideReason: null,
    overriddenBy: null,
    overriddenAt: null,
    position: 0,
    ...overrides,
  };
}

function faturamento(overrides: Partial<BillingDTO> = {}): BillingDTO {
  return {
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
    lines: [linhaDeFaturamento()],
    totalQuantity: "300",
    totalAmount: "1677.27",
    hasCompletePricing: true,
    issuedAt: null,
    issuedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-08-22T00:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

async function abrirFaturamento(dto: BillingDTO) {
  vi.mocked(getBilling).mockResolvedValue(dto);
  render(
    <MemoryRouter initialEntries={["/comercial/faturamento/fat-1"]}>
      <Routes>
        <Route path="/comercial/faturamento/:id" element={<BillingPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(getBilling).toHaveBeenCalled());
}

describe("Total do faturamento em rascunho", () => {
  it("o caso da auditoria: 5,5909 × 300 — linha e rodapé dizem o mesmo", async () => {
    await abrirFaturamento(faturamento());

    // Antes: a linha vinha do servidor (1.677,27) e o rodapé recalculava a
    // partir do preço já arredondado (300 × 5,59 = 1.677,00).
    await waitFor(() => expect(screen.getAllByText(/1\.677,27/).length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText(/1\.677,00/)).toBeNull();
  });

  it("9,7203 × 147 — o outro caso, mesma regra", async () => {
    await abrirFaturamento(
      faturamento({
        lines: [
          linhaDeFaturamento({
            quantity: "147",
            agreedUnitPrice: "9.7203",
            unitPrice: "9.7203",
            lineTotal: "1428.88",
          }),
        ],
        totalQuantity: "147",
        totalAmount: "1428.88",
      }),
    );

    await waitFor(() => expect(screen.getAllByText(/1\.428,88/).length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText(/1\.428,84/)).toBeNull();
  });

  it("linha sem preço acordado continua com prévia local do valor digitado", async () => {
    await abrirFaturamento(
      faturamento({
        lines: [linhaDeFaturamento({ agreedUnitPrice: null, unitPrice: null, lineTotal: null })],
        totalAmount: null,
        hasCompletePricing: false,
      }),
    );

    const campo = await screen.findByLabelText(/Preço faturado de PROD-000007/);
    fireEvent.change(campo, { target: { value: "2" } });
    await waitFor(() => expect(screen.getAllByText(/600,00/).length).toBeGreaterThanOrEqual(1));
  });
});

function recebimento(overrides: Partial<ReceiptDTO> = {}): ReceiptDTO {
  return {
    id: "rec-1",
    code: "REC-000010",
    sourceType: "CUSTOMER_SUPPLIED",
    purchaseOrderId: null,
    purchaseOrderCode: null,
    supplierId: null,
    supplierCode: null,
    supplierName: null,
    customerId: "cli-1",
    customerCode: "CLI-000006",
    customerName: "IGEIA BELEZA E NUTRICAO LTDA",
    receivedAt: "2026-08-22T00:00:00.000Z",
    invoiceNumber: null,
    documentReference: "Remessa IGEIA 0144/2026",
    notes: null,
    createdAt: "2026-08-22T00:00:00.000Z",
    createdBy: "Admin",
    lines: [
      {
        id: "rl-1",
        purchaseOrderLineId: null,
        itemId: "item-1",
        itemCode: "MP-000010",
        itemName: "Coenzima Q10",
        receivedQuantity: "2",
        unitCode: "kg",
        supplierLot: "IGEIA-CQ10-2410",
        expiryDate: "2028-06-30",
        location: "Almoxarifado MP / Cliente",
        lotId: "lot-1",
        lotCode: "LT-20260822-000014",
        ownerType: "CUSTOMER",
        coaStatus: "NOT_REQUIRED",
        purchaseUnitPrice: null,
        actualUnitCost: null,
        costUpdatedAt: null,
        costUpdatedBy: null,
        costNote: null,
      },
    ],
    ...overrides,
  } as ReceiptDTO;
}

async function abrirRecebimento(dto: ReceiptDTO) {
  vi.mocked(getReceipt).mockResolvedValue(dto);
  render(
    <MemoryRouter initialEntries={["/compras/recebimentos/rec-1"]}>
      <Routes>
        <Route path="/compras/recebimentos/:id" element={<ReceiptDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(getReceipt).toHaveBeenCalled());
}

describe("Recebimento de material do cliente", () => {
  it("não oferece definir custo — não existe aquisição Veridi para informar", async () => {
    await abrirRecebimento(recebimento());

    await screen.findByText(/MP-000010/);
    expect(screen.queryByRole("button", { name: /Definir custo/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Atualizar custo/ })).toBeNull();
    expect(screen.getByText("Material do cliente")).toBeTruthy();
  });

  it("diz 'Não aplicável', não 'Sem custo informado'", async () => {
    await abrirRecebimento(recebimento());

    await screen.findByText(/MP-000010/);
    expect(screen.getByText("Não aplicável")).toBeTruthy();
    expect(screen.queryByText("Sem custo informado")).toBeNull();
  });

  it("recebimento de compra da Veridi mantém a ação de custo", async () => {
    await abrirRecebimento(
      recebimento({
        sourceType: "PURCHASE_ORDER",
        customerId: null,
        customerCode: null,
        customerName: null,
        supplierId: "for-1",
        supplierCode: "FOR-000004",
        supplierName: "INTERLAB",
        lines: [{ ...recebimento().lines[0]!, ownerType: "VERIDI" }],
      }),
    );

    await screen.findByText(/MP-000010/);
    expect(screen.getByRole("button", { name: /Definir custo/ })).toBeTruthy();
    expect(screen.getByText("Sem custo informado")).toBeTruthy();
  });
});

function linhaDeMaterial(overrides: Record<string, unknown> = {}) {
  return {
    itemId: "mp-cliente",
    itemCode: "MP-000010",
    itemName: "Coenzima Q10",
    requiredQuantity: "1.836735",
    unitCode: "kg",
    onHand: "1.5",
    reserved: "0",
    available: "1.5",
    onOrder: "0",
    shortage: "0.336735",
    supplyResponsibility: "CUSTOMER",
    ownerCustomerId: "cli-1",
    ownerCustomerName: "IGEIA BELEZA E NUTRICAO LTDA",
    noEligibleOwner: false,
    ...overrides,
  };
}

async function abrirPedidoComPlano(materiais: Record<string, unknown>[]) {
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
    materialImpact: materiais,
  } as never);

  render(
    <MemoryRouter initialEntries={["/comercial/pedidos/ped-1"]}>
      <Routes>
        <Route path="/comercial/pedidos/:id" element={<CustomerOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(getFulfillmentPlan).toHaveBeenCalled());
}

describe("Plano de Atendimento — material do cliente", () => {
  it("diz de quem é o estoque, e não mostra 'em compra' para material do cliente", async () => {
    await abrirPedidoComPlano([linhaDeMaterial()]);

    await waitFor(() => expect(screen.getAllByText(/MP-000010/).length).toBeGreaterThan(0));
    expect(screen.getByText("Material do cliente")).toBeTruthy();
    expect(screen.getAllByText(/IGEIA BELEZA E NUTRICAO LTDA/).length).toBeGreaterThan(0);
  });

  it("falta de material do cliente não oferece compra da Veridi", async () => {
    await abrirPedidoComPlano([linhaDeMaterial()]);

    await waitFor(() => expect(screen.getAllByText(/MP-000010/).length).toBeGreaterThan(0));
    expect(screen.getByText(/Não há compra da/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ver sugestão de compra/ })).toBeNull();
  });

  it("falta de material Veridi oferece o caminho para Compras sem sair do Pedido", async () => {
    await abrirPedidoComPlano([
      linhaDeMaterial({
        itemId: "mp-veridi",
        itemCode: "MP-000006",
        itemName: "Celulose microcristalina 101",
        supplyResponsibility: "VERIDI",
        ownerCustomerId: null,
        ownerCustomerName: null,
        available: "0.71",
        shortage: "6.04",
      }),
    ]);

    await waitFor(() => expect(screen.getAllByText(/MP-000006/).length).toBeGreaterThan(0));
    const cta = screen.getByRole("button", { name: /Ver sugestão de compra/ });
    expect(cta).toBeTruthy();

    vi.mocked(getPlanPurchaseSourcing).mockResolvedValue({
      customerOrderId: "ped-1",
      rows: [
        {
          itemId: "mp-veridi",
          itemCode: "MP-000006",
          itemName: "Celulose microcristalina 101",
          unitCode: "kg",
          requiredQuantity: "6.75",
          available: "0.71",
          onOrder: "0",
          shortage: "6.04",
          supplierCandidates: [
            {
              supplierItemId: "si-1",
              supplierId: "for-1",
              supplierCode: "FOR-000004",
              supplierName: "INTERLAB",
              supplierItemCode: null,
              preferred: true,
              referenceUnitPrice: "26",
              referenceCurrencyCode: "BRL",
              referencePriceUomCode: "kg",
              referencePriceInItemUom: "26",
              minimumOrderQuantity: "1",
              minimumOrderUomCode: "kg",
              minimumOrderInItemUom: "1",
              recommendedPurchaseQuantity: "6.04",
              moqRaisedQuantity: false,
              hasLegacyPriceReference: false,
            },
          ],
          recommendedSupplierItemId: "si-1",
        },
      ],
      customerSuppliedShortages: [],
    } as never);

    fireEvent.click(cta);
    await waitFor(() => expect(getPlanPurchaseSourcing).toHaveBeenCalledWith("ped-1"));
    // Fornecedor, preço e MOQ chegam junto — o operador não redigita contexto.
    await screen.findByText(/INTERLAB/);
    expect(screen.getByText(/mínimo 1 kg/)).toBeTruthy();
    // Planejamento, não compra: nenhuma OC nasce daqui.
    expect(screen.getByText(/nenhuma Ordem de Compra é criada aqui/)).toBeTruthy();
  });
});

function linhaReserva(overrides: Record<string, unknown> = {}) {
  return {
    id: "rl-1",
    itemId: "mp-1",
    itemCode: "MP-000007",
    itemName: "Camomila em pó solúvel",
    lotId: "lot-1",
    lotCode: "LT-20260821-000012",
    supplierLot: "FRUTTIVEG-G01",
    expiryDate: "2029-06-30",
    location: "Almoxarifado MP",
    lotStatus: "AVAILABLE",
    quantity: "1",
    unitCode: "kg",
    consumedQuantity: "0",
    remainingQuantity: "1",
    pickingStatus: "CONFIRMED",
    pickedAt: "2026-08-21T01:12:00.000Z",
    pickedBy: "Admin (demo)",
    releasedAt: null,
    releasedBy: null,
    releaseReason: null,
    replacesLineId: null,
    extraReason: null,
    extraRequestedBy: null,
    extraRequestedAt: null,
    lotFreeQuantity: "5",
    ...overrides,
  };
}

async function abrirOrdem(reservationLines: Record<string, unknown>[]) {
  vi.mocked(getProductionOrder).mockResolvedValue({
    id: "op-1",
    code: "OP-000002",
    officialNumber: "002/26",
    productionOrderRevision: "1",
    status: "IN_PRODUCTION",
    productId: "prod-1",
    productCode: "PROD-000006",
    productName: "VAL-LEG-02 · Emagry Power Homem 60 cápsulas",
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
    outputItemName: "VAL-LEG-02 · Emagry Power Homem 60 cápsulas",
    requirements: [
      {
        id: "req-1",
        itemId: "mp-1",
        itemCode: "MP-000007",
        itemName: "Camomila em pó solúvel",
        itemType: "RAW_MATERIAL",
        requiredQuantity: "1",
        stockUnitCode: "kg",
        supplyResponsibility: "VERIDI",
        eligibleOwnerCustomerName: null,
        onHand: "5",
        reserved: "1",
        available: "5",
        onOrder: "0",
        shortage: "0",
        allocatedQuantity: "1",
        suggestedAllocations: [],
        reservationLines,
      },
    ],
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

  render(
    <MemoryRouter initialEntries={["/producao/ordens/op-1"]}>
      <Routes>
        <Route path="/producao/ordens/:id" element={<ProductionOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(getProductionOrder).toHaveBeenCalled());
}

describe("Consumo extra — auditoria visível", () => {
  it("o caso da auditoria: motivo, autor e data aparecem na linha ampliada", async () => {
    await abrirOrdem([
      linhaReserva(),
      linhaReserva({
        id: "rl-2",
        quantity: "0.005",
        remainingQuantity: "0.005",
        extraReason: "Ajuste operacional durante produção — VAL-LEG-02",
        extraRequestedBy: "Admin (demo)",
        extraRequestedAt: "2026-08-21T01:16:00.000Z",
      }),
    ]);

    // Antes: os três campos eram gravados e nenhuma tela os mostrava.
    // O texto quebra em vários nós (quantidade · motivo), então a asserção
    // olha o conteúdo renderizado, não um elemento único.
    await waitFor(() => expect(screen.getAllByText("Consumo extra").length).toBeGreaterThan(0));
    expect(document.body.textContent).toContain("Ajuste operacional durante produção — VAL-LEG-02");
    expect(document.body.textContent).toContain("+0,005 kg");
    expect(document.body.textContent).toContain("Admin (demo)");
  });

  it("linha normal não ganha campos vazios de auditoria", async () => {
    await abrirOrdem([linhaReserva()]);

    await waitFor(() => expect(screen.getAllByText(/MP-000007/).length).toBeGreaterThan(0));
    expect(screen.queryByText("Consumo extra")).toBeNull();
  });
});

describe("Consumo acima da reserva", () => {
  it("diz o limite antes do envio e desabilita o botão", async () => {
    await abrirOrdem([linhaReserva({ remainingQuantity: "0.145", quantity: "0.145" })]);

    await waitFor(() => expect(screen.getAllByText(/MP-000007/).length).toBeGreaterThan(0));
    const campo = screen.getAllByPlaceholderText("0")[0]!;
    fireEvent.change(campo, { target: { value: "0.15" } });

    // O servidor continua recusando; o que muda é o operador saber antes.
    await waitFor(() =>
      expect(screen.getByText(/Máximo disponível nesta reserva: 0.145 kg/)).toBeTruthy(),
    );
    expect(screen.getAllByText(/Adicionar consumo extra/).length).toBeGreaterThan(0);
    const confirmar = screen.getAllByRole("button", { name: /Confirmar consumo/ })[0] as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);
  });

  it("dentro da reserva o botão continua habilitado", async () => {
    await abrirOrdem([linhaReserva({ remainingQuantity: "0.145", quantity: "0.145" })]);

    await waitFor(() => expect(screen.getAllByText(/MP-000007/).length).toBeGreaterThan(0));
    fireEvent.change(screen.getAllByPlaceholderText("0")[0]!, { target: { value: "0.1" } });

    await waitFor(() => {
      const confirmar = screen.getAllByRole("button", { name: /Confirmar consumo/ })[0] as HTMLButtonElement;
      expect(confirmar.disabled).toBe(false);
    });
    expect(screen.queryByText(/Máximo disponível nesta reserva/)).toBeNull();
  });
});
