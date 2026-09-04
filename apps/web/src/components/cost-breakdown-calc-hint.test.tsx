import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { IndustrialCostCalculationDTO, IndustrialMaterialCostLineDTO } from "@veridi/shared";
import { CostBreakdown } from "./CostBreakdown";

/**
 * A conta de cada material, com os números da linha — e conferida.
 *
 * `6,12 kg × R$ 1.200,00 = R$ 7.344,00` precisa fechar; quando a referência
 * manual foi forçada, a nota diz a fonte usada E a que teria sido usada. E
 * material do cliente é "Não aplicável": nem zero, nem desconhecido.
 */

function material(overrides: Partial<IndustrialMaterialCostLineDTO> = {}): IndustrialMaterialCostLineDTO {
  return {
    itemId: "item-1",
    itemCode: "MP-000010",
    itemName: "Coenzima Q10",
    requiredQuantity: "6.12",
    unitCode: "kg",
    customerSupplied: false,
    unitCost: "1200.000000",
    costSource: "MANUAL_REFERENCE_FORCED",
    costSourceDetails: null,
    subtotal: "7344.00",
    manualReference: null,
    override: {
      reason: "Lote promocional não representa o custo corrente",
      automaticSource: "WEIGHTED_AVG_30D",
      automaticUnitCost: "1050.000000",
      automaticDetails: null,
      automaticSubtotal: "6426.00",
      impact: "918.00",
      referenceId: "ref-1",
      referenceEffectiveFrom: "2026-09-01T00:00:00.000Z",
      forcedByName: "Ana",
      forcedAt: "2026-09-04T12:00:00.000Z",
    },
    ...overrides,
  };
}

function resultado(materials: IndustrialMaterialCostLineDTO[]): IndustrialCostCalculationDTO {
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
    referenceOutputQuantity: "1000",
    referenceOutputUomCode: "un",
    unitsPerShippingBox: null,
    costReferenceDate: "2026-09-04T12:00:00.000Z",
    calculatedAt: "2026-09-04T12:00:00.000Z",
    materials,
    resources: [],
    manualLines: [],
    customerSuppliedMaterials: [],
    hasCustomerSuppliedMaterials: false,
    energyCalculationMode: "NONE",
    derivedEnergyKwh: null,
    energyRate: null,
    materialsSubtotalKnown: "7344.00",
    laborSubtotalKnown: "0.00",
    equipmentSubtotalKnown: "0.00",
    energySubtotal: null,
    secondaryPackagingSubtotalKnown: "0.00",
    thirdPartySubtotalKnown: "0.00",
    otherSubtotalKnown: "0.00",
    overheadSubtotalKnown: "0.00",
    directIndustrialCost: null,
    totalIndustrialCost: null,
    knownSubtotal: "7344.00",
    costPerUnit: null,
    costPer1000: null,
    quality: "PARTIAL",
    warnings: [],
  };
}

function renderBreakdown(materials: IndustrialMaterialCostLineDTO[]) {
  return render(
    <MemoryRouter>
      <CostBreakdown result={resultado(materials)} />
    </MemoryRouter>,
  );
}

describe("CostBreakdown — conta por material", () => {
  it("mostra a conta com os números da linha, fecha, e diz a fonte automática quando forçada", () => {
    renderBreakdown([material()]);

    fireEvent.click(screen.getByRole("button", { name: /Subtotal de MP-000010/i }));
    expect(screen.getByText("6,12")).toBeInTheDocument();
    expect(screen.getAllByText("R$ 1.200,00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("R$ 7.344,00").length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Fonte: Referência manual forçada\. Fonte automática: Compra real · média 30 dias · R\$ 1\.050,00\/kg/),
    ).toBeInTheDocument();

    // Auditoria da substituição, lida do documento.
    expect(screen.getByText("Forçada")).toBeInTheDocument();
    expect(screen.getByText(/\+ R\$ 918,00/)).toBeInTheDocument();
    expect(screen.getByText(/Motivo: Lote promocional/)).toBeInTheDocument();
    expect(screen.getByText(/Por Ana em/)).toBeInTheDocument();
    expect(screen.getByText(/seleciona automaticamente a melhor fonte/)).toBeInTheDocument();
  });

  it("material do cliente é 'Não aplicável' — nem zero, nem desconhecido", () => {
    renderBreakdown([
      material({
        customerSupplied: true,
        unitCost: null,
        costSource: "EXCLUDED_CUSTOMER_SUPPLIED",
        subtotal: null,
        override: null,
      }),
    ]);

    // Na LINHA do material: os subtotais zerados de mão de obra/equipamento
    // no resumo são zeros explícitos, e não estão em questão aqui.
    const tabela = screen.getAllByRole("table")[0]!;
    expect(within(tabela).getAllByText("Não aplicável")).toHaveLength(2);
    expect(within(tabela).queryByText(/R\$\s?0,00/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Subtotal de MP-000010/i }));
    expect(screen.getByText("não aplicável")).toBeInTheDocument();
    expect(screen.getByText(/mesmo que o item tenha referência manual/)).toBeInTheDocument();
  });

  it("custo desconhecido é travessão, e a conta não é inventada", () => {
    renderBreakdown([
      material({ unitCost: null, costSource: "NO_COST", subtotal: null, override: null }),
    ]);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Subtotal de MP-000010/i })).not.toBeInTheDocument();
    expect(screen.getByText("Sem referência de custo")).toBeInTheDocument();
  });
});
