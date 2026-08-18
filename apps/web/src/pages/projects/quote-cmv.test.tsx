import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  PricingVersionDTO,
  ProjectDTO,
  ProjectProductDTO,
  QuoteLineDTO,
  QuoteVersionDTO,
} from "@veridi/shared";
import { QuoteVersionsSection } from "./QuoteVersionsSection";
import { ProjectProductsSection } from "./ProjectProductsSection";
import { QuotePrintDocument } from "../../print/documents";

/**
 * Orçamento ↔ CMV.
 *
 * O caminho comercial completo é: escolher o produto, dizer a quantidade,
 * ver se existe preço vigente, decidir aplicá-lo, e — quando quiser conferir
 * a conta — simular o CMV e voltar de onde saiu.
 *
 * Duas regras que estes testes existem para travar: o preço NUNCA muda
 * sozinho porque uma faixa existe, e o documento que o cliente recebe nunca
 * carrega custo, margem, comissão ou código de documento interno.
 */

vi.mock("../../lib/products-api", () => ({ listProducts: () => Promise.resolve({ products: [] }) }));
vi.mock("../../lib/projects-api", () => ({
  createProjectProduct: vi.fn(),
  linkProjectProduct: vi.fn(),
  acceptQuoteVersion: vi.fn(),
  addQuoteLine: vi.fn(),
  applyQuotePricing: vi.fn(),
  createQuoteVersion: vi.fn(),
  getQuotePricingOptions: vi.fn(),
  rejectQuoteVersion: vi.fn(),
  removeQuoteLine: vi.fn(),
  sendQuoteVersion: vi.fn(),
  updateQuoteLine: vi.fn(),
  updateQuoteVersion: vi.fn(),
  useManualQuotePrice: vi.fn(),
}));

import { applyQuotePricing, getQuotePricingOptions } from "../../lib/projects-api";

function tier(id: string, quantity: string, price: string | null) {
  return {
    id,
    quantity,
    uomCode: "un",
    priceMode: "TARGET_MARGIN",
    targetContributionMarginPercent: "35",
    commissionPercent: "5",
    manualUnitPrice: null,
    notes: null,
    sortOrder: 1,
    industrialCostTotal: "12043.6000",
    industrialCostPerUnit: "12.0436",
    costPer1000: "12043.6000",
    knownSubtotal: "12043.6000",
    costQuality: "COMPLETE_REAL_REFERENCE",
    batchCount: "1",
    suggestedUnitPrice: price,
    selectedUnitPrice: price,
    commissionPerUnit: price ? "1.9450" : null,
    commissionTotal: null,
    grossRevenue: null,
    contributionPerUnit: "24.9114",
    contributionTotal: null,
    contributionMarginPercent: "64.04",
    markupPercent: "222.90",
    warnings: [],
  } as unknown as PricingVersionDTO["tiers"][number];
}

function pricing(tiers: PricingVersionDTO["tiers"]): PricingVersionDTO {
  return {
    id: "prec-1",
    code: "PREC-000001",
    label: "PREC-000001 · V1",
    versionNumber: 1,
    status: "ACTIVE",
    productId: "prod-a",
    productCode: "PROD-000003",
    productName: "Whey Protein DEMO",
    tiers,
  } as unknown as PricingVersionDTO;
}

function line(overrides: Partial<QuoteLineDTO> = {}): QuoteLineDTO {
  return {
    id: "l-1",
    quoteVersionId: "q1",
    projectProductId: null,
    productId: "prod-a",
    productCode: "PROD-000003",
    productName: "Whey Protein DEMO",
    sortOrder: 1,
    quotedQuantity: "1000",
    uomCode: "un",
    unitPrice: null,
    total: null,
    priceSource: "MANUAL",
    pricing: null,
    ...overrides,
  };
}

function quote(overrides: Partial<QuoteVersionDTO> = {}): QuoteVersionDTO {
  return {
    id: "q1",
    code: "ORC-000001",
    projectId: "prj-1",
    versionNumber: 1,
    versionLabel: "ORC-000001 · V1",
    externalCode: null,
    status: "DRAFT",
    source: "MANUAL",
    quoteDate: "2026-01-02T00:00:00.000Z",
    validUntil: null,
    currencyCode: "BRL",
    lines: [line()],
    total: null,
    commercialNotes: null,
    paymentTerms: null,
    leadTimeDays: null,
    sentAt: null,
    sentByName: null,
    acceptedAt: null,
    acceptedByName: null,
    rejectedAt: null,
    rejectedByName: null,
    rejectionReason: null,
    customerCode: "CLI-000001",
    customerName: "NutriViva",
    customerTradeName: null,
    customerCnpj: null,
    customerZipCode: null,
    customerStreet: null,
    customerNumber: null,
    customerComplement: null,
    customerDistrict: null,
    customerCity: null,
    customerState: null,
    projectCode: "PROJ-000001",
    projectName: "Linha Performance",
    projectConcept: null,
    projectChannel: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    createdByName: null,
    ...overrides,
  } as QuoteVersionDTO;
}

function project(quotes: QuoteVersionDTO[]): ProjectDTO {
  return {
    id: "prj-1",
    code: "PROJ-000001",
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "NutriViva",
    name: "Linha Performance",
    status: "QUOTE",
    products: [],
    quoteVersions: quotes,
    statusHistory: [],
  } as unknown as ProjectDTO;
}

function renderQuotes(quotes: QuoteVersionDTO[], url = "/comercial/projetos/prj-1") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <QuoteVersionsSection project={project(quotes)} canEdit onChanged={() => {}} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Sugestão de faixa na linha do orçamento", () => {
  it("mostra a faixa vigente quando existe para exatamente aquela quantidade", async () => {
    vi.mocked(getQuotePricingOptions).mockResolvedValue(
      pricing([tier("t-500", "500", "44.9000"), tier("t-1000", "1000", "38.9000")]),
    );
    renderQuotes([quote()]);

    await screen.findByText(/Existe uma precificação vigente para 1000 un/);
    expect(screen.getByText("R$ 38,90")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Aplicar preço calculado" }),
    ).toBeInTheDocument();
  });

  it("existir faixa não muda o preço sozinho — só o clique aplica", async () => {
    vi.mocked(getQuotePricingOptions).mockResolvedValue(pricing([tier("t-1000", "1000", "38.9000")]));
    renderQuotes([quote()]);

    await screen.findByRole("button", { name: "Aplicar preço calculado" });
    // A linha continua sem preço até alguém decidir.
    expect(applyQuotePricing).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Aplicar preço calculado" }));
    await waitFor(() => expect(applyQuotePricing).toHaveBeenCalledWith("l-1", "t-1000"));
  });

  it("aplicada, a linha passa a ter origem de faixa de precificação", async () => {
    vi.mocked(getQuotePricingOptions).mockResolvedValue(pricing([tier("t-1000", "1000", "38.9000")]));
    renderQuotes([
      quote({
        lines: [
          line({
            unitPrice: "38.9000",
            total: "38900.0000",
            priceSource: "PRICING_TIER",
            pricing: {
              pricingVersionId: "prec-1",
              pricingCode: "PREC-000001",
              pricingVersionNumber: 1,
              pricingTierId: "t-1000",
              tierQuantity: "1000",
              tierUomCode: "un",
            } as QuoteLineDTO["pricing"],
          }),
        ],
      }),
    ]);

    expect(await screen.findByText("Faixa de precificação")).toBeInTheDocument();
    expect(screen.getByText("PREC-000001")).toBeInTheDocument();
  });

  it("sem faixa para a quantidade, diz isso e oferece simular o CMV", async () => {
    vi.mocked(getQuotePricingOptions).mockResolvedValue(
      pricing([tier("t-500", "500", "44.9000"), tier("t-1000", "1000", "38.9000")]),
    );
    renderQuotes([quote({ lines: [line({ quotedQuantity: "750" })] })]);

    await screen.findByText("Não existe precificação vigente para esta quantidade.");
    // Nem 500, nem 1000, nem média: faixa não se interpola.
    expect(screen.queryByText("R$ 44,90")).not.toBeInTheDocument();
    expect(screen.queryByText("R$ 38,90")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aplicar preço calculado" })).toBeNull();
    expect(screen.getByRole("link", { name: "Simular CMV" })).toBeInTheDocument();
  });

  it('"Simular CMV" leva o produto, a quantidade e o contexto do orçamento', async () => {
    vi.mocked(getQuotePricingOptions).mockResolvedValue(pricing([tier("t-1000", "1000", "38.9000")]));
    renderQuotes([quote()]);

    const link = await screen.findByRole("link", { name: "Simular CMV" });
    expect(link).toHaveAttribute(
      "href",
      "/produtos/prod-a/cmv?quantity=1000&projectId=prj-1&quoteVersionId=q1&quoteLineId=l-1",
    );
  });

  it("voltar do CMV reabre a mesma versão, não o rascunho corrente", async () => {
    vi.mocked(getQuotePricingOptions).mockResolvedValue(pricing([]));
    const v1 = quote({ id: "q1", versionLabel: "ORC-000001 · V1", status: "SENT", lines: [] });
    const v2 = quote({ id: "q2", versionLabel: "ORC-000001 · V2", status: "DRAFT" });
    renderQuotes([v1, v2], "/comercial/projetos/prj-1?quoteVersionId=q1&quoteLineId=l-1");

    // Sem o contexto, a seção abriria o rascunho (V2) e a pessoa se perderia.
    await waitFor(() =>
      expect(screen.getByText(/Proposta apresentada é histórico/)).toBeInTheDocument(),
    );
  });

  it("versão enviada não oferece aplicar preço — histórico não se renegocia", async () => {
    vi.mocked(getQuotePricingOptions).mockResolvedValue(pricing([tier("t-1000", "1000", "38.9000")]));
    renderQuotes([quote({ status: "SENT" })]);

    await screen.findByText(/Proposta apresentada é histórico/);
    expect(screen.queryByRole("button", { name: "Aplicar preço calculado" })).toBeNull();
    expect(getQuotePricingOptions).not.toHaveBeenCalled();
  });
});

describe("Acesso ao CMV a partir do projeto", () => {
  it("cada produto do projeto tem um caminho direto para o CMV", () => {
    const produto: ProjectProductDTO = {
      id: "pp-a",
      projectId: "prj-1",
      productId: "prod-a",
      productCode: "PROD-000003",
      productName: "Whey Protein DEMO",
      productLifecycle: "DEVELOPMENT",
      productActive: true,
      sequence: 1,
      status: "ACTIVE",
      costing: null,
      latestSampleCode: null,
      latestSampleLabel: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdByName: null,
    } as unknown as ProjectProductDTO;

    render(
      <MemoryRouter>
        <ProjectProductsSection
          projectId="prj-1"
          customerId="cli-1"
          products={[produto]}
          editable
          onChanged={() => {}}
        />
      </MemoryRouter>,
    );

    const cmv = screen.getByRole("link", { name: "CMV" });
    // Contexto do projeto viaja junto: o CMV sabe para onde voltar.
    expect(cmv).toHaveAttribute("href", "/produtos/prod-a/cmv?projectId=prj-1");
    // Formulação continua visível; o resto está no menu, sem sumir.
    expect(screen.getByRole("link", { name: "Formulação" })).toBeInTheDocument();
  });
});

describe("Documento do cliente", () => {
  it("não carrega CMV, custo, margem, comissão nem documento interno", () => {
    const { container } = render(
      <MemoryRouter>
        <QuotePrintDocument
          quote={quote({
            status: "SENT",
            total: "38900.0000",
            lines: [
              line({
                unitPrice: "38.9000",
                total: "38900.0000",
                priceSource: "PRICING_TIER",
                pricing: {
                  pricingVersionId: "prec-1",
                  pricingCode: "PREC-000001",
                  pricingVersionNumber: 1,
                  pricingTierId: "t-1000",
                  tierQuantity: "1000",
                  tierUomCode: "un",
                  industrialCostPerUnit: "12.0436",
                  costQuality: "COMPLETE_REAL_REFERENCE",
                  contributionMarginPercent: "64.04",
                  commissionPercent: "5",
                  markupPercent: "222.90",
                  warnings: [],
                } as unknown as QuoteLineDTO["pricing"],
              }),
            ],
          })}
        />
      </MemoryRouter>,
    );

    const texto = container.textContent ?? "";
    for (const proibido of [
      "CMV",
      "custo",
      "Custo",
      "costQuality",
      "COMPLETE_REAL_REFERENCE",
      "margem",
      "Margem",
      "markup",
      "Markup",
      "comissão",
      "Comissão",
      "contribuição",
      "Contribuição",
      "PREC-",
      "CALC-",
      "EC-",
      "12,04",
      "64,04",
      "222,90",
    ]) {
      expect(texto).not.toContain(proibido);
    }
    // E o que o cliente PRECISA ver continua lá.
    expect(within(container).getByText("Whey Protein DEMO")).toBeInTheDocument();
    // (o separador entre "R$" e o número é espaço não-quebrável na formatação pt-BR)
    expect(texto).toContain("38,90");
  });
});
