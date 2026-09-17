import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ItemDTO, PurchaseOrderDTO } from "@veridi/shared";

/**
 * Receber OC de item ou fornecedor inativado DEPOIS da confirmação —
 * SUPPLIER-ITEM-INACTIVE-GATE-01, `PRODUCT_RULES.md` §112 (decisão D4 do PO).
 *
 * Inativar tira de compromisso NOVO; não cancela o que já foi assumido. A OC
 * confirmada antes continua podendo ser recebida (a prova com banco está em
 * `apps/api/src/modules/supplier-items/supplier-item-inactive-gate.test.ts`), e
 * a tela diz o que mudou desde a compra em vez de impedir a entrada do material
 * que está na doca.
 */

vi.mock("../../lib/purchase-orders-api", () => ({
  getPurchaseOrder: vi.fn(),
  listPurchaseOrders: vi.fn(),
}));
vi.mock("../../lib/items-api", () => ({ getItem: vi.fn(), listItems: vi.fn() }));
vi.mock("../../lib/receiving-api", () => ({ createReceipt: vi.fn() }));
vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: "ADMIN" } });
  return { useAuth: valor, useOptionalAuth: valor };
});

import { getPurchaseOrder, listPurchaseOrders } from "../../lib/purchase-orders-api";
import { getItem } from "../../lib/items-api";
import { ReceivePurchaseOrderPage } from "./ReceivePurchaseOrderPage";

function ordem(overrides: Partial<PurchaseOrderDTO> = {}): PurchaseOrderDTO {
  return {
    id: "po-1",
    code: "OC-000001",
    supplierId: "for-1",
    supplierCode: "FOR-000001",
    supplierName: "PURIFARMA",
    supplierCnpj: null,
    supplierActive: true,
    orderDate: "2026-09-01T00:00:00.000Z",
    expectedDeliveryDate: null,
    status: "ORDERED",
    notes: null,
    lines: [
      {
        id: "pol-1",
        itemId: "item-1",
        itemCode: "MP-000003",
        itemName: "Cafeína",
        unitCode: "kg",
        itemActive: true,
        orderedQuantity: "10",
        unitPrice: "12.5",
        lineTotal: "125.00",
        receivedQuantity: "0",
        openQuantity: "10",
      },
    ],
    orderTotal: "125.00",
    origin: "MANUAL",
    customerOrderId: null,
    customerOrderCode: null,
    orderedAt: "2026-09-02T00:00:00.000Z",
    orderedBy: "Compras",
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    receipts: [],
    ...overrides,
  };
}

const ITEM = {
  id: "item-1",
  code: "MP-000003",
  name: "Cafeína",
  type: "RAW_MATERIAL",
  unitCode: "kg",
  controlsLot: false,
  controlsExpiry: false,
  requiresQualityRelease: false,
  requiresCoa: false,
  active: false,
} as unknown as ItemDTO;

beforeEach(() => {
  vi.mocked(getPurchaseOrder).mockReset();
  vi.mocked(listPurchaseOrders).mockReset();
  vi.mocked(getItem).mockReset().mockResolvedValue(ITEM);
});

async function abrirOrdem(dto: PurchaseOrderDTO) {
  vi.mocked(listPurchaseOrders).mockResolvedValue({
    purchaseOrders: [dto],
    page: 1,
    pageSize: 20,
    total: 1,
  });
  vi.mocked(getPurchaseOrder).mockResolvedValue(dto);
  render(
    <MemoryRouter initialEntries={["/compras/recebimentos/novo"]}>
      <Routes>
        <Route path="/compras/recebimentos/novo" element={<ReceivePurchaseOrderPage />} />
        <Route path="/compras/recebimentos/:id" element={<p>Recebimento gravado</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(listPurchaseOrders).toHaveBeenCalled());
  const campo = screen.getByRole("combobox", { name: "Ordem de compra" });
  fireEvent.focus(campo);
  fireEvent.change(campo, { target: { value: "OC-000001" } });
  fireEvent.mouseDown(await screen.findByRole("option", { name: /OC-000001/ }));
  await screen.findByText(/^MP-000003 —/);
}

const confirmar = () => screen.getByRole("button", { name: /Confirmar recebimento/ });

describe("receber OC com cadastro inativado depois da confirmação", () => {
  it("fornecedor e item ativos: nenhuma marca de inativo na tela", async () => {
    await abrirOrdem(ordem());

    expect(screen.queryByText("Fornecedor inativo")).toBeNull();
    expect(screen.queryByText(/^Item inativo —/)).toBeNull();
  });

  it("fornecedor e item inativados depois: as marcas aparecem e o recebimento não é barrado", async () => {
    await abrirOrdem(
      ordem({
        supplierActive: false,
        lines: [{ ...ordem().lines[0]!, itemActive: false }],
      }),
    );

    expect(screen.getByText("Fornecedor inativo")).toBeInTheDocument();
    expect(screen.getByText(/^Item inativo —/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Receber agora/), { target: { value: "10" } });
    await waitFor(() =>
      expect(
        confirmar(),
        "o compromisso foi assumido antes da inativação: receber segue",
      ).toBeEnabled(),
    );
  });
});
