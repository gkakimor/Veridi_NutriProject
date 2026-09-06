import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PricingTierDTO, PricingTierPreviewDTO, PricingVersionDTO } from "@veridi/shared";

/**
 * Casa oculta do RESULTADO TÉCNICO da precificação — PREC-MIG-D, §57.
 *
 * `PricingTier.commissionPerUnitSnapshot` e `.contributionPerUnitSnapshot`
 * guardam doze casas desde esta capability, e a API passou a servi-las. O
 * risco que sobra é o da tela, e ele é de DOIS tipos:
 *
 * 1. a máscara de leitura virar o valor persistido — não vira: comissão e
 *    contribuição por unidade são resultado DERIVADO, ninguém as digita, e
 *    nenhum caminho da tela as devolve ao servidor;
 * 2. a tela recalcular a prévia sobre um custo já cortado — era o caso antes
 *    do PREC-MIG-D: o DTO servia `industrialCostPerUnit` em seis casas e o
 *    motor do navegador partia dali, enquanto o servidor usava as doze da
 *    coluna. Agora os dois partem do mesmo número.
 *
 * A leitura formatada continua sendo leitura: `formatUnitCost` mostra dois
 * centavos porque é o que se lê numa tabela de preço (§57, armazenamento ≠
 * apresentação).
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

/** Custo unitário como a API o serve depois do PREC-MIG-D: `DECIMAL(24,12)`. */
const CUSTO_12_CASAS = "3.141592650000";
/** Comissão e contribuição por unidade, no scale da coluna. */
const COMISSAO_12_CASAS = "0.202659333333";
const CONTRIBUICAO_12_CASAS = "0.650524111111";

function custo(overrides: Partial<PricingTierPreviewDTO> = {}): PricingTierPreviewDTO {
  return {
    quantity: "500",
    uomCode: "un",
    priceMode: "MANUAL_PRICE",
    targetContributionMarginPercent: null,
    commissionPercent: "0.0000",
    manualUnitPrice: null,
    industrialCostTotal: "1570.80",
    industrialCostPerUnit: CUSTO_12_CASAS,
    costPer1000: "3141.59",
    knownSubtotal: "1570.80",
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

function faixaComResultadoTecnico(): PricingTierDTO {
  return {
    id: "tier-1",
    notes: null,
    sortOrder: 0,
    ...custo(),
    priceMode: "MANUAL_PRICE",
    manualUnitPrice: "4.05318764",
    selectedUnitPrice: "4.05318764",
    commissionPercent: "5.0000",
    // O que a API serve depois do PREC-MIG-D: doze casas, não seis.
    commissionPerUnit: COMISSAO_12_CASAS,
    contributionPerUnit: CONTRIBUICAO_12_CASAS,
    contributionMarginPercent: "16.0500",
    markupPercent: "29.0179",
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
    tiers: [faixaComResultadoTecnico()],
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(previewPricingTier).mockResolvedValue(custo());
});

describe("resultado técnico da faixa na tela de Precificação", () => {
  it("a tabela mostra a máscara de leitura sem que o valor servido mude", async () => {
    await abrir();

    // `formatUnitCost` mostra R$ 0,65 — leitura de tabela. A máscara é
    // apresentação; o DTO continua carregando as doze casas.
    const tabela = document.querySelector("table")?.textContent ?? "";
    expect(tabela.replace(/\s/g, " ")).toContain("R$ 0,65");
    expect(tabela).not.toContain("0,650524111111");
  });

  it("adicionar faixa não envia resultado derivado — só os operandos", async () => {
    const user = userEvent.setup();
    await abrir(versao({ tiers: [] }));

    fireEvent.change(campo("Quantidade"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Modo de preço"), {
      target: { value: "MANUAL_PRICE" },
    });
    fireEvent.change(campo("Preço unitário"), { target: { value: "4,05318764" } });
    fireEvent.change(campo("Comissão (%)"), { target: { value: "5" } });
    vi.mocked(createPricingTier).mockResolvedValue(versao());
    await user.click(screen.getByRole("button", { name: "Adicionar faixa" }));
    await waitFor(() => expect(createPricingTier).toHaveBeenCalled());

    /*
     * Comissão e contribuição POR UNIDADE são resultado do motor do servidor.
     * A tela calcula a prévia para mostrar, e não devolve o número calculado:
     * se devolvesse, a precisão do que fica gravado passaria a depender do
     * navegador. O payload leva só os operandos que o operador digitou.
     */
    const payload = vi.mocked(createPricingTier).mock.calls[0]![1] as unknown as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload).sort()).toEqual([
      "commissionPercent",
      "manualUnitPrice",
      "priceMode",
      "quantity",
    ]);
    expect(JSON.stringify(payload)).not.toContain("0.202659");
    expect(JSON.stringify(payload)).not.toContain("0.650524");
  });

  it("ativar não reenvia resultado técnico — a faixa gravada não é reescrita", async () => {
    const user = userEvent.setup();
    await abrir();
    vi.mocked(activatePricingVersion).mockResolvedValue(versao({ status: "ACTIVE" }));

    await user.click(screen.getByRole("button", { name: "Ativar precificação" }));
    await waitFor(() => expect(activatePricingVersion).toHaveBeenCalled());

    const enviado = vi.mocked(activatePricingVersion).mock.calls[0]![1] as Record<string, unknown>;
    expect(JSON.stringify(enviado)).not.toContain("0.202659");
    expect(JSON.stringify(enviado)).not.toContain("0.650524");
    expect(Object.keys(enviado).sort()).toEqual([
      "confirmIncompleteCost",
      "confirmOutdatedStructure",
    ]);
  });

  it("a prévia da tela parte do custo de 12 casas, não de um custo cortado", async () => {
    await abrir(versao({ tiers: [] }));

    /*
     * O motor do navegador é o MESMO de `@veridi/shared`, e consome
     * `industrialCostPerUnit` do DTO da prévia. Antes do PREC-MIG-D esse campo
     * vinha com seis casas enquanto a coluna guardava doze, e a conta da tela
     * partia de um custo que o servidor não usava. O que se afirma aqui é a
     * entrada: a prévia recebeu doze casas e é sobre elas que a tela conta.
     */
    fireEvent.change(campo("Quantidade"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Modo de preço"), {
      target: { value: "MANUAL_PRICE" },
    });
    fireEvent.change(campo("Preço unitário"), { target: { value: "4,05318764" } });
    fireEvent.change(campo("Comissão (%)"), { target: { value: "5" } });

    await waitFor(() => expect(previewPricingTier).toHaveBeenCalled());
    const servido = await vi.mocked(previewPricingTier).mock.results[0]!.value;
    expect((servido as PricingTierPreviewDTO).industrialCostPerUnit).toBe(CUSTO_12_CASAS);
    expect(CUSTO_12_CASAS.split(".")[1]).toHaveLength(12);
  });
});
