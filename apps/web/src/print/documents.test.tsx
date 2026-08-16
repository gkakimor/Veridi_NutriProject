import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { BillingDTO, ProductionOrderDTO, ProductionOrderMaterialCostDTO } from "@veridi/shared";
import { BILLING_NON_FISCAL_NOTICE } from "@veridi/shared";
import { BillingPrintDocument, ProductionOrderPrintDocument } from "./documents";

const billingBase: BillingDTO = {
  id: "bil-1",
  code: "FAT-000123",
  customerOrderId: "ord-1",
  customerOrderCode: "PED-000045",
  shipmentId: "shp-1",
  shipmentCode: "EXP-000031",
  shipmentDate: "2026-08-10T12:00:00.000Z",
  customerId: "cus-1",
  customerCode: "CLI-000007",
  customerName: "Cliente Snapshot Ltda",
  customerTradeName: null,
  customerCnpj: "11222333000181",
  status: "ISSUED",
  externalReference: "NF 4567",
  notes: null,
  lines: [
    {
      id: "line-1",
      shipmentLineId: "sl-1",
      customerOrderLineId: "col-1",
      productId: "prd-1",
      productCode: "PRD-001",
      productName: "Magnésio",
      itemId: "item-1",
      itemCode: "PA-000010",
      itemName: "Magnésio 60 caps",
      lotId: "lot-1",
      lotCode: "LT-20260810-000001",
      businessLotNumber: "260810-A",
      quantity: "100",
      unitCode: "un",
      unitPrice: "10.00",
      lineTotal: "1000.00",
      position: 0,
    },
  ],
  totalQuantity: "100",
  totalAmount: "1000.00",
  hasCompletePricing: true,
  issuedAt: "2026-08-11T09:00:00.000Z",
  issuedBy: "Ambiente local",
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  createdAt: "2026-08-11T08:00:00.000Z",
  createdBy: "Ambiente local",
  updatedAt: "2026-08-11T09:00:00.000Z",
};

describe("Faturamento impresso", () => {
  it("deixa inequívoco que não é Nota Fiscal", () => {
    render(<BillingPrintDocument billing={billingBase} />);
    expect(screen.getByText(BILLING_NON_FISCAL_NOTICE)).toBeInTheDocument();
    expect(BILLING_NON_FISCAL_NOTICE).toContain("não é Nota Fiscal");
  });

  it("imprime o snapshot do documento e o total quando a precificação está completa", () => {
    render(<BillingPrintDocument billing={billingBase} />);
    expect(screen.getByText("FAT-000123")).toBeInTheDocument();
    // Snapshot histórico do cliente manda sobre o cadastro atual.
    expect(screen.getByText("Cliente Snapshot Ltda")).toBeInTheDocument();
    expect(screen.getByText("LT-20260810-000001")).toBeInTheDocument();
    expect(screen.getByText(/Valor total:/).closest("p")).toHaveTextContent("1.000,00");
  });

  it("com preço incompleto não apresenta total parcial como total", () => {
    const incomplete: BillingDTO = {
      ...billingBase,
      hasCompletePricing: false,
      totalAmount: null,
      lines: [{ ...billingBase.lines[0]!, unitPrice: null, lineTotal: null }],
    };
    render(<BillingPrintDocument billing={incomplete} />);
    expect(screen.getByText(/Valor total:/).closest("p")).toHaveTextContent(
      "Precificação incompleta",
    );
    expect(screen.queryByText(/1\.000,00/)).toBeNull();
  });

  it("rascunho é rotulado como tal, nunca parece documento final", () => {
    const { container } = render(
      <BillingPrintDocument billing={{ ...billingBase, status: "DRAFT", issuedAt: null }} />,
    );
    expect(container.querySelector(".print-doc__draft")).toHaveTextContent("Rascunho");
  });
});

const productionOrderBase = {
  id: "op-1",
  code: "OP-000010",
  productId: "prd-1",
  productCode: "PRD-001",
  productName: "Magnésio",
  finishedItemId: "item-1",
  finishedItemCode: "PA-000010",
  finishedItemName: "Magnésio 60 caps",
  formulationVersionId: "fv-1",
  formulationVersionNumber: 2,
  formulationVersionLabel: "v2",
  plannedQuantity: "100",
  outputUnitCode: "un",
  productionFactor: "100",
  status: "COMPLETED",
  origin: "MANUAL",
  materialsStatus: "MATERIALS_AVAILABLE",
  shortageItemCount: 0,
  notes: null,
  customerId: null,
  customerTradeName: null,
  customerZipCode: null,
  customerStreet: null,
  customerNumber: null,
  customerComplement: null,
  customerDistrict: null,
  customerCity: null,
  customerState: null,
  officialNumber: "007/26",
  numberOfParts: 1,
  labelInstructions: null,
  shelfLifeMonths: null,
  suggestedBusinessLotNumber: null,
  productionOrderRevision: null,
  recipeSheetRevision: null,
  customerCode: null,
  customerName: null,
  customerCnpj: null,
  hasCustomerSuppliedRequirements: false,
  requirements: [],
  plannedAt: "2026-08-01T10:00:00.000Z",
  plannedBy: "Ambiente local",
  releasedAt: "2026-08-02T10:00:00.000Z",
  releasedBy: "Ambiente local",
  reservation: null,
  startedAt: "2026-08-03T10:00:00.000Z",
  startedBy: "Ambiente local",
  consumptions: [],
  producedQuantity: "100",
  remainingQuantity: "0",
  outputs: [],
  eligibleFinishedLots: [],
  customerOrderId: null,
  customerOrderCode: null,
  customerOrderLineId: null,
  completedAt: "2026-08-04T10:00:00.000Z",
  completedBy: "Ambiente local",
  completionReason: null,
  cancelledAt: null,
  cancelledBy: null,
  cancelReason: null,
  createdAt: "2026-08-01T09:00:00.000Z",
  createdBy: "Ambiente local",
  updatedAt: "2026-08-04T10:00:00.000Z",
} as ProductionOrderDTO;

describe("Ordem de Produção impressa", () => {
  it("custo PARTIAL nunca aparece como custo total fechado", () => {
    const partialCost: ProductionOrderMaterialCostDTO = {
      productionOrderId: "op-1",
      consumptions: [],
      quality: "PARTIAL",
      hasCustomerSuppliedMaterials: false,
      customerSuppliedConsumptionCount: 0,
      totalMaterialCost: null,
      knownMaterialCostSubtotal: "250.00",
      producedQuantity: "100",
      outputUnitCode: "un",
      materialUnitCost: null,
      missingCostItems: ["MP-000001"],
    };

    render(<ProductionOrderPrintDocument order={productionOrderBase} cost={partialCost} />);

    expect(screen.getByText(/Qualidade do custo:/).closest("p")).toHaveTextContent("Parcial");
    const total = screen.getByText(/Custo total de material:/).closest("p");
    expect(total).toHaveTextContent("Indisponível");
    // O subtotal conhecido aparece rotulado como subtotal, nunca como total.
    expect(total).toHaveTextContent("subtotal conhecido");
    expect(screen.getByText(/Custo por unidade produzida:/).closest("p")).toHaveTextContent("—");
  });
});
