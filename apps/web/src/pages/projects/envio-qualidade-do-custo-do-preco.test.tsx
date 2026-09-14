import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  IndustrialCostQuality,
  ProjectDTO,
  QuoteLineDTO,
  QuotePricingProvenanceDTO,
  QuoteVersionDTO,
} from "@veridi/shared";

/**
 * O envio pergunta "custo incompleto" pela qualidade do custo que FORMOU o
 * preço — QUOTE-SEND-CONFIRM-QUALITY-01.
 *
 * A faixa ativa congela duas qualidades: a do cálculo (`costQuality`) e a da
 * base que o Modelo de Precificação usou para formar o preço
 * (`pricingCostQuality`). Com Modelo que ignora a conversão do ERP, cálculo
 * parcial e base de preço completa divergem — e a tela perguntava pela do
 * cálculo: confirmação falsa. Agora lê a que o servidor serve e pesa, sem
 * recalcular nada; faixa ativada antes do campo (nula ou ausente) usa a do
 * cálculo, como sempre.
 */

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", name: "Admin", role: "ADMIN" } }),
}));
vi.mock("../../components/AttachmentsSection", () => ({ AttachmentsSection: () => null }));
vi.mock("../../lib/projects-api", () => ({
  getProject: vi.fn(),
  approveProject: vi.fn(),
  cancelProject: vi.fn(),
  changeProjectStatus: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  prepareTechnicalProduct: vi.fn(),
  createProjectProduct: vi.fn(),
  linkProjectProduct: vi.fn(),
  acceptQuoteVersion: vi.fn(),
  addQuoteLine: vi.fn(),
  adjustQuotePrice: vi.fn(),
  applyQuotePricing: vi.fn(),
  createOrderFromQuote: vi.fn(),
  createQuoteVersion: vi.fn(),
  getQuotePricingOptions: vi.fn(() => Promise.resolve(null)),
  inheritQuotePrice: vi.fn(),
  previewQuotePaymentSchedule: vi.fn(),
  rejectQuoteVersion: vi.fn(),
  removeQuoteLine: vi.fn(),
  sendQuoteVersion: vi.fn(),
  updateQuoteLine: vi.fn(),
  updateQuoteVersion: vi.fn(),
  useManualQuotePrice: vi.fn(),
}));
vi.mock("../../lib/products-api", () => ({ listProducts: () => Promise.resolve({ products: [] }) }));
vi.mock("../../lib/customers-api", () => ({ listCustomers: () => Promise.resolve({ customers: [] }) }));
vi.mock("../../lib/samples-api", () => ({
  listSamples: vi.fn(() => Promise.resolve({ samples: [], total: 0 })),
  createSample: vi.fn(),
}));

import { sendQuoteVersion } from "../../lib/projects-api";
import { QuoteWorkspace } from "./QuoteWorkspace";

/** Proveniência viva da faixa, como a API serve no rascunho. */
function proveniencia(
  costQuality: IndustrialCostQuality,
  pricingCostQuality?: IndustrialCostQuality | null,
): QuotePricingProvenanceDTO {
  return {
    pricingVersionId: "prec-1",
    pricingCode: "PREC-000001",
    pricingVersionNumber: 1,
    pricingTierId: "t-1000",
    tierQuantity: "1000.000000000000",
    tierUomCode: "un",
    selectedUnitPrice: "10.00000000",
    calculationCode: "CALC-000001",
    costReferenceDate: "2026-09-01T00:00:00.000Z",
    costStructureLabel: "EC-000001 · V1",
    formulationVersionNumber: 1,
    industrialCostPerUnit: null,
    costQuality,
    // Ausente quando o argumento não vem: leitura de antes do campo.
    ...(pricingCostQuality !== undefined ? { pricingCostQuality } : {}),
    commissionPercent: "5.0000",
    contributionPerUnit: null,
    contributionMarginPercent: null,
    markupPercent: null,
    warnings: [],
    frozen: false,
  };
}

function linhaDaFaixa(pricing: QuotePricingProvenanceDTO): QuoteLineDTO {
  return {
    id: "ql-1",
    quoteVersionId: "q1",
    projectProductId: "pp-1",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Pré-Treino",
    sortOrder: 1,
    quotedQuantity: "1000.000000000000",
    uomCode: "un",
    unitPrice: "10.0000",
    total: "10000.00",
    priceSource: "PRICING_TIER",
    priceOrigin: null,
    inheritedFromQuoteLineId: null,
    adjustmentPercent: null,
    priceOriginReason: null,
    pricing,
  };
}

function versao(line: QuoteLineDTO): QuoteVersionDTO {
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
    validUntil: "2026-09-15T00:00:00.000Z",
    expired: false,
    currencyCode: "BRL",
    lines: [line],
    total: "10000.00",
    subtotal: "10000.00",
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
  } as QuoteVersionDTO;
}

const PROJETO: ProjectDTO = {
  id: "prj-1",
  code: "PROJ-000001",
  externalCode: null,
  customerId: "cli-1",
  customerCode: "CLI-000001",
  customerName: "Cliente Teste",
  customerPhone: null,
  customerEmail: null,
  name: "Linha Performance",
  concept: null,
  channel: null,
  status: "WAITING",
  source: "MANUAL",
  responsibleUserId: null,
  responsibleUserName: null,
  entryDate: "2026-01-01T00:00:00.000Z",
  notes: null,
  cancelReason: null,
  cancelReasonDetails: null,
  cancelledAt: null,
  approvedAt: null,
  dosageForm: null,
  presentationType: null,
  doseAmount: null,
  doseUomCode: null,
  dosesPerPackage: null,
  targetAgeGroup: null,
  minimumBatchQuantity: null,
  shelfLifeMonths: null,
  productId: null,
  productCode: null,
  costing: null,
  productName: null,
  latestQuoteLabel: null,
  latestQuoteStatus: null,
  acceptedQuoteLabel: null,
  products: [],
  quoteVersions: [],
  statusHistory: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  createdByName: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function abrirSecao(quote: QuoteVersionDTO) {
  render(
    <StrictMode>
      <MemoryRouter>
        <QuoteWorkspace
          project={{ ...PROJETO, quoteVersions: [quote] }}
          quote={quote}
          canEdit
          projectStatus="WAITING"
          onChanged={() => {}}
        />
      </MemoryRouter>
    </StrictMode>,
  );
}

async function tentarEnviar(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "Enviar ao cliente" }));
  return screen.findByRole("alertdialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendQuoteVersion).mockReset();
});

describe("QUOTE-SEND-CONFIRM-QUALITY-01 — o envio pergunta pelo custo que formou o preço", () => {
  it.each([
    ["cálculo parcial, base do preço completa (Modelo que ignora a conversão)", "PARTIAL", "COMPLETE_REAL_REFERENCE"],
    ["cálculo sem custo, base do preço com estimativas", "NO_COST", "COMPLETE_WITH_ESTIMATES"],
    ["faixa antiga (nula) com cálculo completo", "COMPLETE_REAL_REFERENCE", null],
  ] as const)("%s: envia sem pedir confirmação de custo", async (_caso, doCalculo, doPreco) => {
    abrirSecao(versao(linhaDaFaixa(proveniencia(doCalculo, doPreco))));

    const dialogo = await tentarEnviar();

    expect(within(dialogo).getByText("Enviar esta proposta ao cliente?")).toBeTruthy();
    expect(dialogo.textContent).not.toMatch(/custo industrial|custo incompleto/);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Enviar ao cliente" }));
    await waitFor(() => expect(sendQuoteVersion).toHaveBeenCalledTimes(1));
    expect(sendQuoteVersion).toHaveBeenCalledWith("q1", {});
  });

  it.each([
    ["base do preço parcial com cálculo completo", "COMPLETE_REAL_REFERENCE", "PARTIAL", "custo industrial parcial"],
    ["base do preço sem custo com cálculo completo", "COMPLETE_REAL_REFERENCE", "NO_COST", "sem custo industrial conhecido"],
    ["faixa antiga (nula): vale o cálculo parcial", "PARTIAL", null, "custo industrial parcial"],
    ["leitura sem o campo: vale o cálculo sem custo", "NO_COST", undefined, "sem custo industrial conhecido"],
  ] as const)("%s: pede confirmação e envia confirmando", async (_caso, doCalculo, doPreco, rotulo) => {
    abrirSecao(versao(linhaDaFaixa(proveniencia(doCalculo, doPreco))));

    const dialogo = await tentarEnviar();

    expect(within(dialogo).getByText("Enviar com custo incompleto?")).toBeTruthy();
    // A linha listada diz o que falta pela mesma qualidade que decidiu perguntar.
    expect(dialogo.textContent).toContain(`PROD-000001 Pré-Treino — ${rotulo}`);
    fireEvent.click(within(dialogo).getByRole("button", { name: "Enviar mesmo assim" }));
    await waitFor(() => expect(sendQuoteVersion).toHaveBeenCalledTimes(1));
    expect(sendQuoteVersion).toHaveBeenCalledWith("q1", { confirmIncompleteCost: true });
  });
});
