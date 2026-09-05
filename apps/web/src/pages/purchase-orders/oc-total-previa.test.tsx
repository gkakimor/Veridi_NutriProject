import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PurchaseOrderDTO } from "@veridi/shared";
import { ApiValidationError } from "../../lib/api-errors";

/**
 * O total da OC em edição é PRÉVIA do que está na tela (BACKLOG #8A).
 *
 * Antes, numa OC gravada, as linhas recalculavam ao digitar e o rodapé
 * mostrava o `orderTotal` do último salvamento: número vivo ao lado de
 * número velho. Agora a linha, o rodapé e o documento passam pela mesma
 * função (`calcularTotaisOrdemCompra`, em Decimal); o gravado só aparece
 * quando difere, dito como gravado.
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
      suppliers: [{ id: "for-1", code: "FOR-000001", legalName: "Fornecedor Teste", tradeName: null, active: true }],
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

function linha(overrides: Partial<PurchaseOrderDTO["lines"][number]> = {}): PurchaseOrderDTO["lines"][number] {
  return {
    id: "pol-1",
    itemId: "item-1",
    itemCode: "MP-000001",
    itemName: "Vitamina C",
    unitCode: "kg",
    orderedQuantity: "10",
    unitPrice: "12.5000",
    lineTotal: "125.00",
    receivedQuantity: "0",
    openQuantity: "10",
    ...overrides,
  };
}

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
      linha(),
      linha({ id: "pol-2", itemId: "item-2", itemCode: "MP-000002", itemName: "Magnésio", orderedQuantity: "4", unitPrice: "4.0531", lineTotal: "16.21", openQuantity: "4" }),
    ],
    // 125,00 + 16,2124 = 141,2124 → 141,21
    orderTotal: "141.21",
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
  const utils = render(
    <MemoryRouter initialEntries={["/compras/ordens/oc-1"]}>
      <Routes>
        <Route path="/compras/ordens/:id" element={<PurchaseOrderPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return utils;
}

const quantidadeDe = (codigo: string) =>
  screen.getByRole("textbox", { name: `Quantidade de ${codigo}` }) as HTMLInputElement;
const precoDe = (codigo: string) =>
  screen.getByRole("textbox", { name: `Preço unitário de ${codigo}` }) as HTMLInputElement;
/** Moeda sai com espaço fixo (`R$ `); a leitura compara com espaço comum. */
const texto = (el: Element | null) => (el?.textContent ?? "").replace(/ /g, " ");
const rodape = () => texto(document.querySelector(".table-foot"));
const totalDaLinha = (codigo: string) => {
  const linhaDaTabela = quantidadeDe(codigo).closest("tr")!;
  const celulas = within(linhaDaTabela).getAllByRole("cell");
  return texto(celulas[4]!);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Total da OC em edição é prévia da tela", () => {
  it("abre com a prévia igual ao gravado — sem aviso de diferença", async () => {
    abrir();
    await screen.findByRole("heading", { level: 1, name: "OC-000001" });
    await waitFor(() => expect(rodape()).toContain("Total (prévia): R$ 141,21"));
    expect(rodape()).not.toContain("Gravado");
    expect(totalDaLinha("MP-000001")).toBe("R$ 125,00");
    expect(totalDaLinha("MP-000002")).toBe("R$ 16,21");
  });

  it("A/C. quantidade muda → subtotal da linha e total mudam juntos; o gravado aparece rotulado", async () => {
    abrir();
    await screen.findByRole("heading", { level: 1, name: "OC-000001" });
    fireEvent.change(quantidadeDe("MP-000001"), { target: { value: "20" } });

    expect(totalDaLinha("MP-000001")).toBe("R$ 250,00");
    // 250 + 16,2124 = 266,2124 → 266,21
    expect(rodape()).toContain("Total (prévia): R$ 266,21");
    expect(rodape()).toContain("Gravado: R$ 141,21");
    expect(rodape()).toContain("salve o rascunho");
  });

  it("B/E. preço com 4 casas muda o subtotal sem perder casa", async () => {
    abrir();
    await screen.findByRole("heading", { level: 1, name: "OC-000001" });
    fireEvent.change(precoDe("MP-000002"), { target: { value: "4,0531" } });
    fireEvent.change(quantidadeDe("MP-000002"), { target: { value: "1000" } });

    expect(totalDaLinha("MP-000002")).toBe("R$ 4.053,10");
    expect(rodape()).toContain("Total (prévia): R$ 4.178,10");
  });

  it("D. várias linhas somam em decimal, nunca em ponto flutuante", async () => {
    abrir(
      ordem({
        lines: Array.from({ length: 10 }, (_, i) =>
          linha({ id: `l${i}`, itemId: `i${i}`, itemCode: `MP-00${i}`, orderedQuantity: "0.1", unitPrice: "3", lineTotal: "0.30" }),
        ),
        orderTotal: "3.00",
      }),
    );
    await screen.findByRole("heading", { level: 1, name: "OC-000001" });
    await waitFor(() => expect(rodape()).toContain("Total (prévia): R$ 3,00"));
  });

  it("F. valor ilegível não vira NaN nem zero: fica fora da prévia e é dito", async () => {
    abrir();
    await screen.findByRole("heading", { level: 1, name: "OC-000001" });
    fireEvent.change(precoDe("MP-000001"), { target: { value: "abc" } });

    expect(totalDaLinha("MP-000001")).toBe("—");
    expect(rodape()).toContain("Total (prévia): R$ 16,21");
    expect(rodape()).toContain("1 linha com valor ilegível não entra na prévia.");
    expect(rodape()).not.toContain("NaN");
  });

  it("G. recarregar restaura o valor gravado", async () => {
    const { unmount } = abrir();
    await screen.findByRole("heading", { level: 1, name: "OC-000001" });
    fireEvent.change(quantidadeDe("MP-000001"), { target: { value: "99" } });
    expect(rodape()).toContain("Gravado: R$ 141,21");
    unmount();

    abrir();
    await screen.findByRole("heading", { level: 1, name: "OC-000001" });
    await waitFor(() => expect(rodape()).toContain("Total (prévia): R$ 141,21"));
    expect(rodape()).not.toContain("Gravado");
    expect(quantidadeDe("MP-000001").value).toBe("10");
  });

  it("H. salvar persiste o que a prévia mostrou, e o gravado passa a ser a prévia", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByRole("heading", { level: 1, name: "OC-000001" });
    fireEvent.change(quantidadeDe("MP-000001"), { target: { value: "20" } });
    vi.mocked(updatePurchaseOrder).mockResolvedValue(
      ordem({ lines: [linha({ orderedQuantity: "20", lineTotal: "250.00", openQuantity: "20" }), ordem().lines[1]!], orderTotal: "266.21" }),
    );

    await user.click(screen.getByRole("button", { name: /Salvar rascunho/ }));

    await waitFor(() => expect(updatePurchaseOrder).toHaveBeenCalled());
    const payload = vi.mocked(updatePurchaseOrder).mock.calls[0]![1] as { lines: { orderedQuantity: string; unitPrice?: string }[] };
    expect(payload.lines[0]).toMatchObject({ orderedQuantity: "20", unitPrice: "12.5000" });
    await waitFor(() => expect(rodape()).toContain("Total (prévia): R$ 266,21"));
    expect(rodape()).not.toContain("Gravado");
  });

  it("I. servidor recusando o payload não transforma a prévia em dado gravado", async () => {
    const user = userEvent.setup();
    abrir();
    await screen.findByRole("heading", { level: 1, name: "OC-000001" });
    fireEvent.change(quantidadeDe("MP-000001"), { target: { value: "20" } });
    vi.mocked(updatePurchaseOrder).mockRejectedValue(
      new ApiValidationError([{ path: "lines.0.orderedQuantity", message: "Quantidade inválida" }]),
    );

    await user.click(screen.getByRole("button", { name: /Salvar rascunho/ }));

    await screen.findByText("Corrija os campos destacados.");
    expect(rodape()).toContain("Total (prévia): R$ 266,21");
    expect(rodape()).toContain("Gravado: R$ 141,21");
  });

  it("OC confirmada mostra só o total gravado — não há prévia sem edição", async () => {
    abrir(ordem({ status: "ORDERED" }));
    await screen.findByRole("heading", { level: 1, name: "OC-000001" });
    await waitFor(() => expect(rodape()).toBe("Total: R$ 141,21"));
    expect(screen.queryByRole("textbox", { name: "Quantidade de MP-000001" })).toBeNull();
  });
});
