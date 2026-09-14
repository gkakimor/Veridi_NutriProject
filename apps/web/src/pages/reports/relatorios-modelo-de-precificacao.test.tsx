import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PricingByProductRowDTO, PricingModelConfig, QuotePricingAuditRowDTO } from "@veridi/shared";
import { DEFAULT_PRICING_MODEL, INDUSTRIAL_COST_QUALITY_LABELS } from "@veridi/shared";

/**
 * R-19 e R-20 contam o Modelo de Precificação (PRICING-MODEL-VIEW-REPORTS-01).
 *
 * As duas telas mostravam "Custo/un" — o custo do cálculo — ao lado de margem e
 * markup que, fora do Modelo padrão, se formaram sobre o custo p/ preço. Agora
 * cada linha diz o Modelo, e os dois custos aparecem com o nome do PDF de
 * Precificação. A linha enviada do R-20 não congelou o Modelo: a tela diz isso
 * em vez de deduzir do vínculo com a faixa.
 */

vi.mock("../../lib/reports-api", () => ({
  getIndustrialCostByProductReport: vi.fn(),
  getPricingByProductReport: vi.fn(),
  getQuotePricingAuditReport: vi.fn(),
}));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "COMMERCIAL" } }),
  useOptionalAuth: () => ({ user: { id: "u-1", name: "Ana", role: "COMMERCIAL" } }),
}));

import { getPricingByProductReport, getQuotePricingAuditReport } from "../../lib/reports-api";
import { PricingByProductReportPage, QuotePricingAuditReportPage } from "./CostReports";

beforeEach(() => {
  vi.clearAllMocks();
});

const IGNORAR_CUSTO_INDUSTRIAL: PricingModelConfig = {
  ...DEFAULT_PRICING_MODEL,
  industrialCostMode: "IGNORE",
  // Valor de modo desligado continua guardado — e fora do texto.
  industrialCostAmountPerUnit: "0.4321",
};
const POR_UNIDADE: PricingModelConfig = {
  ...DEFAULT_PRICING_MODEL,
  industrialCostMode: "PER_UNIT",
  industrialCostAmountPerUnit: "0.85",
};

function faixa(id: string, extra: Partial<PricingByProductRowDTO>): PricingByProductRowDTO {
  return {
    pricingVersionId: id,
    pricingLabel: `PREC-${id} · V1`,
    productId: `prod-${id}`,
    productCode: `PROD-${id}`,
    productName: "Whey Protein 900 g",
    customerName: "Nutri Alfa Ltda",
    calculationCode: "CALC-000001",
    costReferenceDate: "2026-09-01T00:00:00.000Z",
    costQuality: "COMPLETE_REAL_REFERENCE",
    quantity: "1000",
    uomCode: "un",
    priceMode: "TARGET_MARGIN",
    costPerUnit: "12.500000000000",
    pricingCostPerUnit: "12.500000000000",
    pricingCostQuality: "COMPLETE_REAL_REFERENCE",
    pricingModel: { ...DEFAULT_PRICING_MODEL },
    commissionPercent: "5.0000",
    unitPrice: "20.00000000",
    contributionMarginPercent: "32.0000",
    markupPercent: "60.0000",
    contributionPerUnit: "6.500000000000",
    activatedAt: "2026-09-10T12:00:00.000Z",
    ...extra,
  };
}

function linhaDoOrcamento(id: string, extra: Partial<QuotePricingAuditRowDTO>): QuotePricingAuditRowDTO {
  return {
    quoteLineId: id,
    quoteVersionId: `qv-${id}`,
    quoteLabel: `ORC-${id} · V1`,
    projectId: "proj-1",
    projectCode: "PROJ-000012",
    projectName: "Projeto Whey",
    customerName: "Nutri Alfa Ltda",
    productCode: `PROD-${id}`,
    status: "DRAFT",
    quotedQuantity: "1000",
    uomCode: "un",
    unitPrice: "20.0000",
    total: "20000.00",
    priceSource: "PRICING_TIER",
    pricingLabel: "PREC-000001 · V1",
    tierQuantity: "1000",
    calculationCode: "CALC-000001",
    costQuality: "PARTIAL",
    industrialCostPerUnit: "12.500000000000",
    pricingCostPerUnit: "10.000000000000",
    pricingModel: IGNORAR_CUSTO_INDUSTRIAL,
    pricingModelNotFrozen: false,
    contributionMarginPercent: "32.0000",
    sentAt: null,
    acceptedAt: null,
    ...extra,
  };
}

/** Texto da célula da coluna `coluna` na linha `indice` do corpo da tabela. */
function celula(indice: number, coluna: string): string {
  const tabela = screen.getByRole("table");
  const cabecalhos = within(tabela)
    .getAllByRole("columnheader")
    .map((th) => th.textContent);
  const posicao = cabecalhos.indexOf(coluna);
  expect(posicao, `coluna ${coluna} em ${cabecalhos.join(" | ")}`).toBeGreaterThanOrEqual(0);
  const linha = within(tabela.querySelector("tbody")!).getAllByRole("row")[indice]!;
  return within(linha).getAllByRole("cell")[posicao]!.textContent ?? "";
}

describe("R-19 — o Modelo e os dois custos, por faixa", () => {
  it("padrão, IGNORE, PER_UNIT e faixa sem custo p/ preço congelado, cada um com a sua história", async () => {
    vi.mocked(getPricingByProductReport).mockResolvedValue({
      rows: [
        faixa("padrao", {}),
        faixa("ignore", {
          costQuality: "PARTIAL",
          costPerUnit: "12.500000000000",
          pricingCostPerUnit: "10.000000000000",
          pricingCostQuality: "COMPLETE_REAL_REFERENCE",
          pricingModel: IGNORAR_CUSTO_INDUSTRIAL,
        }),
        faixa("por-unidade", {
          costPerUnit: "12.500000000000",
          pricingCostPerUnit: "10.850000000000",
          pricingModel: POR_UNIDADE,
        }),
        faixa("sem-retrato", { pricingCostPerUnit: null, pricingCostQuality: null, pricingModel: POR_UNIDADE }),
      ],
      page: 1,
      pageSize: 25,
      total: 4,
    });
    render(
      <MemoryRouter>
        <PricingByProductReportPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(5));

    // Modelo padrão: uma palavra, e os dois custos são o mesmo.
    expect(celula(0, "Modelo de Precificação")).toBe("Padrão");
    expect(celula(0, "Custo do cálculo/un")).toMatch(/^R\$\s12,50$/);
    expect(celula(0, "Custo p/ preço/un")).toMatch(/^R\$\s12,50$/);

    // IGNORE: o custo industrial fora da conta, o valor guardado fora do texto,
    // e a margem ao lado do custo que a formou — com a qualidade dele.
    expect(celula(1, "Modelo de Precificação")).toBe(
      "Custo industrial no preço: Não considerado · Impostos estimados: Não considerados",
    );
    expect(celula(1, "Modelo de Precificação")).not.toContain("0,4321");
    expect(celula(1, "Qualidade do custo do cálculo")).toBe(INDUSTRIAL_COST_QUALITY_LABELS.PARTIAL);
    expect(celula(1, "Custo do cálculo/un")).toMatch(/^R\$\s12,50$/);
    expect(celula(1, "Custo p/ preço/un")).toMatch(
      new RegExp(`^R\\$\\s10,00 ${INDUSTRIAL_COST_QUALITY_LABELS.COMPLETE_REAL_REFERENCE}$`),
    );

    // PER_UNIT: a base dita, e custo diferente em cada coluna.
    expect(celula(2, "Modelo de Precificação")).toMatch(
      /^Custo industrial no preço: R\$\s0,85 por unidade · Impostos estimados: Não considerados$/,
    );
    expect(celula(2, "Custo do cálculo/un")).toMatch(/^R\$\s12,50$/);
    expect(celula(2, "Custo p/ preço/un")).toMatch(/^R\$\s10,85$/);

    // Fora do padrão sem o custo p/ preço congelado: "—", nunca o do cálculo no lugar.
    expect(celula(3, "Custo p/ preço/un")).toBe("—");
    expect(celula(3, "Custo do cálculo/un")).toMatch(/^R\$\s12,50$/);
  });
});

describe("R-20 — Modelo só onde ele existe congelado ou vivo", () => {
  it("rascunho vivo diz o Modelo; enviada diz que não congelou; manual sem faixa fica vazia", async () => {
    vi.mocked(getQuotePricingAuditReport).mockResolvedValue({
      rows: [
        linhaDoOrcamento("rascunho", {}),
        linhaDoOrcamento("enviada", {
          status: "SENT",
          sentAt: "2026-09-12T15:00:00.000Z",
          pricingCostPerUnit: null,
          pricingModel: null,
          pricingModelNotFrozen: true,
        }),
        linhaDoOrcamento("manual", {
          priceSource: "MANUAL",
          pricingLabel: null,
          tierQuantity: null,
          calculationCode: null,
          costQuality: null,
          industrialCostPerUnit: null,
          pricingCostPerUnit: null,
          pricingModel: null,
          contributionMarginPercent: null,
        }),
      ],
      page: 1,
      pageSize: 25,
      total: 3,
    });
    render(
      <MemoryRouter>
        <QuotePricingAuditReportPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));

    expect(celula(0, "Modelo de Precificação")).toBe(
      "Custo industrial no preço: Não considerado · Impostos estimados: Não considerados",
    );
    expect(celula(0, "Custo do cálculo/un")).toMatch(/^R\$\s12,50$/);
    expect(celula(0, "Custo p/ preço/un")).toMatch(/^R\$\s10,00$/);

    // O envio congelou custo do cálculo e margem — e só isso é afirmado.
    expect(celula(1, "Modelo de Precificação")).toBe("Não congelado no envio");
    expect(celula(1, "Custo p/ preço/un")).toBe("—");
    expect(celula(1, "Custo do cálculo/un")).toMatch(/^R\$\s12,50$/);
    expect(celula(1, "Margem contrib.")).toMatch(/32/);

    expect(celula(2, "Modelo de Precificação")).toBe("—");
    expect(celula(2, "Custo p/ preço/un")).toBe("—");
  });
});
