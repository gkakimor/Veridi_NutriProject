import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ShipmentDTO, ShipmentLineDTO, ShipmentProductGroupDTO } from "@veridi/shared";

/**
 * Já expedido, expedindo agora e restante — três números, ao vivo (#8B).
 *
 * A tela mostrava "Expedindo agora" do que estava gravado e um "Total" cru
 * somando produtos de unidades diferentes. Agora cada produto diz o
 * histórico (já expedido antes desta), a prévia da separação em edição
 * (expedindo agora) e o que sobra depois — pela função canônica de
 * `@veridi/shared`, sem tocar em estoque, reserva ou linha.
 */

vi.mock("../../lib/shipments-api", () => ({
  getShipment: vi.fn(),
  updateShipment: vi.fn(),
  confirmShipment: vi.fn(),
  cancelShipment: vi.fn(),
  verifyShipmentLine: vi.fn(),
}));
vi.mock("../../lib/billings-api", () => ({ createBilling: vi.fn() }));

import { cancelShipment, confirmShipment, getShipment, updateShipment } from "../../lib/shipments-api";
import { ShipmentPage } from "./ShipmentPage";

function linha(overrides: Partial<ShipmentLineDTO> = {}): ShipmentLineDTO {
  return {
    id: "sl-a",
    customerOrderLineId: "col-1",
    customerOrderReservationLineId: "res-a",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Whey 900 g",
    itemId: "pa-1",
    finishedItemCode: "PA-000001",
    finishedItemName: "Whey 900 g",
    lotId: "lot-a",
    lotCode: "LT-000010",
    businessLotNumber: null,
    expiryDate: null,
    location: null,
    quantity: "20",
    unitCode: "kg",
    position: 0,
    reservedRemaining: "30.5",
    requiresVerification: false,
    verifiedAt: null,
    verifiedBy: null,
    ...overrides,
  };
}

function grupo(overrides: Partial<ShipmentProductGroupDTO> = {}): ShipmentProductGroupDTO {
  return {
    customerOrderLineId: "col-1",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Whey 900 g",
    itemId: "pa-1",
    finishedItemCode: "PA-000001",
    finishedItemName: "Whey 900 g",
    unitCode: "kg",
    orderedQuantity: "100",
    shippedQuantity: "60",
    outstandingQuantity: "40",
    reservedRemaining: "40.5",
    shippingNow: "20",
    lotsRequired: 0,
    lotsVerified: 0,
    status: "READY",
    ...overrides,
  };
}

function expedicao(overrides: Partial<ShipmentDTO> = {}): ShipmentDTO {
  return {
    id: "exp-1",
    code: "EXP-000001",
    customerOrderId: "co-1",
    customerOrderCode: "PED-000001",
    customerId: "cli-1",
    customerName: "NutriViva",
    status: "DRAFT",
    shipmentDate: null,
    notes: null,
    lines: [
      linha(),
      linha({ id: "sl-b", customerOrderReservationLineId: "res-b", lotId: "lot-b", lotCode: "LT-000011", quantity: "0", reservedRemaining: "10", position: 1 }),
    ],
    products: [grupo()],
    verification: { productCount: 1, lotsRequired: 0, lotsVerified: 0, allLotsVerified: true },
    totalQuantity: "20",
    billingStatus: "NONE",
    billingId: null,
    billingCode: null,
    confirmedAt: null,
    confirmedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "Teste",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as ShipmentDTO;
}

async function abrir(dto = expedicao()) {
  vi.mocked(getShipment).mockResolvedValue(dto);
  render(
    <MemoryRouter initialEntries={["/comercial/expedicoes/exp-1"]}>
      <Routes>
        <Route path="/comercial/expedicoes/:id" element={<ShipmentPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: "EXP-000001" });
}

const resumo = () =>
  (document.querySelector(".shipment-product__meta")!.textContent ?? "").replace(/[\s ]+/g, " ");
const campoDoLote = (lote: string) =>
  screen.getByRole("textbox", { name: `Quantidade do lote ${lote}` }) as HTMLInputElement;
const botaoConfirmar = () => screen.getByRole("button", { name: "Confirmar expedição" }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Expedição — prévia por produto", () => {
  it("A/C/D. parcial: já expedido é histórico, expedindo agora é a prévia, restante é a diferença", async () => {
    await abrir();
    expect(resumo()).toContain("Quantidade do pedido: 100 kg");
    expect(resumo()).toContain("Já expedido (antes desta): 60 kg");
    expect(resumo()).toContain("Expedindo agora (prévia): 20 kg");
    expect(resumo()).toContain("Restante após esta expedição: 20 kg");
  });

  it("B. mudar a quantidade recalcula expedindo agora e restante na hora, sem chamar o servidor", async () => {
    await abrir();
    fireEvent.change(campoDoLote("LT-000010"), { target: { value: "25" } });

    expect(resumo()).toContain("Expedindo agora (prévia): 25 kg");
    expect(resumo()).toContain("Restante após esta expedição: 15 kg");
    expect(updateShipment).not.toHaveBeenCalled();
    expect(confirmShipment).not.toHaveBeenCalled();
  });

  it("E. vários lotes: a prévia soma todas as linhas do produto", async () => {
    await abrir();
    fireEvent.change(campoDoLote("LT-000011"), { target: { value: "10" } });

    expect(resumo()).toContain("Expedindo agora (prévia): 30 kg");
    expect(resumo()).toContain("Restante após esta expedição: 10 kg");
  });

  it("F. acima do reservado do lote: erro na linha e confirmação travada", async () => {
    await abrir();
    fireEvent.change(campoDoLote("LT-000010"), { target: { value: "31" } });

    expect(screen.getByText(/Máximo 30,5 kg/)).toBeInTheDocument();
    expect(campoDoLote("LT-000010")).toHaveAttribute("aria-invalid", "true");
    expect(botaoConfirmar()).toBeDisabled();
  });

  it("G. acima do que falta expedir: nunca um restante negativo — erro dito e confirmação travada", async () => {
    await abrir(expedicao({ products: [grupo({ outstandingQuantity: "35" })] }));
    fireEvent.change(campoDoLote("LT-000010"), { target: { value: "30" } });
    fireEvent.change(campoDoLote("LT-000011"), { target: { value: "10" } });

    expect(resumo()).toContain("Expedindo agora (prévia): 40 kg");
    expect(resumo()).toContain("Acima do que falta expedir em 5 kg");
    expect(resumo()).not.toMatch(/Restante após esta expedição: -/);
    expect(botaoConfirmar()).toBeDisabled();
    expect(botaoConfirmar().title).toMatch(/acima do que falta expedir/);
  });

  it("H. tudo zero: nada a expedir, restante igual ao que falta, confirmação travada", async () => {
    await abrir();
    fireEvent.change(campoDoLote("LT-000010"), { target: { value: "0" } });

    expect(resumo()).toContain("Expedindo agora (prévia): 0 kg");
    expect(resumo()).toContain("Restante após esta expedição: 40 kg");
    expect(botaoConfirmar()).toBeDisabled();
    expect(botaoConfirmar().title).toBe("Nenhuma quantidade a expedir.");
  });

  it("I. toda quantidade passa pelo formatador: vírgula, nunca string crua", async () => {
    await abrir();
    expect(resumo()).toContain("Reservado disponível: 40,5 kg");
    expect(screen.getByText("30,5 kg")).toBeInTheDocument();
    fireEvent.change(campoDoLote("LT-000010"), { target: { value: "12,5" } });
    expect(resumo()).toContain("Expedindo agora (prévia): 12,5 kg");
    expect(resumo()).toContain("Restante após esta expedição: 27,5 kg");
    expect(document.body.textContent).not.toMatch(/\bTotal:/);
  });

  it("valor ilegível fica fora da prévia e é contado", async () => {
    await abrir();
    fireEvent.change(campoDoLote("LT-000010"), { target: { value: "abc" } });
    expect(resumo()).toContain("Expedindo agora (prévia): 0 kg");
    expect(resumo()).toContain("1 linha ilegível fora da prévia.");
    expect(botaoConfirmar()).toBeDisabled();
  });

  it("J. cancelar o diálogo não altera nada — a prévia nunca grava", async () => {
    const user = userEvent.setup();
    await abrir();
    fireEvent.change(campoDoLote("LT-000010"), { target: { value: "25" } });
    await user.click(screen.getByRole("button", { name: "Cancelar expedição" }));
    await user.click(screen.getByRole("button", { name: "Voltar" }));

    expect(cancelShipment).not.toHaveBeenCalled();
    expect(updateShipment).not.toHaveBeenCalled();
    expect(resumo()).toContain("Expedindo agora (prévia): 25 kg");
  });

  it("K/L. confirmar grava as quantidades da prévia e só então o resumo vira histórico", async () => {
    const user = userEvent.setup();
    await abrir();
    fireEvent.change(campoDoLote("LT-000010"), { target: { value: "25" } });
    const confirmada = expedicao({
      status: "CONFIRMED",
      lines: [linha({ quantity: "25" }), linha({ id: "sl-b", customerOrderReservationLineId: "res-b", lotCode: "LT-000011", quantity: "0", reservedRemaining: "10" })],
      products: [grupo({ shippedQuantity: "85", outstandingQuantity: "15", shippingNow: "25", status: "VERIFIED" })],
      totalQuantity: "25",
      confirmedAt: "2026-09-02T00:00:00.000Z",
      confirmedBy: "Teste",
    });
    vi.mocked(updateShipment).mockResolvedValue(expedicao({ lines: [linha({ quantity: "25" }), expedicao().lines[1]!], products: [grupo({ shippingNow: "25" })] }));
    vi.mocked(confirmShipment).mockResolvedValue(confirmada);

    await user.click(botaoConfirmar());
    await user.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(confirmShipment).toHaveBeenCalledWith("exp-1"));
    const salvo = vi.mocked(updateShipment).mock.calls[0]![1] as { lines: { customerOrderReservationLineId: string; quantity: string }[] };
    expect(salvo.lines).toEqual([
      { customerOrderReservationLineId: "res-a", quantity: "25" },
      { customerOrderReservationLineId: "res-b", quantity: "0" },
    ]);
    await waitFor(() => expect(resumo()).toContain("Expedido nesta expedição: 25 kg"));
    expect(resumo()).toContain("Já expedido (total): 85 kg");
    expect(resumo()).toContain("Falta expedir: 15 kg");
    expect(resumo()).not.toContain("prévia");
  });
});
