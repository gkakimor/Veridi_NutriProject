import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BillingDTO, BillingLineDTO, MaterialReservationLineDTO } from "@veridi/shared";

/**
 * Correções vindas do primeiro caso real ponta a ponta (VAL-LEG-01).
 *
 * Cada teste aqui existe porque um operador ficou sem saída numa tela
 * enquanto levava um pedido real de cliente até o faturamento.
 */

vi.mock("../lib/production-orders-api", () => ({ addExtraReservation: vi.fn() }));
vi.mock("../lib/billings-api", () => ({ overrideBillingPrice: vi.fn() }));

import { addExtraReservation } from "../lib/production-orders-api";
import { overrideBillingPrice } from "../lib/billings-api";
import { ExtraConsumptionDialog } from "../components/ExtraConsumptionDialog";
import { PriceOverrideDialog } from "./billings/PriceOverrideDialog";

function linhaDeReserva(
  overrides: Partial<MaterialReservationLineDTO> = {},
): MaterialReservationLineDTO {
  return {
    id: "line-1",
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Cafeína/1,3,7-Trimethylxanthine",
    lotId: "lot-1",
    lotCode: "LT-20260819-000003",
    supplierLot: "22090904",
    expiryDate: null,
    location: "Almoxarifado MP",
    lotStatus: "AVAILABLE",
    quantity: "1.333333",
    unitCode: "kg",
    consumedQuantity: "0",
    remainingQuantity: "1.333333",
    pickingStatus: "CONFIRMED",
    pickedAt: "2026-08-20T11:00:00.000Z",
    pickedBy: "Admin",
    releasedAt: null,
    releasedBy: null,
    releaseReason: null,
    replacesLineId: null,
    extraReason: null,
    extraRequestedBy: null,
    extraRequestedAt: null,
    lotFreeQuantity: "3.666667",
    ...overrides,
  };
}

function abrirConsumoExtra(line = linhaDeReserva()) {
  render(
    <MemoryRouter>
      <ExtraConsumptionDialog
        productionOrderId="op-1"
        line={line}
        onClose={() => {}}
        onAdded={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("Adicionar consumo extra", () => {
  beforeEach(() => {
    vi.mocked(addExtraReservation).mockClear();
  });

  it("mostra o saldo livre antes de o operador pedir", () => {
    abrirConsumoExtra();
    // Antes, o limite só aparecia na recusa — tarde demais para decidir
    // quanto pedir.
    expect(screen.getByText("Disponível não reservado")).toBeTruthy();
    expect(screen.getByText(/3\.666667/)).toBeTruthy();
  });

  it("mostra reservado, já consumido e saldo reservado lado a lado", () => {
    abrirConsumoExtra(linhaDeReserva({ consumedQuantity: "1", remainingQuantity: "0.333333" }));
    expect(screen.getByText("Reservado")).toBeTruthy();
    expect(screen.getByText("Já consumido")).toBeTruthy();
    expect(screen.getByText("Saldo reservado")).toBeTruthy();
  });

  it("sem motivo não envia", () => {
    abrirConsumoExtra();
    fireEvent.change(screen.getByLabelText(/Quantidade adicional/), { target: { value: "0.5" } });
    const botao = screen.getByRole("button", { name: /Adicionar consumo extra/ }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
  });

  it("recusa quantidade acima do saldo livre, dizendo o limite", () => {
    abrirConsumoExtra();
    fireEvent.change(screen.getByLabelText(/Quantidade adicional/), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/^Motivo/), { target: { value: "Tentativa" } });

    expect(screen.getByText(/Acima do saldo livre deste lote/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Adicionar consumo extra/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("o caso da auditoria: 0,006667 kg com motivo vai para a API", async () => {
    vi.mocked(addExtraReservation).mockResolvedValue({} as never);
    abrirConsumoExtra();

    fireEvent.change(screen.getByLabelText(/Quantidade adicional/), { target: { value: "0.006667" } });
    fireEvent.change(screen.getByLabelText(/^Motivo/), {
      target: { value: "Ajuste de consumo durante produção" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar consumo extra/ }));

    await waitFor(() => expect(addExtraReservation).toHaveBeenCalled());
    const [opId, lineId, payload] = vi.mocked(addExtraReservation).mock.calls[0]!;
    expect(opId).toBe("op-1");
    expect(lineId).toBe("line-1");
    expect(payload.quantity).toBe("0.006667");
    expect(payload.reason).toBe("Ajuste de consumo durante produção");
    // Sem marcar "outro lote", amplia no próprio lote da linha.
    expect(payload.lotCode).toBeUndefined();
  });

  it("outro lote só é enviado quando o operador escolhe explicitamente", async () => {
    vi.mocked(addExtraReservation).mockResolvedValue({} as never);
    abrirConsumoExtra();

    fireEvent.click(screen.getByLabelText(/Usar outro lote/));
    fireEvent.change(screen.getByLabelText(/Código do lote alternativo/), {
      target: { value: "LT-20260819-000009" },
    });
    fireEvent.change(screen.getByLabelText(/Quantidade adicional/), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/^Motivo/), { target: { value: "Complemento" } });
    fireEvent.click(screen.getByRole("button", { name: /Adicionar consumo extra/ }));

    await waitFor(() => expect(addExtraReservation).toHaveBeenCalled());
    expect(vi.mocked(addExtraReservation).mock.calls[0]![2].lotCode).toBe("LT-20260819-000009");
  });

  it("em outro lote, o teto do lote atual não se aplica", () => {
    abrirConsumoExtra();
    fireEvent.change(screen.getByLabelText(/Quantidade adicional/), { target: { value: "10" } });
    expect(screen.getByText(/Acima do saldo livre deste lote/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Usar outro lote/));
    // O saldo de outro lote é outro número — a tela não finge conhecê-lo.
    expect(screen.queryByText(/Acima do saldo livre deste lote/)).toBeNull();
  });
});

function linhaDeFaturamento(overrides: Partial<BillingLineDTO> = {}): BillingLineDTO {
  return {
    id: "bl-1",
    shipmentLineId: "sl-1",
    customerOrderLineId: "col-1",
    productId: "prod-1",
    productCode: "PROD-000005",
    productName: "VAL-LEG-01 · Cafeína 60 cápsulas",
    itemId: "item-1",
    itemCode: "PA-000005",
    itemName: "VAL-LEG-01 · Cafeína 60 cápsulas",
    lotId: "lot-1",
    lotCode: "LT-20260820-000007",
    businessLotNumber: "L001-26",
    quantity: "98",
    unitCode: "un",
    agreedUnitPrice: "9.48",
    unitPrice: "9.48",
    lineTotal: "929.04",
    priceOverridden: false,
    overrideReason: null,
    overriddenBy: null,
    overriddenAt: null,
    position: 0,
    ...overrides,
  };
}

/** Documento mínimo em rascunho — o diálogo precisa dele para prever o total. */
function faturamentoCom(lines: BillingLineDTO[]): BillingDTO {
  const totalAmount = lines.every((line) => line.lineTotal !== null)
    ? lines.reduce((sum, line) => sum + Number(line.lineTotal), 0).toFixed(2)
    : null;
  return {
    id: "fat-1",
    code: "FAT-000001",
    customerOrderId: "co-1",
    customerOrderCode: "PED-000001",
    shipmentId: "sh-1",
    shipmentCode: "EXP-000001",
    shipmentDate: null,
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "Cliente",
    customerTradeName: null,
    customerCnpj: null,
    status: "DRAFT",
    externalReference: null,
    notes: null,
    lines,
    totalQuantity: lines.reduce((sum, line) => sum + Number(line.quantity), 0).toString(),
    totalAmount,
    hasCompletePricing: totalAmount !== null,
    issuedAt: null,
    issuedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: "2026-09-05T00:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-09-05T00:00:00.000Z",
  };
}

describe("Alterar preço de faturamento", () => {
  beforeEach(() => {
    vi.mocked(overrideBillingPrice).mockClear();
  });

  function abrirOverride(line = linhaDeFaturamento()) {
    render(
      <MemoryRouter>
        <PriceOverrideDialog
          billing={faturamentoCom([line])}
          line={line}
          onClose={() => {}}
          onOverridden={() => {}}
        />
      </MemoryRouter>,
    );
  }

  it("mostra o preço acordado ao lado — ele não é substituído", () => {
    abrirOverride();
    expect(screen.getByText("Preço acordado")).toBeTruthy();
    expect(screen.getByText(/9,48/)).toBeTruthy();
  });

  it("nasce com o preço atual preenchido, não vazio", () => {
    abrirOverride();
    expect((screen.getByLabelText(/Preço faturado/) as HTMLInputElement).value).toBe("9.48");
  });

  it("sem motivo não altera", () => {
    abrirOverride();
    fireEvent.change(screen.getByLabelText(/Preço faturado/), { target: { value: "9.20" } });
    expect((screen.getByRole("button", { name: /Alterar preço/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("envia preço e motivo juntos", async () => {
    vi.mocked(overrideBillingPrice).mockResolvedValue({} as never);
    abrirOverride();

    fireEvent.change(screen.getByLabelText(/Preço faturado/), { target: { value: "9.20" } });
    fireEvent.change(screen.getByLabelText(/^Motivo/), {
      target: { value: "Desconto comercial autorizado" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Alterar preço/ }));

    await waitFor(() => expect(overrideBillingPrice).toHaveBeenCalled());
    const [billingId, lineId, payload] = vi.mocked(overrideBillingPrice).mock.calls[0]!;
    expect(billingId).toBe("fat-1");
    expect(lineId).toBe("bl-1");
    expect(payload.unitPrice).toBe("9.20");
    expect(payload.reason).toBe("Desconto comercial autorizado");
  });

  it("avisa que voltar ao acordado desfaz a marca de alteração", () => {
    abrirOverride(linhaDeFaturamento({ unitPrice: "9.20", priceOverridden: true }));
    fireEvent.change(screen.getByLabelText(/Preço faturado/), { target: { value: "9.48" } });
    expect(screen.getByText(/remove a marca de alteração/)).toBeTruthy();
  });
});
