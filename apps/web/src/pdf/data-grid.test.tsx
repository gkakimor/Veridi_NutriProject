import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FinishedLotTraceabilityDTO, LotDTO, RawMaterialLotTraceabilityDTO } from "@veridi/shared";
import { PdfDataGrid } from "./components";
import { LotTraceabilityPdf } from "./documents/LotTraceabilityPdf";

/**
 * Campo vazio na grade rotulada: opcional sai do papel, o resto sai "—".
 *
 * Vazio é ausência de dado — null, undefined, false, texto em branco. "—" é
 * como o documento ESCREVE "sem dado" (`orDash`): tratado como vazio, um
 * campo opcional com valor já formatado sumia calado em vez de sair como
 * "rótulo: —", e teste de arquivo nenhum percebe o campo que não está lá.
 */

vi.mock("@react-pdf/renderer", async () => ({ ...(await import("./testing/react-pdf-dom")) }));

const GERADO_EM = new Date("2026-09-11T12:30:00.000Z");

/** Rótulo → valor de cada campo que chegou ao papel. */
function campos(container: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    [...container.querySelectorAll('[data-pdf-role="field"]')].map((campo) => {
      const [rotulo, valor] = [...campo.children];
      return [rotulo?.textContent ?? "", valor?.textContent ?? ""];
    }),
  );
}

describe("PdfDataGrid — campo vazio", () => {
  it('opcional some só sem dado; "—" já formatado sai no papel', () => {
    const { container } = render(
      <PdfDataGrid
        fields={[
          { label: "Opcional nulo", value: null, optional: true },
          { label: "Opcional vazio", value: "", optional: true },
          { label: "Opcional em branco", value: "   ", optional: true },
          { label: "Opcional com traço", value: "—", optional: true },
          { label: "Fixo nulo", value: null },
          { label: "Fixo em branco", value: "  " },
          { label: "Fixo zero", value: 0 },
        ]}
      />,
    );

    expect(campos(container)).toEqual({
      "Opcional com traço": "—",
      "Fixo nulo": "—",
      "Fixo em branco": "—",
      "Fixo zero": "0",
    });
  });
});

/** Lote sem nenhum dado de origem: cada caso liga só o que precisa. */
const LOTE: LotDTO = {
  id: "lot-1",
  code: "LT-20260911-000001",
  qrPayload: "LOT:LT-20260911-000001",
  origin: "PRODUCTION",
  itemId: "item-1",
  itemCode: "PA-000001",
  itemName: "Whey Protein 900 g",
  unitCode: "un",
  ownerType: "VERIDI",
  ownerCustomerId: null,
  ownerCustomerCode: null,
  ownerCustomerName: null,
  requiresCoa: false,
  coaStatus: "NOT_REQUIRED",
  coaReviewedAt: null,
  coaReviewedByName: null,
  coaReviewNote: null,
  supplierId: null,
  supplierCode: null,
  supplierName: null,
  supplierLot: null,
  businessLotNumber: null,
  expiryDate: null,
  isExpired: false,
  initialReceivedQuantity: "0",
  producedQuantity: null,
  onHand: "0",
  reserved: "0",
  available: "0",
  status: "AVAILABLE",
  location: null,
  receiptId: null,
  receiptCode: null,
  purchaseOrderId: null,
  purchaseOrderCode: null,
  productionOrderId: null,
  productionOrderCode: null,
  createdAt: "2026-09-11T12:00:00.000Z",
  createdBy: "Operador Silva",
  releasedAt: null,
  releasedBy: null,
  blockedAt: null,
  blockedBy: null,
  blockReason: null,
  shipments: [],
};

const RASTRO_ACABADO: FinishedLotTraceabilityDTO = {
  kind: "FINISHED_GOOD",
  lotId: LOTE.id,
  lotCode: LOTE.code,
  businessLotNumber: null,
  productionOrderId: "op-1",
  productionOrderCode: "OP-000001",
  productId: "prd-1",
  productCode: "PRD-001",
  productName: "Whey Protein 900 g",
  producedQuantity: "100",
  unitCode: "un",
  consumedMaterials: [],
  commercialDestination: null,
};

const RASTRO_INSUMO: RawMaterialLotTraceabilityDTO = {
  kind: "RAW_MATERIAL",
  lotId: LOTE.id,
  lotCode: LOTE.code,
  itemId: LOTE.itemId,
  itemCode: LOTE.itemCode,
  itemName: LOTE.itemName,
  coaStatus: "NOT_REQUIRED",
  coaDocuments: [],
  usedIn: [],
  usedInSamples: [],
};

describe('Rastreabilidade de lote — o que não se aplica sai do papel, o que se aplica vazio sai "—"', () => {
  it('produto acabado: Lote Veridi vazio sai "—"; lote do fornecedor, fornecedor e recebimento vazios somem', () => {
    const { container } = render(
      <LotTraceabilityPdf
        lot={{ ...LOTE, supplierLot: "  " }}
        traceability={RASTRO_ACABADO}
        generatedAt={GERADO_EM}
      />,
    );
    const lote = campos(container);

    expect(lote["Lote Veridi"]).toBe("—");
    for (const rotulo of ["Lote do fornecedor", "Fornecedor", "Recebimento"]) {
      expect(Object.keys(lote), rotulo).not.toContain(rotulo);
    }
  });

  it('insumo: Lote Veridi vazio some; lote do fornecedor, fornecedor e recebimento vazios saem "—"', () => {
    const { container } = render(
      <LotTraceabilityPdf
        lot={{ ...LOTE, origin: "RECEIPT", businessLotNumber: " ", supplierLot: "   " }}
        traceability={RASTRO_INSUMO}
        generatedAt={GERADO_EM}
      />,
    );
    const lote = campos(container);

    expect(Object.keys(lote)).not.toContain("Lote Veridi");
    expect([lote["Lote do fornecedor"], lote["Fornecedor"], lote["Recebimento"]]).toEqual(["—", "—", "—"]);
  });
});
