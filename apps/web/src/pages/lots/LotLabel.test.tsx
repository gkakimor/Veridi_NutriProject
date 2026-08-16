import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LotDTO } from "@veridi/shared";
import { LotLabel } from "./LotLabel";

const baseLot: LotDTO = {
  id: "lot-1",
  code: "LT-20260815-000123",
  qrPayload: "LOT:LT-20260815-000123",
  origin: "RECEIPT",
  itemId: "item-1",
  itemCode: "MP-001",
  itemName: "Farinha de trigo",
  unitCode: "kg",
  ownerType: "VERIDI" as const,
  ownerCustomerId: null,
  ownerCustomerCode: null,
  ownerCustomerName: null,
  supplierId: "sup-1",
  supplierCode: "FOR-001",
  supplierName: "Fornecedor Teste",
  supplierLot: "SUP-A",
  businessLotNumber: null,
  producedQuantity: null,
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
  productionOrderId: null,
  productionOrderCode: null,
  createdAt: new Date().toISOString(),
  createdBy: "Ambiente local",
  releasedAt: null,
  releasedBy: null,
  blockedAt: null,
  blockedBy: null,
  blockReason: null,
};

const producedLot: LotDTO = {
  ...baseLot,
  id: "lot-2",
  code: "LT-20260815-000245",
  qrPayload: "LOT:LT-20260815-000245",
  origin: "PRODUCTION",
  itemCode: "PA-001",
  itemName: "Whey Protein 900g",
  supplierId: null,
  supplierCode: null,
  supplierName: null,
  supplierLot: null,
  businessLotNumber: "260815-A",
  producedQuantity: "990",
  expiryDate: "2027-01-01T00:00:00.000Z",
  isExpired: false,
  initialReceivedQuantity: "600",
  onHand: "990",
  available: "990",
  receiptId: null,
  receiptCode: null,
  purchaseOrderId: null,
  purchaseOrderCode: null,
  productionOrderId: "op-1",
  productionOrderCode: "OP-000042",
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

  it("lote de produção (origin=PRODUCTION) mostra Lote Veridi e quantidade produzida, nunca Lote fornecedor", () => {
    render(<LotLabel lot={producedLot} />);

    expect(screen.getByText("260815-A")).toBeInTheDocument();
    expect(screen.getByText("LT-20260815-000245")).toBeInTheDocument();
    expect(screen.getByText(/990 kg/)).toBeInTheDocument();
    expect(screen.getByText("Quantidade produzida")).toBeInTheDocument();

    expect(screen.queryByText("Lote fornecedor")).not.toBeInTheDocument();
    expect(screen.queryByText("Quantidade recebida")).not.toBeInTheDocument();
  });
});
