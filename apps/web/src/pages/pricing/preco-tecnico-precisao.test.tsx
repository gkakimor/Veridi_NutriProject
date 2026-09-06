import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PricingTierDTO, PricingTierPreviewDTO, PricingVersionDTO } from "@veridi/shared";

/**
 * Casa oculta do preço TÉCNICO da precificação — PREC-P-TECH, §57 e §60.
 *
 * As colunas de preço da faixa guardam oito casas desde esta capability, e a
 * API passou a servi-las. O risco que sobra é o da tela: um campo que devolve
 * ao servidor o que a máscara mostrou gravaria `R$ 4,05` no lugar de
 * `4,05318764` sem que ninguém tenha editado nada, e o número pareceria certo.
 *
 * A leitura formatada continua sendo leitura. `formatUnitCost` mostra dois
 * centavos porque é o que se lê numa tabela de preço — apresentação, não
 * armazenamento —, e nenhum caminho da tela transforma essa máscara no valor
 * persistido.
 */

vi.mock("../../lib/pricing-api", () => ({
  getPricingVersion: vi.fn(),
  previewPricingTier: vi.fn(),
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

import {
  activatePricingVersion,
  createPricingTier,
  getPricingVersion,
  previewPricingTier,
} from "../../lib/pricing-api";
import { PricingPage } from "./PricingPage";

/** O preço técnico do acceptance, como a API o serve: o scale da coluna. */
const PRECO_TECNICO = "4.05318764";

function custo(overrides: Partial<PricingTierPreviewDTO> = {}): PricingTierPreviewDTO {
  return {
    quantity: "500",
    uomCode: "un",
    priceMode: "MANUAL_PRICE",
    targetContributionMarginPercent: null,
    commissionPercent: "0.0000",
    manualUnitPrice: null,
    industrialCostTotal: "1600.00",
    industrialCostPerUnit: "3.200000",
    costPer1000: "3200.00",
    knownSubtotal: "1600.00",
    costQuality: "COMPLETE_REAL_REFERENCE",
    batchCount: "1",
    suggestedUnitPrice: null,
    selectedUnitPrice: null,
    commissionPerUnit: null,
    commissionTotal: null,
    grossRevenue: null,
    contributionPerUnit: null,
    contributionTotal: null,
    contributionMarginPercent: null,
    markupPercent: null,
    warnings: [],
    ...overrides,
  };
}

function faixaTecnica(): PricingTierDTO {
  return {
    id: "tier-1",
    notes: null,
    sortOrder: 0,
    ...custo(),
    priceMode: "MANUAL_PRICE",
    // O que a API serve depois do PREC-P-TECH: oito casas, não seis.
    manualUnitPrice: PRECO_TECNICO,
    selectedUnitPrice: PRECO_TECNICO,
    commissionPercent: "5.0000",
    commissionPerUnit: "0.202659",
    contributionPerUnit: "0.650524",
    contributionMarginPercent: "16.0500",
    markupPercent: "26.6621",
    grossRevenue: "2026.59",
    commissionTotal: "101.33",
    contributionTotal: "325.26",
  };
}

function versao(overrides: Partial<PricingVersionDTO> = {}): PricingVersionDTO {
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
    costQuality: "COMPLETE_REAL_REFERENCE",
    referenceOutputQuantity: "1000",
    referenceOutputUomCode: "un",
    minimumBatchQuantity: null,
    tiers: [faixaTecnica()],
    pricingComplete: true,
    hasCustomerSuppliedMaterials: false,
    warnings: [],
    notes: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdByName: "Teste",
    activatedAt: null,
    activatedByName: null,
    ...overrides,
  };
}

async function abrir(dto = versao()) {
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

const campo = (nome: string) => screen.getByLabelText(nome) as HTMLInputElement;

async function adicionarFaixaManual(preco: string) {
  const user = userEvent.setup();
  fireEvent.change(campo("Quantidade"), { target: { value: "500" } });
  fireEvent.change(screen.getByLabelText("Modo de preço"), { target: { value: "MANUAL_PRICE" } });
  fireEvent.change(campo("Preço unitário"), { target: { value: preco } });
  vi.mocked(createPricingTier).mockResolvedValue(versao());
  await user.click(screen.getByRole("button", { name: "Adicionar faixa" }));
  await waitFor(() => expect(createPricingTier).toHaveBeenCalled());
  return vi.mocked(createPricingTier).mock.calls[0]![1] as unknown as Record<string, string>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(previewPricingTier).mockResolvedValue(custo());
});

describe("preço técnico da faixa na tela de Precificação", () => {
  it("a tabela mostra a máscara de leitura sem que o valor servido mude", async () => {
    await abrir();

    // `formatUnitCost` mostra R$ 4,05 — leitura de tabela de preço. A máscara
    // é apresentação; o DTO continua carregando as oito casas, e é ele que
    // qualquer escrita usaria.
    const tabela = document.querySelector("table")?.textContent ?? "";
    expect(tabela.replace(/[  ]/g, " ")).toContain("R$ 4,05");
    expect(tabela).not.toContain("4,05318764");
  });

  it("digitar 8 casas chega ao servidor inteiro, sem cortar", async () => {
    await abrir(versao({ tiers: [] }));

    const payload = await adicionarFaixaManual("4,05318764");
    expect(payload.manualUnitPrice).toBe(PRECO_TECNICO);
  });

  it("digitar o menor valor da coluna não vira zero", async () => {
    await abrir(versao({ tiers: [] }));

    const payload = await adicionarFaixaManual("0,00000001");
    expect(payload.manualUnitPrice).toBe("0.00000001");
  });

  it("ativar não reenvia preço nenhum — a tela não reescreve a faixa gravada", async () => {
    const user = userEvent.setup();
    await abrir();
    vi.mocked(activatePricingVersion).mockResolvedValue(versao({ status: "ACTIVE" }));

    await user.click(screen.getByRole("button", { name: "Ativar precificação" }));

    await waitFor(() => expect(activatePricingVersion).toHaveBeenCalled());
    /*
     * A ativação manda só as confirmações. Não existe caminho na tela que
     * devolva ao servidor o preço da faixa já gravada — é assim que a casa
     * oculta sobrevive a abrir e salvar: nada a reenvia.
     */
    const enviado = vi.mocked(activatePricingVersion).mock.calls[0]![1] as Record<string, unknown>;
    expect(JSON.stringify(enviado)).not.toContain("4.05");
    expect(Object.keys(enviado).sort()).toEqual([
      "confirmIncompleteCost",
      "confirmOutdatedStructure",
    ]);
    expect(createPricingTier).not.toHaveBeenCalled();
  });
});
