import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { IndustrialCostCalculationDTO } from "@veridi/shared";

/**
 * Referência manual forçada, na tela do cálculo padrão.
 *
 * O que se protege: o padrão é automático; forçar recalcula na hora pelo
 * caminho que aceita substituições; o impacto aparece antes do motivo; salvar
 * fica travado enquanto o motivo está em branco; e voltar para "automática"
 * volta ao caminho de sempre, sem substituição nenhuma no envio.
 */

vi.mock("../../lib/cost-calculation-api", () => ({
  calculateIndustrialCost: vi.fn(),
  previewIndustrialCost: vi.fn(),
  saveIndustrialCostCalculation: vi.fn(),
  listProductCostCalculations: () => Promise.resolve([]),
}));
vi.mock("../../lib/pricing-api", () => ({ createPricingVersion: vi.fn() }));
vi.mock("../../lib/cost-pricing-templates-api", () => ({ applyPricingPolicyToProduct: vi.fn() }));
vi.mock("../cost-templates/UsePricingPolicyDialog", () => ({ UsePricingPolicyDialog: () => null }));

import {
  calculateIndustrialCost,
  previewIndustrialCost,
  saveIndustrialCostCalculation,
} from "../../lib/cost-calculation-api";
import { CostCalculationSection } from "./CostCalculationSection";

const manualReference = {
  referenceId: "ref-1",
  unitCost: "1200.000000",
  declaredUnitCost: "1200",
  declaredUomCode: "kg",
  effectiveFrom: "2026-09-01T00:00:00.000Z",
  note: null,
};

function resultado(forcado: boolean): IndustrialCostCalculationDTO {
  return {
    industrialCostVersionId: "ec-1",
    industrialCostVersionLabel: "EC-000001 · V1",
    structureStatus: "ACTIVE",
    draftReference: false,
    productId: "prod-1",
    productCode: "PR-000001",
    productName: "Produto",
    customerName: null,
    formulationVersionNumber: 1,
    referenceOutputQuantity: "1",
    referenceOutputUomCode: "un",
    unitsPerShippingBox: null,
    costReferenceDate: "2026-09-04T12:00:00.000Z",
    calculatedAt: "2026-09-04T12:00:00.000Z",
    materials: [
      {
        itemId: "item-1",
        itemCode: "MP-000001",
        itemName: "Coenzima Q10",
        requiredQuantity: "2",
        unitCode: "kg",
        customerSupplied: false,
        unitCost: forcado ? "1200.000000" : "1050.000000",
        costSource: forcado ? "MANUAL_REFERENCE_FORCED" : "WEIGHTED_AVG_30D",
        costSourceDetails: null,
        subtotal: forcado ? "2400.00" : "2100.00",
        manualReference,
        override: forcado
          ? {
              reason: "",
              automaticSource: "WEIGHTED_AVG_30D",
              automaticUnitCost: "1050.000000",
              automaticDetails: null,
              automaticSubtotal: "2100.00",
              impact: "300.00",
              referenceId: "ref-1",
              referenceEffectiveFrom: "2026-09-01T00:00:00.000Z",
              forcedByName: "Ana",
              forcedAt: "2026-09-04T12:00:00.000Z",
            }
          : null,
      },
    ],
    resources: [],
    manualLines: [],
    customerSuppliedMaterials: [],
    hasCustomerSuppliedMaterials: false,
    energyCalculationMode: "DIRECT",
    derivedEnergyKwh: null,
    energyRate: "1",
    materialsSubtotalKnown: forcado ? "2400.00" : "2100.00",
    laborSubtotalKnown: "0.00",
    equipmentSubtotalKnown: "0.00",
    energySubtotal: "1.00",
    secondaryPackagingSubtotalKnown: "0.00",
    thirdPartySubtotalKnown: "0.00",
    otherSubtotalKnown: "0.00",
    overheadSubtotalKnown: "0.00",
    directIndustrialCost: forcado ? "2401.00" : "2101.00",
    totalIndustrialCost: forcado ? "2401.00" : "2101.00",
    knownSubtotal: forcado ? "2401.00" : "2101.00",
    costPerUnit: forcado ? "2401.000000" : "2101.000000",
    costPer1000: forcado ? "2401000.00" : "2101000.00",
    quality: forcado ? "COMPLETE_WITH_ESTIMATES" : "COMPLETE_REAL_REFERENCE",
    warnings: [],
  };
}

function renderSecao() {
  return render(
    <MemoryRouter>
      <CostCalculationSection productId="prod-1" versionId="ec-1" canSave />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(calculateIndustrialCost).mockReset();
  vi.mocked(previewIndustrialCost).mockReset();
  vi.mocked(saveIndustrialCostCalculation).mockReset();
  vi.mocked(calculateIndustrialCost).mockResolvedValue(resultado(false));
  vi.mocked(previewIndustrialCost).mockResolvedValue(resultado(true));
});

describe("Fonte do custo por material — referência manual forçada", () => {
  it("o padrão é automático; forçar recalcula, mostra o impacto e só salva com motivo", async () => {
    renderSecao();
    fireEvent.click(screen.getByRole("button", { name: "Calcular custo" }));

    // Automático primeiro, com a referência manual oferecida ao lado.
    expect(await screen.findByText("Fonte do custo por material")).toBeInTheDocument();
    const automatica = screen.getByRole("radio", { name: /Seleção automática/ });
    const forcar = screen.getByRole("radio", { name: /Forçar referência manual/ });
    expect(automatica).toBeChecked();
    expect(forcar).not.toBeChecked();
    expect(screen.getByText(/R\$ 1\.200,00\/kg/)).toBeInTheDocument();
    expect(previewIndustrialCost).not.toHaveBeenCalled();

    fireEvent.click(forcar);
    await waitFor(() => expect(previewIndustrialCost).toHaveBeenCalled());
    expect(vi.mocked(previewIndustrialCost).mock.calls[0]?.[1]).toMatchObject({
      materialOverrides: [{ itemId: "item-1", reason: "" }],
    });

    // Resultado forçado: origem marcada, fonte automática preservada, impacto dito.
    expect(await screen.findByText("Forçada")).toBeInTheDocument();
    expect(screen.getAllByText("Referência manual forçada").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\+ R\$ 300,00/).length).toBeGreaterThan(0);
    expect(screen.getByText("Completo — com estimativas")).toBeInTheDocument();

    // Sem motivo, salvar não abre nem o diálogo.
    const salvar = screen.getByRole("button", { name: "Salvar cálculo" });
    expect(salvar).toBeDisabled();
    expect(screen.getByText(/Informe o motivo para salvar/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Motivo da substituição/), {
      target: { value: "Compra de 30 dias foi lote promocional" },
    });
    expect(salvar).not.toBeDisabled();

    vi.mocked(saveIndustrialCostCalculation).mockResolvedValue({
      ...resultado(true),
      id: "calc-1",
      code: "CALC-000001",
      calculatedByName: "Ana",
      structureStatusAtCalculation: "ACTIVE",
      notes: null,
    });
    fireEvent.click(salvar);
    fireEvent.click(await screen.findByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(saveIndustrialCostCalculation).toHaveBeenCalled());
    expect(vi.mocked(saveIndustrialCostCalculation).mock.calls[0]?.[1]).toMatchObject({
      materialOverrides: [{ itemId: "item-1", reason: "Compra de 30 dias foi lote promocional" }],
    });
  });

  it("ofertas ambíguas: o automático fica sem custo, com a orientação, e forçar é a saída explícita", async () => {
    const ambiguo = resultado(false);
    ambiguo.materials[0] = {
      ...ambiguo.materials[0]!,
      unitCost: null,
      costSource: "AMBIGUOUS_SUPPLIER_REFERENCE",
      subtotal: null,
    };
    ambiguo.quality = "PARTIAL";
    ambiguo.totalIndustrialCost = null;
    vi.mocked(calculateIndustrialCost).mockResolvedValue(ambiguo);

    renderSecao();
    fireEvent.click(screen.getByRole("button", { name: "Calcular custo" }));

    expect(await screen.findByText("Fonte do custo por material")).toBeInTheDocument();
    expect(screen.getAllByText("Ofertas disponíveis · seleção necessária").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Existem várias ofertas válidas de fornecedor e nenhuma está definida como preferencial/),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Seleção automática/ })).toBeChecked();
    // Nada foi forçado sozinho: "Referência manual forçada" só aparece por escolha.
    expect(screen.queryByText("Referência manual forçada")).not.toBeInTheDocument();
  });

  it("voltar para a seleção automática recalcula sem substituição nenhuma", async () => {
    renderSecao();
    fireEvent.click(screen.getByRole("button", { name: "Calcular custo" }));
    fireEvent.click(await screen.findByRole("radio", { name: /Forçar referência manual/ }));
    await waitFor(() => expect(previewIndustrialCost).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole("radio", { name: /Seleção automática/ }));
    // Sem substituições, a prévia volta ao caminho de sempre.
    await waitFor(() => expect(calculateIndustrialCost).toHaveBeenCalledTimes(2));
    expect(previewIndustrialCost).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Completo — referências reais de compra")).toBeInTheDocument();
  });
});
