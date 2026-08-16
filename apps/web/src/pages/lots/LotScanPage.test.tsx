import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LotDTO } from "@veridi/shared";
import { LotScanPage } from "./LotScanPage";
import { lookupLot } from "../../lib/lots-api";

vi.mock("../../lib/lots-api", () => ({
  lookupLot: vi.fn(),
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

const fixtureLot: LotDTO = {
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
  expiryDate: null,
  isExpired: false,
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

describe("LotScanPage", () => {
  beforeEach(() => {
    navigateMock.mockClear();
    vi.mocked(lookupLot).mockReset();
  });

  it("mostra o card de resultado e navega ao clicar em Ver detalhes", async () => {
    vi.mocked(lookupLot).mockResolvedValue(fixtureLot);
    const user = userEvent.setup();
    render(<LotScanPage />);

    await user.type(screen.getByLabelText("Digite o lote"), "LT-20260815-000123");
    await user.click(screen.getByRole("button", { name: "Buscar" }));

    await waitFor(() => expect(screen.getByText("Farinha de trigo")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Ver detalhes" }));
    expect(navigateMock).toHaveBeenCalledWith("/estoque/lotes/lot-1");
  });

  it("mostra erro Veridi-branded quando o lote não é encontrado", async () => {
    vi.mocked(lookupLot).mockResolvedValue(null);
    const user = userEvent.setup();
    render(<LotScanPage />);

    await user.type(screen.getByLabelText("Digite o lote"), "LT-INVENTADO");
    await user.click(screen.getByRole("button", { name: "Buscar" }));

    await waitFor(() =>
      expect(screen.getByText('Lote "LT-INVENTADO" não encontrado.')).toBeInTheDocument(),
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
