import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { IndustrialCostQuality, PricingTierDTO, PricingVersionDTO } from "@veridi/shared";

/**
 * Precificação — COST-PRICING-CLARITY-WAVE-01.
 *
 * PRICING-ACTIVATE-CONFIRM-01: "Ativar precificação" pedia a confirmação de
 * custo incompleto pela qualidade do CÁLCULO (`costQuality`), enquanto o
 * servidor pesa a da base que FORMA o preço (§84). Num Modelo que não usa a
 * conversão do ERP, energia sem tarifa deixava o cálculo parcial e a tela
 * perguntava à toa. A tela agora lê `pricingCostQuality`, a mesma autoridade.
 *
 * F-05-1: preço e receita da faixa são técnicos; o orçamento fecha o preço na
 * precisão comercial. A tela diz por que os dois podem diferir em centavos.
 */

vi.mock("../../lib/pricing-api", () => ({
  getPricingVersion: vi.fn(),
  previewPricingTier: vi.fn(() => Promise.reject(new Error("sem prévia"))),
  createPricingTier: vi.fn(),
  deletePricingTier: vi.fn(),
  activatePricingVersion: vi.fn(),
  getPricingRebasePreview: vi.fn(() => Promise.reject(new Error("sem base nova"))),
  rebasePricingVersion: vi.fn(),
}));
vi.mock("../../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));
vi.mock("../cost-templates/PricingPolicyOrigin", () => ({ PricingPolicyOrigin: () => null }));
vi.mock("../../components/ProjectOriginLink", () => ({ ProjectOriginLink: () => null }));
vi.mock("../../components/ProductRelatedLinks", () => ({ ProductRelatedLinks: () => null }));

import { activatePricingVersion, getPricingVersion } from "../../lib/pricing-api";
import { PricingPage } from "./PricingPage";

function faixa(qualidades: {
  costQuality: IndustrialCostQuality;
  pricingCostQuality?: IndustrialCostQuality;
}): PricingTierDTO {
  return {
    id: "tier-1",
    notes: null,
    sortOrder: 0,
    quantity: "1000",
    uomCode: "un",
    priceMode: "TARGET_MARGIN",
    targetContributionMarginPercent: "35.0000",
    commissionPercent: "5.0000",
    manualUnitPrice: null,
    industrialCostTotal: null,
    industrialCostPerUnit: null,
    costPer1000: null,
    knownSubtotal: "9000.00",
    batchCount: "1",
    suggestedUnitPrice: "16.44466150",
    selectedUnitPrice: "16.44466150",
    commissionPerUnit: "0.822233",
    commissionTotal: "822.23",
    grossRevenue: "16444.66",
    contributionPerUnit: null,
    contributionTotal: null,
    contributionMarginPercent: null,
    markupPercent: null,
    pricingCostPerUnit: "9.866797",
    warnings: [],
    ...qualidades,
  };
}

function versao(tier: PricingTierDTO): PricingVersionDTO {
  return {
    id: "prec-1",
    code: "PREC-000001",
    label: "PREC-000001 V1",
    versionNumber: 1,
    status: "DRAFT",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Whey 900 g",
    customerName: "NutriViva",
    industrialCostCalculationId: "calc-1",
    calculationCode: "CALC-000001",
    originPricingPolicyVersionId: null,
    originPricingPolicyCode: null,
    originPricingPolicyVersionNumber: null,
    originPricingPolicyName: null,
    industrialCostVersionLabel: "EC-000001 · V1",
    formulationVersionNumber: 1,
    costReferenceDate: "2026-09-01T00:00:00.000Z",
    costQuality: tier.costQuality,
    referenceOutputQuantity: "1000",
    referenceOutputUomCode: "un",
    minimumBatchQuantity: null,
    tiers: [tier],
    pricingComplete: true,
    hasCustomerSuppliedMaterials: false,
    warnings: [],
    notes: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdByName: "Teste",
    activatedAt: null,
    activatedByName: null,
  };
}

async function abrir(dto: PricingVersionDTO) {
  vi.mocked(getPricingVersion).mockResolvedValue(dto);
  render(
    <MemoryRouter initialEntries={["/gestao/precificacao/prec-1"]}>
      <Routes>
        <Route path="/gestao/precificacao/:pricingId" element={<PricingPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText("Prévia da faixa");
}

const TITULO_DA_CONFIRMACAO = "Ativar precificação com custo incompleto?";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Ativar precificação — a confirmação segue a autoridade do servidor", () => {
  it("cálculo parcial, mas o custo que forma o preço completo: ativa sem confirmação extra", async () => {
    const user = userEvent.setup();
    const tier = faixa({ costQuality: "PARTIAL", pricingCostQuality: "COMPLETE_REAL_REFERENCE" });
    await abrir(versao(tier));
    vi.mocked(activatePricingVersion).mockResolvedValue(versao(tier));

    await user.click(screen.getByRole("button", { name: "Ativar precificação" }));

    await waitFor(() => expect(activatePricingVersion).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(TITULO_DA_CONFIRMACAO)).toBeNull();
    expect(vi.mocked(activatePricingVersion).mock.calls[0]![1]).toEqual({
      confirmIncompleteCost: false,
      confirmOutdatedStructure: true,
    });
  });

  it.each([
    ["PARTIAL", "COMPLETE_REAL_REFERENCE"],
    ["NO_COST", "PARTIAL"],
  ] as const)(
    "custo que forma o preço %s (cálculo %s): pede confirmação, conta a faixa, e só confirma no clique",
    async (doPreco, doCalculo) => {
      const user = userEvent.setup();
      const tier = faixa({ costQuality: doCalculo, pricingCostQuality: doPreco });
      await abrir(versao(tier));
      vi.mocked(activatePricingVersion).mockResolvedValue(versao(tier));

      await user.click(screen.getByRole("button", { name: "Ativar precificação" }));

      expect(await screen.findByText(TITULO_DA_CONFIRMACAO)).toBeInTheDocument();
      expect(screen.getByText(/sem custo completo: 1/)).toBeInTheDocument();
      expect(activatePricingVersion).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Ativar" }));
      await waitFor(() =>
        expect(activatePricingVersion).toHaveBeenCalledWith("prec-1", {
          confirmIncompleteCost: true,
          confirmOutdatedStructure: true,
        }),
      );
    },
  );

  it("leitura sem a qualidade do preço: vale a do cálculo, como antes", async () => {
    const user = userEvent.setup();
    await abrir(versao(faixa({ costQuality: "PARTIAL" })));

    await user.click(screen.getByRole("button", { name: "Ativar precificação" }));

    expect(await screen.findByText(TITULO_DA_CONFIRMACAO)).toBeInTheDocument();
    expect(activatePricingVersion).not.toHaveBeenCalled();
  });
});

describe("F-05-1 — preço técnico × preço comercial, dito na tela", () => {
  it("com faixa: a tela explica a diferença de centavos pelo arredondamento, sem mudar o número", async () => {
    await abrir(versao(faixa({ costQuality: "COMPLETE_REAL_REFERENCE", pricingCostQuality: "COMPLETE_REAL_REFERENCE" })));

    const dica = screen.getByText(/precisão comercial/);
    expect(dica.textContent).toMatch(/técnicos/);
    expect(dica.textContent).toMatch(/alguns centavos, pelo arredondamento/);
    // A receita continua a técnica: 1000 × 16,4446615.
    expect(document.querySelector("table")?.textContent?.replace(/ /g, " ")).toContain("R$ 16.444,66");
  });

  it("sem faixa: nada a explicar", async () => {
    await abrir({ ...versao(faixa({ costQuality: "COMPLETE_REAL_REFERENCE" })), tiers: [] });
    expect(screen.queryByText(/precisão comercial/)).toBeNull();
  });
});
