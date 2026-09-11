import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  IndustrialCostCalculationSnapshotDTO,
  PricingVersionDTO,
  ProductCmvResponse,
} from "@veridi/shared";
import { COST_PER_1000_LABEL } from "@veridi/shared";
import { CmvPrintPage } from "./CmvPrintPage";
import { CostCalculationPrintPage } from "./CostCalculationPrintPage";
import { PricingPrintPage } from "./PricingPrintPage";

/**
 * COST-BASIS-UX-01 nos três impressos.
 *
 * O papel é pior que a tela para este defeito: não há ⓘ para abrir, e quem
 * recebe o documento não estava na conversa em que a base foi escolhida. Por
 * isso cada um destes documentos precisa imprimir a quantidade calculada, o
 * total DAQUELA quantidade, o custo por unidade e a equivalência por 1.000
 * nomeada como equivalência, com a ressalva escrita junto.
 *
 * Os números são os da prova do motor (`cost-basis-scale.test.ts`): base 300
 * custa R$ 201,00 e equivale a R$ 670,00 por 1.000, enquanto calcular 1.000
 * de verdade daria R$ 767,00.
 *
 * Cálculo de custo e precificação saem em PDF (`@react-pdf/renderer`): a
 * página monta o documento sobre a mesma carga de antes e o teste o lê como
 * DOM pelo mock do renderer — o arquivo real é provado em
 * `pdf/documents/cost-documents.test.tsx`. O CMV continua HTML e não passa
 * pelo renderer.
 */

vi.mock("../../lib/product-cmv-api", () => ({ getProductCmv: vi.fn() }));
vi.mock("../../lib/cost-calculation-api", () => ({ getIndustrialCostCalculation: vi.fn() }));
vi.mock("../../lib/pricing-api", () => ({ getPricingVersion: vi.fn() }));

// Documento PDF lido como DOM: as primitivas do renderer viram div/span.
vi.mock("@react-pdf/renderer", async () => ({ ...(await import("../../pdf/testing/react-pdf-dom")) }));

// A página manda gerar o arquivo; o teste captura o documento que ela montou.
const { renderPdfBlob } = vi.hoisted(() => ({ renderPdfBlob: vi.fn() }));
vi.mock("../../pdf/render", () => ({ renderPdfBlob, downloadPdf: vi.fn() }));

import { getProductCmv } from "../../lib/product-cmv-api";
import { getIndustrialCostCalculation } from "../../lib/cost-calculation-api";
import { getPricingVersion } from "../../lib/pricing-api";

const RESSALVA = /Não representa um novo cálculo de produção para 1\.000 unidades/i;

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

function calculoDe300(): IndustrialCostCalculationSnapshotDTO {
  return {
    id: "calc-1",
    code: "CALC-000001",
    calculatedByName: "Analista",
    structureStatusAtCalculation: "ACTIVE",
    notes: null,
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
  } as unknown as IndustrialCostCalculationSnapshotDTO;
}

/** Duas faixas sobre base 300: 300 em um lote, 1.000 em quatro. */
function precificacao(): PricingVersionDTO {
  const faixa = (
    id: string,
    quantity: string,
    batchCount: string,
    total: string,
    perUnit: string,
    per1000: string,
  ) =>
    ({
      id,
      quantity,
      uomCode: "un",
      priceMode: "MANUAL_PRICE",
      targetContributionMarginPercent: null,
      commissionPercent: "0",
      manualUnitPrice: "2.00",
      notes: null,
      sortOrder: 0,
      industrialCostTotal: total,
      industrialCostPerUnit: perUnit,
      costPer1000: per1000,
      knownSubtotal: total,
      costQuality: "COMPLETE_REAL_REFERENCE",
      batchCount,
      suggestedUnitPrice: null,
      selectedUnitPrice: "2.00",
      commissionPerUnit: "0.00",
      commissionTotal: "0.00",
      grossRevenue: "600.00",
      contributionPerUnit: "1.33",
      contributionTotal: "399.00",
      contributionMarginPercent: "66.50",
      markupPercent: "198.51",
      warnings: [],
    }) as PricingVersionDTO["tiers"][number];

  return {
    id: "prc-1",
    code: "PRC-000001",
    label: "PRC-000001 · V1",
    versionNumber: 1,
    status: "ACTIVE",
    productId: "prod-1",
    productCode: "PROD-000003",
    productName: "Whey Protein DEMO",
    customerName: "NutriViva",
    industrialCostCalculationId: "calc-1",
    calculationCode: "CALC-000001",
    originPricingPolicyVersionId: null,
    originPricingPolicyCode: null,
    originPricingPolicyVersionNumber: null,
    originPricingPolicyName: null,
    industrialCostVersionLabel: "EC-000001 · V1",
    formulationVersionNumber: 1,
    costReferenceDate: "2026-09-09T00:00:00.000Z",
    costQuality: "COMPLETE_REAL_REFERENCE",
    referenceOutputQuantity: "300",
    referenceOutputUomCode: "un",
    minimumBatchQuantity: null,
    tiers: [
      faixa("t1", "300", "1", "201.00", "0.67", "670.00"),
      faixa("t2", "1000", "4", "767.00", "0.767", "767.00"),
    ],
    pricingComplete: true,
    hasCustomerSuppliedMaterials: false,
    warnings: [],
    notes: null,
    createdAt: "2026-09-09T12:00:00.000Z",
    createdByName: "Analista",
    activatedAt: "2026-09-09T13:00:00.000Z",
    activatedByName: "Analista",
  } as unknown as PricingVersionDTO;
}

/** A linha da tabela impressa cujo rótulo bate — para conferir o valor ao lado. */
function linhaDe(rotulo: RegExp): HTMLElement {
  return screen.getByText(rotulo).closest("tr") as HTMLElement;
}

/** O arquivo "sai" sem motor de PDF: a tela recebe um blob e mostra o nome. */
function prepararPdf() {
  renderPdfBlob.mockReset().mockResolvedValue(new Blob(["%PDF-1.3"], { type: "application/pdf" }));
  URL.createObjectURL = vi.fn(() => "blob:veridi/pdf-1");
  URL.revokeObjectURL = vi.fn();
}

/** O documento que a página montou e mandou gerar. */
async function documentoGerado(): Promise<ReactElement> {
  await waitFor(() => expect(renderPdfBlob).toHaveBeenCalledTimes(1));
  return renderPdfBlob.mock.calls[0]![0] as ReactElement;
}

/** A linha da tabela do PDF cujo rótulo bate — para conferir o valor ao lado. */
function linhaDoPdf(rotulo: RegExp): HTMLElement {
  return screen.getByText(rotulo).closest('[data-pdf-role="row"]') as HTMLElement;
}

describe("CMV impresso — a base viaja com o total", () => {
  it("imprime quantidade calculada, total daquela quantidade, unitário e equivalência", async () => {
    vi.mocked(getProductCmv).mockResolvedValue(cmvDe300());
    render(
      <MemoryRouter initialEntries={["/impressos/cmv/prod-1?quantity=300&referenceDate=2026-09-09"]}>
        <Routes>
          <Route path="/impressos/cmv/:productId" element={<CmvPrintPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const quantidade = (await screen.findByText("Quantidade calculada")).closest("tr")!;
    expect(quantidade.textContent).toContain("300 un");
    expect(within(linhaDe(/CMV total para 300 un/i)).getByText(/201,00/)).toBeTruthy();
    expect(within(linhaDe(/^CMV por unidade$/)).getByText(/0,67/)).toBeTruthy();

    const equivalencia = linhaDe(new RegExp(COST_PER_1000_LABEL, "i"));
    expect(within(equivalencia).getByText(/670,00/)).toBeTruthy();
    // Sem ⓘ no papel, a ressalva vai impressa.
    expect(within(equivalencia).getByText(RESSALVA)).toBeTruthy();
    expect(screen.queryByText("CMV por 1.000 unidades")).toBeNull();
  });
});

describe("Cálculo de custo impresso — a base viaja com o total", () => {
  beforeEach(prepararPdf);

  it("imprime quantidade calculada, total daquela quantidade, unitário e equivalência", async () => {
    vi.mocked(getIndustrialCostCalculation).mockResolvedValue(calculoDe300());
    render(
      <MemoryRouter initialEntries={["/impressos/calculo/calc-1"]}>
        <Routes>
          <Route path="/impressos/calculo/:id" element={<CostCalculationPrintPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // A página gera o PDF sobre a mesma carga de antes; o arquivo leva o código do cálculo.
    render(await documentoGerado());
    expect(getIndustrialCostCalculation).toHaveBeenCalledWith("calc-1");
    expect(await screen.findByTitle("Documento CALC-000001.pdf")).toBeInTheDocument();

    await screen.findByText(/Custo industrial total para 300 un/i);
    expect(within(linhaDoPdf(/Custo industrial total para 300 un/i)).getByText(/201,00/)).toBeTruthy();
    expect(within(linhaDoPdf(/^Custo por unidade$/)).getByText(/0,67/)).toBeTruthy();
    // A base aparece duas vezes de propósito: no cabeçalho do documento e na
    // linha do total. Quem lê o resumo financeiro não volta ao cabeçalho.
    expect(screen.getAllByText("Quantidade calculada").length).toBeGreaterThanOrEqual(2);

    const equivalencia = linhaDoPdf(new RegExp(COST_PER_1000_LABEL, "i"));
    expect(within(equivalencia).getByText(/670,00/)).toBeTruthy();
    expect(within(equivalencia).getByText(RESSALVA)).toBeTruthy();
    expect(screen.queryByText("Custo por 1.000 unidades")).toBeNull();
  });
});

describe("Precificação impressa — cada faixa é da sua quantidade", () => {
  beforeEach(prepararPdf);

  it("nomeia a coluna como equivalência e imprime a ressalva sob a tabela", async () => {
    vi.mocked(getPricingVersion).mockResolvedValue(precificacao());
    render(
      <MemoryRouter initialEntries={["/impressos/precificacao/prc-1"]}>
        <Routes>
          <Route path="/impressos/precificacao/:id" element={<PricingPrintPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // A página gera o PDF sobre a mesma carga de antes; o arquivo leva código e versão.
    render(await documentoGerado());
    expect(getPricingVersion).toHaveBeenCalledWith("prc-1");
    expect(await screen.findByTitle("Documento PRC-000001-V1.pdf")).toBeInTheDocument();

    // É cabeçalho de coluna — no PDF, a faixa de cabeçalho da tabela.
    const cabecalho = await screen.findByText(COST_PER_1000_LABEL);
    const faixaDeCabecalho = cabecalho.closest('[data-pdf-role="header-row"]') as HTMLElement;
    expect(faixaDeCabecalho).not.toBeNull();
    expect(screen.getByText("Custo total da faixa")).toBeTruthy();
    expect(screen.queryByText("Custo/1.000")).toBeNull();
    const ressalva = screen.getByText(RESSALVA);

    // A prova de que as duas coisas são diferentes está na própria tabela:
    // o equivalente por 1.000 da faixa de 300 é R$ 670,00, e o custo real
    // da faixa de 1.000 é R$ 767,00.
    const tabelaDeCusto = faixaDeCabecalho.parentElement as HTMLElement;
    const linhas = Array.from(tabelaDeCusto.querySelectorAll<HTMLElement>('[data-pdf-role="row"]'));
    // Quantidade não agrupa milhar nesta base: 1000 un, não 1.000 un.
    const faixa300 = linhas.find((linha) => linha.textContent?.startsWith("300 un"))!;
    const faixa1000 = linhas.find((linha) => linha.textContent?.startsWith("1000 un"))!;
    expect(faixa300.textContent).toContain("670,00");
    expect(faixa1000.textContent).toContain("767,00");
    // A ressalva vem SOB a tabela de custo, não perdida em outra seção.
    expect(tabelaDeCusto.compareDocumentPosition(ressalva) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
