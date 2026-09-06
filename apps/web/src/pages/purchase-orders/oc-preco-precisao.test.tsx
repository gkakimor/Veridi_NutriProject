import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PurchaseOrderDTO } from "@veridi/shared";

/**
 * Casa oculta do preço unitário da OC — PREC-MIG-P / `PRODUCT_RULES.md` §57.
 *
 * A coluna guarda oito casas desde o PREC-MIG-P. O risco que sobra é o da
 * tela: um campo que devolve ao servidor o que a máscara mostrou grava
 * `4,0532` no lugar de `4,05318764` sem que ninguém tenha editado nada, e o
 * número parece certo. Abrir, não editar e salvar tem de preservar o valor
 * exato, casa por casa.
 *
 * A leitura formatada continua sendo leitura: a OC confirmada mostra o preço
 * com as casas do formatter (apresentação), e isso não é o que se persiste.
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
        {
          id: "for-1",
          code: "FOR-000001",
          legalName: "Fornecedor Teste",
          tradeName: null,
          active: true,
        },
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

import { getPurchaseOrder, updatePurchaseOrder } from "../../lib/purchase-orders-api";
import { PurchaseOrderPage } from "./PurchaseOrderPage";

/** O preço do acceptance, como a API o serve: o scale da coluna. */
const PRECO_8_CASAS = "4.05318764";

function ordem(overrides: Partial<PurchaseOrderDTO> = {}): PurchaseOrderDTO {
  return {
    id: "oc-1",
    code: "OC-000001",
    supplierId: "for-1",
    supplierCode: "FOR-000001",
    supplierName: "Fornecedor Teste",
    supplierCnpj: null,
    orderDate: "2026-09-01T00:00:00.000Z",
    expectedDeliveryDate: null,
    status: "DRAFT",
    notes: null,
    lines: [
      {
        id: "pol-1",
        itemId: "item-1",
        itemCode: "MP-000001",
        itemName: "Vitamina C",
        unitCode: "kg",
        orderedQuantity: "10",
        unitPrice: PRECO_8_CASAS,
        // 10 × 4,05318764 = 40,53187640 → o documento fecha em 40,53.
        lineTotal: "40.53",
        receivedQuantity: "0",
        openQuantity: "10",
      },
    ],
    orderTotal: "40.53",
    origin: "MANUAL",
    customerOrderId: null,
    customerOrderCode: null,
    orderedAt: null,
    orderedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    receipts: [],
    ...overrides,
  } as PurchaseOrderDTO;
}

function abrir(dto = ordem()) {
  vi.mocked(getPurchaseOrder).mockResolvedValue(dto);
  return render(
    <MemoryRouter initialEntries={["/compras/ordens/oc-1"]}>
      <Routes>
        <Route path="/compras/ordens/:id" element={<PurchaseOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const precoDe = (codigo: string) =>
  screen.getByRole("textbox", { name: `Preço unitário de ${codigo}` }) as HTMLInputElement;

function payloadDoSalvamento() {
  return vi.mocked(updatePurchaseOrder).mock.calls[0]![1] as {
    lines: { orderedQuantity: string; unitPrice?: string }[];
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("preço unitário da OC preserva a casa oculta na tela", () => {
  it("o campo abre com as 8 casas, não com a máscara de 4", async () => {
    abrir();
    await screen.findByRole("heading", { level: 1, name: "OC-000001" });

    expect(precoDe("MP-000001").value).toBe(PRECO_8_CASAS);
    expect(precoDe("MP-000001").value).not.toBe("4.0532");
  });

  it("abrir, não editar e salvar devolve 4,05318764 — nunca 4,0532", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByRole("heading", { level: 1, name: "OC-000001" });
    vi.mocked(updatePurchaseOrder).mockResolvedValue(ordem());

    await user.click(screen.getByRole("button", { name: /Salvar rascunho/ }));

    await waitFor(() => expect(updatePurchaseOrder).toHaveBeenCalled());
    expect(payloadDoSalvamento().lines[0]).toMatchObject({
      orderedQuantity: "10",
      unitPrice: PRECO_8_CASAS,
    });
  });

  it("o total exibido fecha em 2 casas e não vira o preço enviado", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByRole("heading", { level: 1, name: "OC-000001" });
    // O rodapé mostra o documento fechado; o campo continua com o operando.
    // Moeda pt-BR sai com espaço fixo (`R$ `) — a leitura normaliza.
    const rodape = () =>
      (document.querySelector(".table-foot")?.textContent ?? "").replace(/[  ]/g, " ");
    await waitFor(() => expect(rodape()).toContain("Total (prévia): R$ 40,53"));
    vi.mocked(updatePurchaseOrder).mockResolvedValue(ordem());

    await user.click(screen.getByRole("button", { name: /Salvar rascunho/ }));

    await waitFor(() => expect(updatePurchaseOrder).toHaveBeenCalled());
    expect(payloadDoSalvamento().lines[0]!.unitPrice).toBe(PRECO_8_CASAS);
  });

  it("digitar em pt-BR com 8 casas chega ao servidor normalizado, sem cortar", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByRole("heading", { level: 1, name: "OC-000001" });
    fireEvent.change(precoDe("MP-000001"), { target: { value: "0,00000001" } });
    vi.mocked(updatePurchaseOrder).mockResolvedValue(ordem());

    await user.click(screen.getByRole("button", { name: /Salvar rascunho/ }));

    await waitFor(() => expect(updatePurchaseOrder).toHaveBeenCalled());
    expect(payloadDoSalvamento().lines[0]!.unitPrice).toBe("0.00000001");
  });

  it("OC confirmada: a leitura é formatada, e não existe caminho de volta", async () => {
    abrir(ordem({ status: "ORDERED" }));
    await screen.findByRole("heading", { level: 1, name: "OC-000001" });

    // Sem campo editável não há como a apresentação virar persistência —
    // o formatter da leitura é apresentação, PREC-FMT-01 segue fora daqui.
    expect(screen.queryByRole("textbox", { name: "Preço unitário de MP-000001" })).toBeNull();
    expect(screen.getByText("R$ 4,0532")).toBeTruthy();
  });
});
