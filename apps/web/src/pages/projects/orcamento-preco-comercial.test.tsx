import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProjectDTO, QuoteLineDTO, QuoteVersionDTO } from "@veridi/shared";

/**
 * Preço COMERCIAL da linha do Orçamento — PREC-P-TECH, §57, §58 e §60.
 *
 * `QuoteLine.unitPrice` é `DECIMAL(14,4)` e continua sendo: é o preço do
 * documento. O que mudou nesta capability é dos dois lados da fronteira — a
 * precificação técnica guarda oito casas, e a entrada comercial passou a
 * RECUSAR acima de quatro em vez de deixar o PostgreSQL cortar.
 *
 * O que esta tela precisa provar:
 *
 * - abrir, não editar e sair não manda nada, e as quatro casas ficam intactas.
 *   A máscara de leitura (`formatUnitPriceBRL`, 2 a 4 casas) nunca vira o
 *   valor enviado — sem mudança nem há pedido (QUOTE-LINE-NOOP-BLUR-01);
 * - o que a pessoa digita chega ao servidor sem arredondamento local — quem
 *   recusa é a API, com mensagem, não a tela em silêncio;
 * - a linha vinda de uma FAIXA não é editável, e a proveniência técnica de
 *   oito casas convive ao lado do preço comercial de quatro sem se confundir.
 */

vi.mock("../../lib/products-api", () => ({ listProducts: () => Promise.resolve({ products: [] }) }));
vi.mock("../../lib/projects-api", () => ({
  createProjectProduct: vi.fn(),
  linkProjectProduct: vi.fn(),
  acceptQuoteVersion: vi.fn(),
  addQuoteLine: vi.fn(),
  applyQuotePricing: vi.fn(),
  createOrderFromQuote: vi.fn(),
  createQuoteVersion: vi.fn(),
  getQuotePricingOptions: vi.fn(() => Promise.resolve(null)),
  previewQuotePaymentSchedule: vi.fn(),
  rejectQuoteVersion: vi.fn(),
  removeQuoteLine: vi.fn(),
  sendQuoteVersion: vi.fn(),
  updateQuoteLine: vi.fn(),
  updateQuoteVersion: vi.fn(),
  useManualQuotePrice: vi.fn(),
}));

import { updateQuoteLine } from "../../lib/projects-api";
import { QuoteVersionsSection } from "./QuoteVersionsSection";

/** O preço comercial: quatro casas, o scale do documento. */
const PRECO_COMERCIAL = "4.0531";
/** O preço técnico da faixa que originou a linha: oito casas. */
const PRECO_TECNICO = "4.05318764";

function linha(overrides: Partial<QuoteLineDTO> = {}): QuoteLineDTO {
  return {
    id: "ql-1",
    quoteVersionId: "q1",
    projectProductId: null,
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Pré-Treino",
    sortOrder: 1,
    quotedQuantity: "500",
    uomCode: "un",
    unitPrice: PRECO_COMERCIAL,
    total: "2026.55",
    priceSource: "MANUAL",
    priceOrigin: null,
    inheritedFromQuoteLineId: null,
    adjustmentPercent: null,
    priceOriginReason: null,
    pricing: null,
    ...overrides,
  };
}

function versao(overrides: Partial<QuoteVersionDTO> = {}): QuoteVersionDTO {
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
    lines: [linha()],
    total: "2026.55",
    subtotal: "2026.55",
    discountPercent: null,
    paymentMethod: "CASH",
    downPaymentPercent: null,
    installmentCount: null,
    installmentIntervalDays: null,
    monthlyInterestPercent: null,
    paymentSchedule: null,
    sourcedOrder: null,
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
    customerCode: null,
    customerName: null,
    customerTradeName: null,
    customerCnpj: null,
    customerZipCode: null,
    customerStreet: null,
    customerNumber: null,
    customerComplement: null,
    customerDistrict: null,
    customerCity: null,
    customerState: null,
    projectCode: null,
    projectName: null,
    projectConcept: null,
    projectChannel: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    createdByName: null,
    ...overrides,
  } as QuoteVersionDTO;
}

function projeto(versions: QuoteVersionDTO[]): ProjectDTO {
  return {
    id: "prj-1",
    code: "PROJ-000001",
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "NutriViva",
    name: "Linha Performance",
    status: "SAMPLE",
    products: [],
    quoteVersions: versions,
    statusHistory: [],
  } as unknown as ProjectDTO;
}

function abrir(versions: QuoteVersionDTO[]) {
  render(
    <MemoryRouter>
      <QuoteVersionsSection
        project={projeto(versions)}
        canEdit
        projectStatus="SAMPLE"
        onChanged={() => {}}
      />
    </MemoryRouter>,
  );
}

const precoDe = (codigo: string) =>
  screen.getByLabelText(`Preço unitário de ${codigo}`) as HTMLInputElement;

const enviado = () =>
  vi.mocked(updateQuoteLine).mock.calls[0]![1] as { unitPrice?: string | null };

beforeEach(() => {
  vi.mocked(updateQuoteLine).mockReset();
  vi.mocked(updateQuoteLine).mockResolvedValue(undefined as never);
});

describe("preço comercial da linha do Orçamento na tela", () => {
  it("o campo abre com as 4 casas do documento, não com a máscara de moeda", () => {
    abrir([versao()]);
    expect(precoDe("PROD-000001").value).toBe(PRECO_COMERCIAL);
    expect(precoDe("PROD-000001").value).not.toBe("R$ 4,0531");
  });

  it("abrir, não editar e sair não manda nada — 4,0531 fica, casa por casa", () => {
    abrir([versao()]);
    const campo = precoDe("PROD-000001");

    fireEvent.blur(campo, { target: { value: campo.value } });

    // Sem mudança não sai pedido: a máscara de leitura não tem como virar o
    // valor gravado, e o campo continua com as quatro casas.
    expect(updateQuoteLine).not.toHaveBeenCalled();
    expect(precoDe("PROD-000001").value).toBe(PRECO_COMERCIAL);
  });

  it("digitar em pt-BR chega ao servidor normalizado, sem arredondar na tela", async () => {
    abrir([versao()]);
    const campo = precoDe("PROD-000001");

    fireEvent.change(campo, { target: { value: "4,0532" } });
    fireEvent.blur(campo, { target: { value: "4,0532" } });

    await waitFor(() => expect(updateQuoteLine).toHaveBeenCalled());
    expect(enviado().unitPrice).toBe("4.0532");
  });

  it("acima de 4 casas a tela NÃO corrige em silêncio — o valor sobe e a API recusa", async () => {
    abrir([versao()]);
    const campo = precoDe("PROD-000001");

    fireEvent.change(campo, { target: { value: "4,05318" } });
    fireEvent.blur(campo, { target: { value: "4,05318" } });

    await waitFor(() => expect(updateQuoteLine).toHaveBeenCalled());
    /*
     * Cortar aqui esconderia a decisão: a pessoa veria `4,0532` gravado sem
     * ter escrito isso. Quem recusa é a fronteira da API, com mensagem —
     * `PRODUCT_RULES.md` §58.
     */
    expect(enviado().unitPrice).toBe("4.05318");
  });

  it("linha vinda de faixa: preço técnico e comercial convivem sem se confundir", () => {
    abrir([
      versao({
        lines: [
          linha({
            priceSource: "PRICING_TIER",
            pricing: {
              pricingVersionId: "prec-1",
              pricingCode: "PREC-000001",
              pricingVersionNumber: 1,
              pricingTierId: "tier-1",
              tierQuantity: "500",
              tierUomCode: "un",
              selectedUnitPrice: PRECO_TECNICO,
              calculationCode: "CALC-000001",
              costReferenceDate: "2026-09-01T00:00:00.000Z",
              costStructureLabel: "EC-000001 · V1",
              formulationVersionNumber: 1,
              industrialCostPerUnit: "3.200000000000",
              costQuality: "COMPLETE_REAL_REFERENCE",
              commissionPercent: "5.0000",
              contributionPerUnit: "0.650524",
              contributionMarginPercent: "16.0500",
              markupPercent: "26.6621",
              warnings: [],
              frozen: true,
            },
          }),
        ],
      }),
    ]);

    // Preço vindo da faixa não é editável na linha: mudar à mão aqui seria
    // proveniência falsa. Sem campo, não há caminho de volta.
    expect(screen.queryByLabelText("Preço unitário de PROD-000001")).toBeNull();
    // E o que a linha mostra é o preço COMERCIAL do documento, em quatro
    // casas — o técnico de oito vive na proveniência, não na coluna de preço.
    const celulas = document.querySelectorAll("tbody tr td");
    const textos = Array.from(celulas).map((c) => (c.textContent ?? "").replace(/\s/g, " "));
    expect(textos.some((t) => t.includes("R$ 4,0531"))).toBe(true);
    expect(textos.some((t) => t.includes("4,05318764"))).toBe(false);
  });
});
