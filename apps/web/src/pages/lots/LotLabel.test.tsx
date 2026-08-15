import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LotDTO } from "@veridi/shared";
import { LotLabel } from "./LotLabel";

const baseLot: LotDTO = {
  id: "lot-1",
  code: "LT-20260815-000123",
  qrPayload: "LOT:LT-20260815-000123",
  itemId: "item-1",
  itemCode: "MP-001",
  itemName: "Farinha de trigo",
  unitCode: "kg",
  supplierId: "sup-1",
  supplierCode: "FOR-001",
  supplierName: "Fornecedor Teste",
  supplierLot: "SUP-A",
  expiryDate: "2026-01-01T00:00:00.000Z",
  isExpired: true,
  initialReceivedQuantity: "10",
  onHand: "10",
  reserved: "0",
  available: "10",
  status: "AVAILABLE",
  location: "A1",
  receiptId: "rec-1",
  receiptCode: "REC-000001",
  purchaseOrderId: "po-1",
  purchaseOrderCode: "OC-000001",
  createdAt: new Date().toISOString(),
  createdBy: "Ambiente local",
  releasedAt: null,
  releasedBy: null,
  blockedAt: null,
  blockedBy: null,
  blockReason: null,
};

describe("LotLabel", () => {
  it("renderiza os dados do lote correto, sem saldo/preço/OC", () => {
    render(<LotLabel lot={baseLot} />);

    expect(screen.getByText("VERIDI NUTRITION")).toBeInTheDocument();
    expect(screen.getByText("MP-001")).toBeInTheDocument();
    expect(screen.getByText("Farinha de trigo")).toBeInTheDocument();
    expect(screen.getByText("SUP-A")).toBeInTheDocument();
    expect(screen.getByText("LT-20260815-000123")).toBeInTheDocument();
    expect(screen.getByText("A1")).toBeInTheDocument();
    expect(screen.getByText(/10 kg/)).toBeInTheDocument();

    expect(screen.queryByText(/saldo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reservado/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/OC-000001/)).not.toBeInTheDocument();
  });

  it("mostra VENCIDO quando o lote está expirado", () => {
    render(<LotLabel lot={baseLot} />);
    expect(screen.getByText(/VENCIDO/)).toBeInTheDocument();
  });
});
