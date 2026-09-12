import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Outlet, Route, RouterProvider, createMemoryRouter, createRoutesFromElements } from "react-router-dom";
import type { PurchaseOrderDTO } from "@veridi/shared";

/**
 * A OC nova abre na data de HOJE da operação (PURCHASE-SUGGESTION-BUSINESS-DATE-01).
 *
 * O campo "Data do pedido" nascia com `new Date().toISOString().slice(0, 10)`
 * — o dia UTC. Entre 21:00 e 23:59 de São Paulo ele já vinha com AMANHÃ, e
 * quem salvasse sem olhar gravava a OC no dia seguinte. É a mesma falha da
 * Sugestão de Compra, do lado da tela.
 *
 * Só o `Date` é falso: o resto do teste (eventos, espera) roda no tempo real.
 */

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
      suppliers: [
        { id: "for-1", code: "FOR-000001", legalName: "Fornecedor Teste", tradeName: null, active: true },
      ],
    }),
}));
vi.mock("../../lib/supplier-items-api", () => ({
  listSupplierItems: () => Promise.resolve({ supplierItems: [] }),
}));
vi.mock("../../lib/items-api", () => ({
  listItems: () => Promise.resolve({ items: [] }),
  getItem: vi.fn(),
}));

import { createPurchaseOrder, getPurchaseOrder } from "../../lib/purchase-orders-api";
import { PurchaseOrderPage } from "./PurchaseOrderPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

async function abrirNovaEm(instante: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(instante));
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/compras/ordens/nova" element={<PurchaseOrderPage />} />
        <Route path="/compras/ordens/:id" element={<PurchaseOrderPage />} />
      </Route>,
    ),
    { initialEntries: ["/compras/ordens/nova"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "Nova ordem de compra" });
}

const dataDoPedido = () => screen.getByLabelText(/Data do pedido/) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Data do pedido da OC nova", () => {
  it("às 22:30 de São Paulo (01:30 UTC do dia seguinte) abre no dia comercial, não em amanhã", async () => {
    await abrirNovaEm("2026-09-12T01:30:00.000Z");
    expect(dataDoPedido()).toHaveValue("2026-09-11");
  });

  it("em horário diurno abre no mesmo dia", async () => {
    await abrirNovaEm("2026-09-11T15:00:00.000Z");
    expect(dataDoPedido()).toHaveValue("2026-09-11");
  });

  it("salvar sem mexer manda o marcador do dia comercial — não o dia UTC seguinte", async () => {
    await abrirNovaEm("2026-09-12T01:30:00.000Z");
    // Criar leva para `/compras/ordens/oc-1`, que carrega a OC gravada.
    const gravada = {
      id: "oc-1",
      code: "OC-000001",
      supplierId: "for-1",
      supplierCode: "FOR-000001",
      supplierName: "Fornecedor Teste",
      supplierCnpj: null,
      orderDate: "2026-09-11T00:00:00.000Z",
      expectedDeliveryDate: null,
      status: "DRAFT",
      notes: null,
      lines: [],
      orderTotal: null,
      origin: "MANUAL",
      customerOrderId: null,
      customerOrderCode: null,
      orderedAt: null,
      orderedBy: null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      receipts: [],
    } as unknown as PurchaseOrderDTO;
    vi.mocked(createPurchaseOrder).mockResolvedValue(gravada);
    vi.mocked(getPurchaseOrder).mockResolvedValue(gravada);

    const campo = document.getElementById("po-supplier") as HTMLInputElement;
    fireEvent.focus(campo);
    fireEvent.change(campo, { target: { value: "Fornecedor Teste" } });
    fireEvent.mouseDown(screen.getAllByRole("option", { name: /Fornecedor Teste/ })[0]!);

    await userEvent.setup().click(screen.getByRole("button", { name: /Salvar rascunho/ }));

    await waitFor(() => expect(createPurchaseOrder).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createPurchaseOrder).mock.calls[0]![0]).toMatchObject({
      orderDate: "2026-09-11T00:00:00.000Z",
    });
    await screen.findByRole("heading", { name: "OC-000001" });
  });
});
