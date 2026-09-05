import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PricingTierDTO, PricingTierPreviewDTO, PricingVersionDTO } from "@veridi/shared";

/**
 * Prévia da faixa antes de gravar (BACKLOG #8C).
 *
 * Preço, margem e contribuição só apareciam depois de "Adicionar faixa". A
 * prévia pede ao servidor o custo da quantidade (mesmo caminho da criação) e
 * calcula a parte comercial com `computePrice`, a conta canônica de
 * `@veridi/shared` que a API também usa. Nada disso grava.
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

import { createPricingTier, getPricingVersion, previewPricingTier } from "../../lib/pricing-api";
import { PricingPage } from "./PricingPage";

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

function faixa(overrides: Partial<PricingTierDTO> = {}): PricingTierDTO {
  return {
    id: "tier-1",
    notes: null,
    sortOrder: 0,
    ...custo(),
    priceMode: "TARGET_MARGIN",
    targetContributionMarginPercent: "35.0000",
    commissionPercent: "5.0000",
    suggestedUnitPrice: "5.333333",
    selectedUnitPrice: "5.333333",
    ...overrides,
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
    tiers: [],
    pricingComplete: false,
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

/** O texto da prévia com um espaço entre cada rótulo e valor, como se lê. */
const previa = () =>
  Array.from(document.querySelectorAll(".tier-preview h4, .tier-preview p, .tier-preview dt, .tier-preview dd"))
    .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
    .join(" ");
const campo = (nome: string) => screen.getByLabelText(nome) as HTMLInputElement;

async function digitarQuantidade(valor: string) {
  fireEvent.change(campo("Quantidade"), { target: { value: valor } });
  await waitFor(() => expect(previewPricingTier).toHaveBeenCalled(), { timeout: 2000 });
  await waitFor(() => expect(previa()).toContain("Custo utilizado"));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(previewPricingTier).mockResolvedValue(custo());
});

describe("Prévia da faixa de precificação", () => {
  it("sem quantidade não há prévia nem R$ 0,00 — só o pedido de preencher", async () => {
    await abrir();
    expect(previa()).toContain("Preencha a quantidade");
    expect(previa()).not.toContain("R$");
    expect(previewPricingTier).not.toHaveBeenCalled();
  });

  it("A–C/D/K. custo do servidor + preço pela fórmula canônica, e cada operando move o preço na hora", async () => {
    await abrir();
    await digitarQuantidade("500");

    // Só a quantidade vai ao servidor; percentuais entram na conta local.
    expect(previewPricingTier).toHaveBeenCalledWith("prec-1", {
      quantity: "500",
      priceMode: "MANUAL_PRICE",
      commissionPercent: "0",
    });
    expect(previa()).toContain("Custo utilizado (por unidade) R$ 3,20");
    // 3,20 ÷ (1 − 0,30 − 0,05) = 4,9231 — margem padrão 30, comissão 5.
    expect(previa()).toContain("Preço sugerido R$ 4,92");

    fireEvent.change(campo("Margem de contribuição desejada (%)"), { target: { value: "35" } });
    // 3,20 ÷ 0,60 = 5,3333
    expect(previa()).toContain("Preço sugerido R$ 5,33");
    expect(previa()).toContain("Margem resultante 35%");

    fireEvent.change(campo("Comissão (%)"), { target: { value: "10" } });
    // 3,20 ÷ 0,55 = 5,8182
    expect(previa()).toContain("Preço sugerido R$ 5,82");

    // Custo muda com a quantidade: o servidor devolve outro custo, o preço acompanha.
    vi.mocked(previewPricingTier).mockResolvedValue(custo({ quantity: "3000", industrialCostPerUnit: "2.750000", industrialCostTotal: "8250.00" }));
    fireEvent.change(campo("Quantidade"), { target: { value: "3000" } });
    await waitFor(() => expect(previa()).toContain("Custo utilizado (por unidade) R$ 2,75"), { timeout: 2000 });
    // 2,75 ÷ 0,55 = 5,00
    expect(previa()).toContain("Preço sugerido R$ 5,00");
    expect(createPricingTier).not.toHaveBeenCalled();
  });

  it("E. o CalcHint da prévia refaz a conta e não acusa divergência", async () => {
    await abrir();
    await digitarQuantidade("500");
    fireEvent.change(campo("Margem de contribuição desejada (%)"), { target: { value: "35" } });

    fireEvent.click(screen.getByRole("button", { name: "Ajuda sobre Preço sugerido (prévia)" }));

    expect(screen.getByText(/custo por unidade/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("F. operando faltante: sem preço falso", async () => {
    await abrir();
    await digitarQuantidade("500");
    fireEvent.change(campo("Margem de contribuição desejada (%)"), { target: { value: "" } });

    expect(previa()).toContain("Preencha a margem de contribuição desejada");
    expect(previa()).not.toContain("Preço sugerido R$");
    expect(previa()).not.toContain("R$ 0,00");
  });

  it("G. margem + comissão em 100% é bloqueada antes de gravar — sem Infinity, sem zero", async () => {
    await abrir();
    await digitarQuantidade("500");
    fireEvent.change(campo("Margem de contribuição desejada (%)"), { target: { value: "70" } });
    fireEvent.change(campo("Comissão (%)"), { target: { value: "30" } });

    expect(previa()).toContain("Margem somada à comissão atinge 100%");
    expect(previa()).not.toContain("Preço sugerido R$");
    expect(previa()).not.toMatch(/Infinity|NaN|R\$ 0,00/);
  });

  it("custo incompleto para a quantidade: preço pela margem indisponível, dito", async () => {
    vi.mocked(previewPricingTier).mockResolvedValue(
      custo({ industrialCostPerUnit: null, industrialCostTotal: null, knownSubtotal: "900.00", costQuality: "PARTIAL" }),
    );
    await abrir();
    await digitarQuantidade("500");

    expect(previa()).toContain("subtotal conhecido R$ 900,00");
    expect(previa()).toContain("indisponível — custo incompleto");
    expect(previa()).not.toContain("R$ 0,00");
  });

  it("quantidade repetida ou inválida: o servidor recusa e a prévia diz, sem gravar", async () => {
    vi.mocked(previewPricingTier).mockRejectedValue(new Error("Já existe faixa com a quantidade 500."));
    await abrir();
    fireEvent.change(campo("Quantidade"), { target: { value: "500" } });

    await screen.findByText("Já existe faixa com a quantidade 500.", undefined, { timeout: 2000 });
    expect(createPricingTier).not.toHaveBeenCalled();
  });

  it("H/I. a prévia não persiste; Adicionar faixa grava e a tabela mostra o mesmo preço", async () => {
    const user = userEvent.setup();
    await abrir();
    await digitarQuantidade("500");
    fireEvent.change(campo("Margem de contribuição desejada (%)"), { target: { value: "35" } });
    expect(previa()).toContain("Preço sugerido R$ 5,33");
    expect(createPricingTier).not.toHaveBeenCalled();

    vi.mocked(createPricingTier).mockResolvedValue(versao({ tiers: [faixa()] }));
    vi.mocked(getPricingVersion).mockResolvedValue(versao({ tiers: [faixa()] }));
    await user.click(screen.getByRole("button", { name: "Adicionar faixa" }));

    await waitFor(() =>
      expect(createPricingTier).toHaveBeenCalledWith("prec-1", {
        quantity: "500",
        priceMode: "TARGET_MARGIN",
        commissionPercent: "5",
        targetContributionMarginPercent: "35",
      }),
    );
    // A linha gravada mostra o mesmo preço que a prévia mostrou.
    await waitFor(() => expect(screen.getAllByText("R$ 5,33").length).toBeGreaterThan(0));
  });

  it("J. limpar a quantidade descarta a prévia", async () => {
    await abrir();
    await digitarQuantidade("500");
    expect(previa()).toContain("Preço sugerido R$");

    fireEvent.change(campo("Quantidade"), { target: { value: "" } });

    expect(previa()).toContain("Preencha a quantidade");
    expect(previa()).not.toContain("R$");
  });
});
