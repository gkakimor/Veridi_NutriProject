import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  CustomerOrderDTO,
  FulfillmentPlanDTO,
  PurchaseOrderDTO,
} from "@veridi/shared";

/**
 * Vírgula decimal nos dois documentos que movem dinheiro e quantidade.
 *
 * Num ERP inteiro em português a pessoa digita `0,85`. O contrato da API
 * fala com ponto, e enquanto a tradução não existia `Number("0,85")` era
 * `NaN` — que não falha, mente: some da soma, zera a comparação, desabilita
 * o botão. O erro que chegava era "Erro de validação", e quem o lia
 * redigitava o mesmo valor esperando outro resultado.
 *
 * Aqui a prova é sempre a mesma, em três tempos, por campo que decide um
 * número: `0,85` chega ao payload como `0.85`; `0.85` continua chegando; e
 * o que nem o parser lê produz a mensagem que CITA o separador — não a
 * frase genérica que não ensina nada.
 *
 * Os campos são controlados e alguns vivem dentro de diálogo: a digitação
 * tecla a tecla perde o foco no meio, então tudo aqui usa `fireEvent.change`.
 */

vi.mock("../lib/customer-orders-api", () => ({
  applyFulfillmentPlan: vi.fn(),
  cancelCustomerOrder: vi.fn(),
  confirmCustomerOrder: vi.fn(),
  createCustomerOrder: vi.fn(),
  createRemainderProductionOrder: vi.fn(),
  generatePurchaseDrafts: vi.fn(),
  getCustomerOrder: vi.fn(),
  getFulfillmentPlan: vi.fn(),
  getPlanPurchaseSourcing: vi.fn(),
  getPurchaseSuggestion: vi.fn(),
  updateCustomerOrder: vi.fn(),
}));
vi.mock("../lib/purchase-orders-api", () => ({
  cancelPurchaseOrder: vi.fn(),
  confirmPurchaseOrder: vi.fn(),
  createPurchaseOrder: vi.fn(),
  getPurchaseOrder: vi.fn(),
  updatePurchaseOrder: vi.fn(),
}));
vi.mock("../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../lib/products-api", () => ({ listProducts: vi.fn(), getProduct: vi.fn() }));
vi.mock("../lib/suppliers-api", () => ({ listSuppliers: vi.fn() }));
vi.mock("../lib/items-api", () => ({ listItems: vi.fn(), getItem: vi.fn() }));
vi.mock("../lib/supplier-items-api", () => ({ listSupplierItems: vi.fn() }));
vi.mock("../lib/shipments-api", () => ({
  createShipmentDraft: vi.fn(),
  getReservationStatus: vi.fn(),
  reallocateReservationLine: vi.fn(),
  reserveAvailable: vi.fn(),
}));

import {
  applyFulfillmentPlan,
  getCustomerOrder,
  getFulfillmentPlan,
  getPlanPurchaseSourcing,
  updateCustomerOrder,
} from "../lib/customer-orders-api";
import { getPurchaseOrder, updatePurchaseOrder } from "../lib/purchase-orders-api";
import { listCustomers } from "../lib/customers-api";
import { listProducts } from "../lib/products-api";
import { listSuppliers } from "../lib/suppliers-api";
import { listItems } from "../lib/items-api";
import { listSupplierItems } from "../lib/supplier-items-api";
import { getReservationStatus } from "../lib/shipments-api";
import { CustomerOrderPage } from "./customer-orders/CustomerOrderPage";
import { PurchaseOrderPage } from "./purchase-orders/PurchaseOrderPage";

/** O que a mensagem de recusa precisa ensinar. */
const CITA_O_SEPARADOR = /vírgula ou ponto para a casa decimal, sem separador de milhar/i;

/** O que a pessoa via antes e que não explicava nada. */
const FRASE_MUDA = "Erro de validação";

function pedido(overrides: Partial<CustomerOrderDTO> = {}): CustomerOrderDTO {
  return {
    id: "co-1",
    code: "PED-000001",
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "Vida Saudável Ltda",
    customerTradeName: "Vida Saudável",
    customerCnpj: null,
    customerAddress: {
      street: "Rua das Palmeiras",
      number: "120",
      complement: null,
      district: "Centro",
      zipCode: "13010-000",
      city: "Campinas",
      state: "SP",
    },
    orderDate: "2026-09-01T12:00:00.000Z",
    requestedDeliveryDate: null,
    status: "DRAFT",
    notes: null,
    lines: [
      {
        id: "col-1",
        productId: "prod-1",
        productCode: "PROD-000001",
        productName: "Whey Protein 900g",
        unitCode: "un",
        orderedQuantity: "10",
        shippedQuantity: "0",
        outstandingQuantity: "10",
        billedQuantity: "0",
        unbilledShippedQuantity: "0",
        reservedRemaining: "0",
        pendingProductionQuantity: "0",
        agreedPrice: null,
      },
    ],
    commercialOrigin: null,
    reservation: null,
    generatedProductionOrders: [],
    linkedPurchaseOrders: [],
    shipments: [],
    billings: [],
    billingStatus: "NOT_BILLED",
    confirmedAt: null,
    confirmedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  } as unknown as CustomerOrderDTO;
}

function ordemDeCompra(overrides: Partial<PurchaseOrderDTO> = {}): PurchaseOrderDTO {
  return {
    id: "po-1",
    code: "OC-000001",
    supplierId: "for-1",
    supplierCode: "FOR-000001",
    supplierName: "Insumos Brasil Ltda",
    supplierCnpj: null,
    orderDate: "2026-09-01T12:00:00.000Z",
    expectedDeliveryDate: null,
    status: "DRAFT",
    notes: null,
    lines: [
      {
        id: "pol-1",
        itemId: "item-1",
        itemCode: "MP-000001",
        itemName: "Maltodextrina",
        unitCode: "kg",
        orderedQuantity: "10",
        unitPrice: null,
        lineTotal: null,
        receivedQuantity: "0",
        openQuantity: "10",
      },
    ],
    orderTotal: null,
    origin: "MANUAL",
    customerOrderId: null,
    customerOrderCode: null,
    orderedAt: null,
    orderedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    receipts: [],
    ...overrides,
  } as unknown as PurchaseOrderDTO;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCustomers).mockResolvedValue({ customers: [] } as never);
  vi.mocked(listProducts).mockResolvedValue({ products: [] } as never);
  vi.mocked(listSuppliers).mockResolvedValue({ suppliers: [] } as never);
  vi.mocked(listItems).mockResolvedValue({ items: [] } as never);
  vi.mocked(listSupplierItems).mockResolvedValue({ supplierItems: [] } as never);
  vi.mocked(getReservationStatus).mockResolvedValue({ lines: [] } as never);
  vi.mocked(getPlanPurchaseSourcing).mockResolvedValue({ rows: [] } as never);
});

/* ------------------------------------------------------------------ *
 * Pedido do Cliente — a quantidade que o cliente comprou.
 * ------------------------------------------------------------------ */

describe("Pedido do Cliente — vírgula decimal", () => {
  function renderPedido() {
    render(
      <MemoryRouter initialEntries={["/comercial/pedidos/co-1"]}>
        <Routes>
          <Route path="/comercial/pedidos/:id" element={<CustomerOrderPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  /** A quantidade da única linha do pedido carregado. */
  async function campoDeQuantidade(): Promise<HTMLInputElement> {
    return (await screen.findByLabelText("Quantidade de PROD-000001")) as HTMLInputElement;
  }

  /** O que foi enviado em `lines[0]` na última chamada de atualização. */
  function primeiraLinhaEnviada(): { productId: string; orderedQuantity: string } {
    const [, payload] = vi.mocked(updateCustomerOrder).mock.calls.at(-1)!;
    return (payload as { lines: { productId: string; orderedQuantity: string }[] }).lines[0]!;
  }

  it("`0,85` chega ao payload como `0.85`", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(pedido());
    vi.mocked(updateCustomerOrder).mockResolvedValue(pedido());
    renderPedido();

    fireEvent.change(await campoDeQuantidade(), { target: { value: "0,85" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    await waitFor(() => expect(updateCustomerOrder).toHaveBeenCalled());
    expect(primeiraLinhaEnviada().orderedQuantity).toBe("0.85");
  });

  it("`0.85` continua entrando — o ponto nunca deixou de valer", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(pedido());
    vi.mocked(updateCustomerOrder).mockResolvedValue(pedido());
    renderPedido();

    fireEvent.change(await campoDeQuantidade(), { target: { value: "0.85" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    await waitFor(() => expect(updateCustomerOrder).toHaveBeenCalled());
    expect(primeiraLinhaEnviada().orderedQuantity).toBe("0.85");
  });

  it("valor ilegível nomeia o campo, cita o separador e não deixa a requisição sair", async () => {
    vi.mocked(getCustomerOrder).mockResolvedValue(pedido());
    renderPedido();

    // Separador de milhar é ambíguo de propósito: mil duzentos e trinta e
    // quatro ou um vírgula duzentos e trinta e quatro, e errar por mil em
    // silêncio seria pior do que recusar.
    fireEvent.change(await campoDeQuantidade(), { target: { value: "1.234,56" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    const alerta = await screen.findByText(CITA_O_SEPARADOR);
    expect(alerta.textContent).toContain("Quantidade de PROD-000001");
    expect(alerta.textContent).not.toContain(FRASE_MUDA);
    expect(updateCustomerOrder).not.toHaveBeenCalled();
  });

  it("o Plano de Atendimento soma o que foi digitado com vírgula, em vez de recusar o plano que fecha", async () => {
    const confirmado = pedido({ status: "CONFIRMED" });
    vi.mocked(getCustomerOrder).mockResolvedValue(confirmado);
    vi.mocked(applyFulfillmentPlan).mockResolvedValue(confirmado);
    vi.mocked(getFulfillmentPlan).mockResolvedValue({
      customerOrderId: "co-1",
      lines: [
        {
          customerOrderLineId: "col-1",
          productId: "prod-1",
          productCode: "PROD-000001",
          productName: "Whey Protein 900g",
          orderedQuantity: "10",
          unitCode: "un",
          finishedGoodsOnHand: "10",
          finishedGoodsReserved: "0",
          finishedGoodsAvailable: "10",
          suggestedReserveQuantity: "10",
          suggestedProductionQuantity: "0",
          situation: "ESTOQUE_SUFICIENTE",
        },
      ],
      materialImpact: [],
    } as unknown as FulfillmentPlanDTO);
    renderPedido();

    // Reservar 2,5 das 10 pedidas: o complemento a produzir é 7,5. Enquanto
    // isto era `Number("2,5")`, o complemento virava vazio, a soma virava
    // `NaN` e "Aplicar Plano" ficava desabilitado dizendo que as parcelas
    // não somavam o pedido — sem nunca mencionar a vírgula.
    fireEvent.change(await screen.findByLabelText("Reservar de PROD-000001"), {
      target: { value: "2,5" },
    });

    const produzir = screen.getByLabelText("Produzir de PROD-000001") as HTMLInputElement;
    expect(produzir.value).toBe("7.5");

    const aplicar = screen.getByRole("button", { name: "Aplicar Plano de Atendimento" });
    expect(aplicar).toBeEnabled();

    fireEvent.click(aplicar);
    fireEvent.click(await screen.findByRole("button", { name: "Aplicar Plano" }));

    await waitFor(() => expect(applyFulfillmentPlan).toHaveBeenCalled());
    const [, payload] = vi.mocked(applyFulfillmentPlan).mock.calls.at(-1)!;
    expect((payload as { lines: { reserveQuantity: string; produceQuantity: string }[] }).lines[0]).toMatchObject(
      { reserveQuantity: "2.5", produceQuantity: "7.5" },
    );
  });
});

/* ------------------------------------------------------------------ *
 * Ordem de Compra — o preço que a Veridi vai pagar.
 * ------------------------------------------------------------------ */

describe("Ordem de Compra — vírgula decimal", () => {
  function renderOC() {
    render(
      <MemoryRouter initialEntries={["/compras/ordens/po-1"]}>
        <Routes>
          <Route path="/compras/ordens/:id" element={<PurchaseOrderPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  async function campos(): Promise<{ quantidade: HTMLInputElement; preco: HTMLInputElement }> {
    const quantidade = (await screen.findByLabelText(
      "Quantidade de MP-000001",
    )) as HTMLInputElement;
    const preco = screen.getByLabelText("Preço unitário de MP-000001") as HTMLInputElement;
    return { quantidade, preco };
  }

  /** O que foi enviado em `lines[0]` na última chamada de atualização. */
  function primeiraLinhaEnviada(): { orderedQuantity: string; unitPrice?: string } {
    const [, payload] = vi.mocked(updatePurchaseOrder).mock.calls.at(-1)!;
    return (payload as { lines: { orderedQuantity: string; unitPrice?: string }[] }).lines[0]!;
  }

  it("`12,50` vira `12.50` no payload — e o total da linha é calculado antes de qualquer envio", async () => {
    vi.mocked(getPurchaseOrder).mockResolvedValue(ordemDeCompra());
    vi.mocked(updatePurchaseOrder).mockResolvedValue(ordemDeCompra());
    renderOC();

    const { quantidade, preco } = await campos();
    fireEvent.change(quantidade, { target: { value: "4" } });
    fireEvent.change(preco, { target: { value: "12,50" } });

    // A conta acontece no navegador, e é o primeiro lugar onde a vírgula
    // aparecia como mentira: a coluna Total virava "—" no exato momento em
    // que a pessoa terminava de digitar o preço.
    expect(await screen.findByText("R$ 50,00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    await waitFor(() => expect(updatePurchaseOrder).toHaveBeenCalled());
    expect(primeiraLinhaEnviada()).toMatchObject({
      orderedQuantity: "4",
      unitPrice: "12.50",
    });
  });

  it("`0,85` chega ao payload como `0.85`", async () => {
    vi.mocked(getPurchaseOrder).mockResolvedValue(ordemDeCompra());
    vi.mocked(updatePurchaseOrder).mockResolvedValue(ordemDeCompra());
    renderOC();

    const { quantidade, preco } = await campos();
    fireEvent.change(quantidade, { target: { value: "0,85" } });
    fireEvent.change(preco, { target: { value: "0,85" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    await waitFor(() => expect(updatePurchaseOrder).toHaveBeenCalled());
    expect(primeiraLinhaEnviada()).toMatchObject({
      orderedQuantity: "0.85",
      unitPrice: "0.85",
    });
  });

  it("`0.85` continua entrando — o ponto nunca deixou de valer", async () => {
    vi.mocked(getPurchaseOrder).mockResolvedValue(ordemDeCompra());
    vi.mocked(updatePurchaseOrder).mockResolvedValue(ordemDeCompra());
    renderOC();

    const { quantidade, preco } = await campos();
    fireEvent.change(quantidade, { target: { value: "0.85" } });
    fireEvent.change(preco, { target: { value: "0.85" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    await waitFor(() => expect(updatePurchaseOrder).toHaveBeenCalled());
    expect(primeiraLinhaEnviada()).toMatchObject({
      orderedQuantity: "0.85",
      unitPrice: "0.85",
    });
  });

  it("preço ilegível nomeia o item, cita o separador e a OC não é alterada", async () => {
    vi.mocked(getPurchaseOrder).mockResolvedValue(ordemDeCompra());
    renderOC();

    const { quantidade, preco } = await campos();
    fireEvent.change(quantidade, { target: { value: "4" } });
    fireEvent.change(preco, { target: { value: "1.234,56" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    const alerta = await screen.findByText(CITA_O_SEPARADOR);
    expect(alerta.textContent).toContain("Preço unitário de MP-000001");
    expect(alerta.textContent).not.toContain(FRASE_MUDA);
    expect(updatePurchaseOrder).not.toHaveBeenCalled();
  });

  it("preço em branco continua opcional — a OC salva sem custo e sem reclamar", async () => {
    vi.mocked(getPurchaseOrder).mockResolvedValue(ordemDeCompra());
    vi.mocked(updatePurchaseOrder).mockResolvedValue(ordemDeCompra());
    renderOC();

    const { quantidade } = await campos();
    fireEvent.change(quantidade, { target: { value: "7,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    await waitFor(() => expect(updatePurchaseOrder).toHaveBeenCalled());
    const linha = primeiraLinhaEnviada();
    expect(linha.orderedQuantity).toBe("7.5");
    expect(linha.unitPrice).toBeUndefined();
  });
});
