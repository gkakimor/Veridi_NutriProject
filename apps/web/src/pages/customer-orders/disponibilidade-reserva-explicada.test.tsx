import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CustomerOrderDTO, ReservationStatusLineDTO } from "@veridi/shared";

/**
 * Reservar Produto Acabado — a ação bloqueada precisa dizer POR QUÊ.
 *
 * F-09-1: com a ordem concluída e mil unidades produzidas, a linha mostrava
 * "Falta reservar 1000 · Disponível agora 0" e o botão desabilitado, sem uma
 * palavra sobre a causa. A causa era legítima — o lote de produto acabado
 * nasce "Aguardando liberação" porque o produto exige liberação da Qualidade
 * —, e a Posição de Estoque já escrevia isso na própria linha. Só a tela do
 * Pedido não escrevia, e era nela que a pessoa estava.
 *
 * O que estes testes fixam:
 *
 * 1. **A ação continua bloqueada.** A correção não é habilitar o botão. Se o
 *    domínio diz indisponível, indisponível continua.
 * 2. **O motivo vem do domínio.** Os códigos de causa saem de
 *    `getUnavailabilityByItems` — o mesmo mecanismo da Posição de Estoque —
 *    e a tela apenas traduz. Nada é deduzido de `available === 0`.
 * 3. **Consulta que falhou não é estoque que falta.** Erro e carregamento têm
 *    texto próprio; afirmar "sem estoque" sobre uma requisição que não
 *    respondeu seria mentir com a cara de diagnóstico.
 */

vi.mock("../../lib/customer-orders-api", () => ({
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
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/products-api", () => ({ listProducts: vi.fn(), getProduct: vi.fn() }));
vi.mock("../../lib/suppliers-api", () => ({ listSuppliers: vi.fn() }));
vi.mock("../../lib/items-api", () => ({ listItems: vi.fn(), getItem: vi.fn() }));
vi.mock("../../lib/supplier-items-api", () => ({ listSupplierItems: vi.fn() }));
vi.mock("../../lib/shipments-api", () => ({
  createShipmentDraft: vi.fn(),
  getReservationStatus: vi.fn(),
  reallocateReservationLine: vi.fn(),
  reserveAvailable: vi.fn(),
}));

import {
  getCustomerOrder,
  getFulfillmentPlan,
  getPlanPurchaseSourcing,
  getPurchaseSuggestion,
} from "../../lib/customer-orders-api";
import { listCustomers } from "../../lib/customers-api";
import { listProducts } from "../../lib/products-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { listItems } from "../../lib/items-api";
import { listSupplierItems } from "../../lib/supplier-items-api";
import { getReservationStatus } from "../../lib/shipments-api";
import { CustomerOrderPage } from "./CustomerOrderPage";

function pedido(): CustomerOrderDTO {
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
    status: "IN_FULFILLMENT",
    notes: null,
    lines: [
      {
        id: "col-1",
        productId: "prod-1",
        productCode: "PROD-000215",
        productName: "Cafeína PT 60 caps",
        unitCode: "un",
        orderedQuantity: "1000",
        shippedQuantity: "0",
        outstandingQuantity: "1000",
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
  } as unknown as CustomerOrderDTO;
}

/**
 * Uma linha da análise como o servidor a entrega. Os números vêm do domínio
 * — `missingQuantity` e `unavailable` inclusive; a tela nunca os monta.
 */
function linha(overrides: Partial<ReservationStatusLineDTO> = {}): ReservationStatusLineDTO {
  return {
    customerOrderLineId: "col-1",
    productId: "prod-1",
    productCode: "PROD-000215",
    productName: "Cafeína PT 60 caps",
    itemId: "pa-1",
    unitCode: "un",
    orderedQuantity: "1000",
    shippedQuantity: "0",
    reservedRemaining: "0",
    stillToReserve: "1000",
    currentAvailable: "0",
    suggestedAdditionalReserve: "0",
    missingQuantity: "1000",
    unavailable: [{ reason: "AWAITING_QUALITY_RELEASE", quantity: "1000" }],
    ...overrides,
  };
}

function renderPedido() {
  render(
    <MemoryRouter initialEntries={["/comercial/pedidos/co-1"]}>
      <Routes>
        <Route path="/comercial/pedidos/:id" element={<CustomerOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** O botão que a auditoria encontrou morto. */
function botaoReservar(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Reservar disponível" }) as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCustomers).mockResolvedValue({ customers: [] } as never);
  vi.mocked(listProducts).mockResolvedValue({ products: [] } as never);
  vi.mocked(listSuppliers).mockResolvedValue({ suppliers: [] } as never);
  vi.mocked(listItems).mockResolvedValue({ items: [] } as never);
  vi.mocked(listSupplierItems).mockResolvedValue({ supplierItems: [] } as never);
  vi.mocked(getPlanPurchaseSourcing).mockResolvedValue({ rows: [] } as never);
  vi.mocked(getFulfillmentPlan).mockResolvedValue(null as never);
  vi.mocked(getPurchaseSuggestion).mockResolvedValue({
    customerOrderId: "co-1",
    rows: [],
    customerSuppliedRows: [],
    pendingProductionOrders: [],
  } as never);
  vi.mocked(getCustomerOrder).mockResolvedValue(pedido());
});

describe("F-09-1 — indisponibilidade explicada na Reserva de Produto Acabado", () => {
  it("mil produzidas e zero disponível: a ação segue bloqueada e o lote aguardando a Qualidade aparece", async () => {
    vi.mocked(getReservationStatus).mockResolvedValue({
      customerOrderId: "co-1",
      lines: [linha()],
    } as never);

    renderPedido();

    // O motivo autoritativo, com a mesma palavra que a Posição de Estoque usa.
    expect(await screen.findAllByText(/aguardando liberação da Qualidade/i)).not.toHaveLength(0);
    // A quantidade retida, formatada — nunca o decimal cru.
    expect(screen.getAllByText(/1000 un aguardando liberação da Qualidade/i)).not.toHaveLength(0);
    // Quanto falta para reservar tudo, dito pelo servidor.
    expect(screen.getByText(/faltam 1000 un de 1000 un/i)).toBeTruthy();

    // E continua bloqueada: a correção não libera nada.
    expect(botaoReservar().disabled).toBe(true);
    expect(botaoReservar().title).toMatch(/nenhuma linha tem produto disponível/i);
  });

  it("oferece o caminho para a informação, sem inventar workflow novo", async () => {
    vi.mocked(getReservationStatus).mockResolvedValue({
      customerOrderId: "co-1",
      lines: [linha()],
    } as never);

    renderPedido();

    const link = await screen.findByRole("link", { name: "Ver disponibilidade" });
    expect(link.getAttribute("href")).toBe("/estoque/pa-1");
  });

  it("tudo disponível: nenhum alerta falso e o botão habilitado", async () => {
    vi.mocked(getReservationStatus).mockResolvedValue({
      customerOrderId: "co-1",
      lines: [
        linha({
          currentAvailable: "1000",
          suggestedAdditionalReserve: "1000",
          missingQuantity: "0",
          unavailable: [],
        }),
      ],
    } as never);

    renderPedido();

    await waitFor(() => expect(botaoReservar().disabled).toBe(false));
    expect(screen.queryByText(/sem disponibilidade suficiente/i)).toBeNull();
    expect(screen.queryByText(/aguardando liberação da Qualidade/i)).toBeNull();
    expect(screen.queryByRole("link", { name: "Ver disponibilidade" })).toBeNull();
  });

  it("parcial: reserva o que existe e diz quanto ainda falta, com a causa", async () => {
    vi.mocked(getReservationStatus).mockResolvedValue({
      customerOrderId: "co-1",
      lines: [
        linha({
          currentAvailable: "400",
          suggestedAdditionalReserve: "400",
          missingQuantity: "600",
          unavailable: [{ reason: "RESERVED", quantity: "600" }],
        }),
      ],
    } as never);

    renderPedido();

    expect(await screen.findByText(/faltam 600 un de 1000 un/i)).toBeTruthy();
    expect(screen.getAllByText(/600 un reservado/i)).not.toHaveLength(0);
    // O que dá para reservar continua reservável — parcial não é bloqueio.
    await waitFor(() => expect(botaoReservar().disabled).toBe(false));
  });

  it("duas linhas: a mensagem aponta a que trava, não 'erro no estoque'", async () => {
    vi.mocked(getReservationStatus).mockResolvedValue({
      customerOrderId: "co-1",
      lines: [
        linha({
          customerOrderLineId: "col-1",
          productCode: "PROD-000215",
          productName: "Cafeína PT 60 caps",
          currentAvailable: "1000",
          suggestedAdditionalReserve: "1000",
          missingQuantity: "0",
          unavailable: [],
        }),
        linha({
          customerOrderLineId: "col-2",
          productId: "prod-2",
          productCode: "PROD-000216",
          productName: "Taurina PT 60 caps",
          itemId: "pa-2",
          currentAvailable: "0",
          suggestedAdditionalReserve: "0",
          missingQuantity: "1000",
          unavailable: [{ reason: "EXPIRED", quantity: "1000" }],
        }),
      ],
    } as never);

    renderPedido();

    const aviso = await screen.findByText(/1 produto sem disponibilidade suficiente/i);
    const bloco = aviso.closest(".callout")!;
    expect(bloco.textContent).toContain("PROD-000216");
    expect(bloco.textContent).not.toContain("PROD-000215");
    expect(bloco.textContent).toMatch(/1000 un vencido/i);
  });

  it("sem retenção nenhuma, a falta é dita como falta — não como lote preso", async () => {
    vi.mocked(getReservationStatus).mockResolvedValue({
      customerOrderId: "co-1",
      lines: [linha({ unavailable: [] })],
    } as never);

    renderPedido();

    expect(
      await screen.findByText(/ainda não foi produzida nem recebida/i),
    ).toBeTruthy();
  });
});

describe("F-09-1 — carregando e erro não viram diagnóstico de estoque", () => {
  it("enquanto consulta, diz que está verificando e não acusa falta", async () => {
    vi.mocked(getReservationStatus).mockReturnValue(new Promise(() => {}) as never);

    renderPedido();

    expect(await screen.findByText(/verificando a disponibilidade/i)).toBeTruthy();
    expect(screen.queryByText(/sem disponibilidade suficiente/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Reservar disponível" })).toBeNull();
  });

  it("consulta que falha diz que falhou — nunca 'sem estoque'", async () => {
    vi.mocked(getReservationStatus).mockRejectedValue(new Error("timeout"));

    renderPedido();

    const aviso = await screen.findByText(/não foi possível verificar a disponibilidade/i);
    expect(aviso.textContent).toMatch(/não significa que falta estoque/i);
    expect(screen.queryByText(/sem disponibilidade suficiente/i)).toBeNull();
  });
});
