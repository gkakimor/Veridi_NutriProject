import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { IndustrialCostCalculationDTO, ProductCmvResponse } from "@veridi/shared";
import { COST_PER_1000_LABEL } from "@veridi/shared";
import { ProductCmvPage } from "./ProductCmvPage";
import { CostBreakdown } from "../../components/CostBreakdown";

/**
 * COST-BASIS-UX-01 — a tela diz para QUAL quantidade ela calculou.
 *
 * No walkthrough real a base de produção era 300 unidades e a tela destacava
 * "custo por 1.000". A usuária não soube dizer se o sistema havia calculado
 * 300 ou 1.000 — e essa dúvida, sozinha, invalida o número como apoio de
 * decisão. A auditoria do motor (`cost-basis-scale.test.ts`, na API) provou
 * que a matemática estava certa: o defeito era apresentar um total e uma
 * razão com o mesmo peso, sem dizer qual é qual.
 *
 * Estes testes protegem a hierarquia, não o pixel: a quantidade calculada
 * acompanha o total, e o equivalente por 1.000 aparece rotulado como
 * equivalência e visualmente secundário.
 */

vi.mock("../../lib/product-cmv-api", () => ({ getProductCmv: vi.fn() }));
vi.mock("../../lib/pricing-api", () => ({ getProductPricing: vi.fn() }));
vi.mock("../../lib/industrial-costs-api", () => ({
  getProductIndustrialCosts: () => Promise.resolve({ current: null, draft: null }),
}));
vi.mock("../../components/ProjectOriginLink", () => ({ ProjectOriginLink: () => null }));

import { getProductCmv } from "../../lib/product-cmv-api";
import { getProductPricing } from "../../lib/pricing-api";

/**
 * Execução de 300 sobre base 300 — os números vêm da prova do motor: total
 * R$ 201,00, unitário R$ 0,67, equivalente por 1.000 R$ 670,00. Calcular
 * 1.000 de verdade daria R$ 767,00, e é essa diferença que a copy explica.
 */
function cmvDe300(): ProductCmvResponse {
  return {
    productId: "prod-1",
    productCode: "PROD-000003",
    productName: "Whey Protein DEMO",
    customerName: "NutriViva",
    outputUomCode: "un",
    formulationVersionId: "form-1",
    formulationVersionNumber: 1,
    basisFormulationVersionId: "form-1",
    basisFormulationVersionNumber: 1,
    industrialCostVersionId: "ec-1",
    industrialCostVersionLabel: "EC-000001 · V1",
    referenceOutputQuantity: "300",
    referenceOutputUomCode: "un",
    calculationId: "calc-1",
    calculationCode: "CALC-000001",
    calculationReferenceDate: "2026-09-09T00:00:00.000Z",
    referenceDate: "2026-09-09T00:00:00.000Z",
    live: null,
    simulation: {
      quantity: "300",
      uomCode: "un",
      batchCount: "1",
      totalCost: "201.0000",
      costPerUnit: "0.6700",
      costPer1000: "670.0000",
      knownSubtotal: "201.0000",
      quality: "COMPLETE_REAL_REFERENCE",
      warnings: [],
      hasCustomerSuppliedMaterials: false,
      components: [],
    },
    unavailableReason: null,
    pricing: null,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/produtos/prod-1/cmv?quantity=300"]}>
      <Routes>
        <Route path="/produtos/:productId/cmv" element={<ProductCmvPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Cálculo salvo de base 300, com os mesmos números da prova do motor. */
function calculoDe300(): IndustrialCostCalculationDTO {
  return {
    industrialCostVersionId: "ec-1",
    industrialCostVersionLabel: "EC-000001 · V1",
    structureStatus: "ACTIVE",
    draftReference: false,
    productId: "prod-1",
    productCode: "PROD-000003",
    productName: "Whey Protein DEMO",
    customerName: "NutriViva",
    formulationVersionNumber: 1,
    referenceOutputQuantity: "300",
    referenceOutputUomCode: "un",
    unitsPerShippingBox: 120,
    costReferenceDate: "2026-09-09T00:00:00.000Z",
    calculatedAt: "2026-09-09T12:00:00.000Z",
    materials: [],
    resources: [],
    manualLines: [],
    customerSuppliedMaterials: [],
    hasCustomerSuppliedMaterials: false,
    energyCalculationMode: "FROM_EQUIPMENT",
    derivedEnergyKwh: "15",
    energyRate: "0.80",
    materialsSubtotalKnown: "30.00",
    laborSubtotalKnown: "60.00",
    equipmentSubtotalKnown: "30.00",
    energySubtotal: "12.00",
    secondaryPackagingSubtotalKnown: "3.00",
    thirdPartySubtotalKnown: "66.00",
    otherSubtotalKnown: "0.00",
    overheadSubtotalKnown: "0.00",
    directIndustrialCost: "201.00",
    totalIndustrialCost: "201.00",
    knownSubtotal: "201.00",
    costPerUnit: "0.670000000000",
    costPer1000: "670.00",
    quality: "COMPLETE_REAL_REFERENCE",
    warnings: [],
  } as unknown as IndustrialCostCalculationDTO;
}

describe("CMV do produto — a quantidade calculada manda na hierarquia", () => {
  beforeEach(() => {
    vi.mocked(getProductCmv).mockResolvedValue(cmvDe300());
    vi.mocked(getProductPricing).mockResolvedValue({ current: null } as never);
  });

  it("o total é rotulado COM a quantidade que ele responde", async () => {
    renderPage();
    // Não basta "300" existir em algum lugar da tela: ele precisa estar no
    // rótulo do total, que é onde a dúvida nasceu.
    const rotulo = await screen.findByText(/CMV total para 300 un/i);
    const cartao = rotulo.closest(".cmv-card") as HTMLElement;
    expect(within(cartao).getByText(/201,00/)).toBeTruthy();
  });

  it("o por 1.000 se apresenta como EQUIVALÊNCIA e fica secundário", async () => {
    renderPage();
    const rotulo = await screen.findByText(new RegExp(COST_PER_1000_LABEL, "i"));
    const cartao = rotulo.closest(".cmv-card") as HTMLElement;
    // Secundário é uma decisão declarada em classe, não um snapshot de pixel.
    expect(cartao.className).toContain("cmv-card--secondary");
    expect(within(cartao).getByText(/670,00/)).toBeTruthy();
    // E o cartão do total continua sendo o de destaque.
    const total = screen.getByText(/CMV total para 300 un/i).closest(".cmv-card") as HTMLElement;
    expect(total.className).toContain("cmv-card--strong");
    expect(total.className).not.toContain("cmv-card--secondary");
  });

  it("nenhum texto sugere que o cálculo foi feito para 1.000", async () => {
    renderPage();
    await screen.findByText(/CMV total para 300 un/i);
    // "CMV por 1.000" sem "equivalente" era exatamente o rótulo ambíguo.
    expect(screen.queryByText(/^CMV por 1\.000$/)).toBeNull();
    expect(screen.queryByText(/^Custo por 1\.000 unidades$/)).toBeNull();
  });

  it("a explicação diz que a equivalência não é um novo cálculo de produção", async () => {
    renderPage();
    const rotulo = await screen.findByText(new RegExp(`^${COST_PER_1000_LABEL}$`, "i"));
    const cartao = rotulo.closest(".cmv-card") as HTMLElement;
    // Um único ⓘ no cartão: dois com o mesmo nome acessível seriam dois
    // destinos idênticos para teclado e leitor de tela.
    const gatilhos = within(cartao).getAllByRole("button", {
      name: new RegExp(`Ajuda sobre ${COST_PER_1000_LABEL}`, "i"),
    });
    expect(gatilhos).toHaveLength(1);
    fireEvent.click(gatilhos[0]!);
    await waitFor(() => {
      expect(
        within(cartao).getByText(
          /Não representa um novo cálculo de produção para 1\.000 unidades/i,
        ),
      ).toBeTruthy();
    });
  });
});

describe("Detalhamento do cálculo — a base fica ao lado do total", () => {
  it("ancora a quantidade calculada e rebaixa o equivalente por 1.000", () => {
    const { container } = render(<CostBreakdown result={calculoDe300()} />);

    const quantidade = screen.getByText("Quantidade calculada");
    expect(quantidade.nextElementSibling?.textContent).toContain("300 un");

    // O total responde uma pergunta com quantidade dentro do próprio rótulo.
    const total = screen.getByText(/Custo industrial total para 300 un/i);
    expect(total.nextElementSibling?.textContent).toContain("201,00");

    expect(screen.getByText("Custo por unidade").nextElementSibling?.textContent).toContain("0,67");

    const equivalente = container.querySelector("dt.is-secondary") as HTMLElement;
    expect(equivalente.textContent).toContain(COST_PER_1000_LABEL);
    expect(equivalente.nextElementSibling?.className).toContain("is-secondary");
    expect(equivalente.nextElementSibling?.textContent).toContain("670,00");

    // O rótulo ambíguo não sobreviveu em lugar nenhum do bloco.
    expect(screen.queryByText("Custo por 1.000 unidades")).toBeNull();
  });
});
