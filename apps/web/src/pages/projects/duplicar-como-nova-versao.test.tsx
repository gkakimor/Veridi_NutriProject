import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProjectDTO, QuoteLineDTO, QuoteVersionDTO } from "@veridi/shared";

/**
 * Duplicar como nova versão — QUOTE-DUPLICATE-01, §85.
 *
 * A ação parte da versão que está sendo LIDA, e a pergunta de preço não tem
 * resposta pronta: nenhuma opção vem marcada e "Criar nova versão" só libera
 * depois da escolha. As duas escolhas mandam estratégias distintas ao servidor.
 */

const duplicateQuoteVersion = vi.fn();

vi.mock("../../lib/products-api", () => ({ listProducts: () => Promise.resolve({ products: [] }) }));
vi.mock("../../lib/projects-api", () => ({
  createProjectProduct: vi.fn(),
  linkProjectProduct: vi.fn(),
  acceptQuoteVersion: vi.fn(),
  addQuoteLine: vi.fn(),
  adjustQuotePrice: vi.fn(),
  applyQuotePricing: vi.fn(),
  createOrderFromQuote: vi.fn(),
  createQuoteVersion: vi.fn(),
  duplicateQuoteVersion: (...args: unknown[]) => duplicateQuoteVersion(...args),
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

import { QuoteVersionsSection } from "./QuoteVersionsSection";

function linha(overrides: Partial<QuoteLineDTO> = {}): QuoteLineDTO {
  return {
    id: "ql-1",
    quoteVersionId: "q1",
    projectProductId: "pp-1",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Pré-Treino",
    sortOrder: 1,
    quotedQuantity: "1000",
    uomCode: "un",
    unitPrice: "12.5000",
    total: "12500.00",
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
    status: "SENT",
    source: "MANUAL",
    quoteDate: "2026-01-02T00:00:00.000Z",
    validUntil: "2026-09-15T00:00:00.000Z",
    expired: false,
    currencyCode: "BRL",
    lines: [linha()],
    total: "12500.00",
    subtotal: "12500.00",
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
    sentAt: "2026-01-03T00:00:00.000Z",
    sentByName: "Comercial",
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

const V1 = versao();
const V2 = versao({
  id: "q2",
  code: "ORC-000002",
  versionNumber: 2,
  versionLabel: "ORC-000002 · V2",
  lines: [linha({ id: "ql-2", quoteVersionId: "q2" })],
});

function abrir(versions: QuoteVersionDTO[], onChanged: () => void = () => {}) {
  const project = {
    id: "prj-1",
    code: "PROJ-000001",
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "Cliente Teste",
    name: "Linha Performance",
    status: "SAMPLE",
    products: [],
    quoteVersions: versions,
    statusHistory: [],
  } as unknown as ProjectDTO;
  render(
    <MemoryRouter>
      <QuoteVersionsSection project={project} canEdit projectStatus="SAMPLE" onChanged={onChanged} />
    </MemoryRouter>,
  );
}

/** Abre a V1 na lista — a versão mais recente é a que abre sozinha. */
function lerAV1() {
  fireEvent.click(screen.getByText("ORC-000001 · V1"));
}

function abrirDialogo() {
  lerAV1();
  fireEvent.click(screen.getByRole("button", { name: "Duplicar como nova versão" }));
  return screen.getByRole("alertdialog", { name: "Duplicar como nova versão" });
}

beforeEach(() => {
  vi.clearAllMocks();
  duplicateQuoteVersion.mockResolvedValue(
    versao({ id: "q3", code: "ORC-000003", versionNumber: 3, versionLabel: "ORC-000003 · V3", status: "DRAFT" }),
  );
});

describe("QUOTE-DUPLICATE-01 — Duplicar como nova versão", () => {
  it("abre com a versão de origem, nenhuma opção marcada e o botão bloqueado", () => {
    abrir([V1, V2]);
    const dialogo = abrirDialogo();

    expect(within(dialogo).getByText("Nova versão baseada na V1 · Enviado.")).toBeInTheDocument();
    const manter = within(dialogo).getByRole("radio", { name: /Manter os preços desta versão/ });
    const revisar = within(dialogo).getByRole("radio", { name: /Revisar os preços/ });
    expect(manter).not.toBeChecked();
    expect(revisar).not.toBeChecked();
    expect(within(dialogo).getByRole("button", { name: "Criar nova versão" })).toBeDisabled();
    // Proposta enviada é oferta, não acordo — a copy não chama de acordado.
    expect(within(dialogo).getByText(/preço oferecido, não acordo/)).toBeInTheDocument();

    fireEvent.click(manter);
    expect(within(dialogo).getByRole("button", { name: "Criar nova versão" })).toBeEnabled();
  });

  it("manter os preços manda KEEP_PRICES para a versão ESCOLHIDA", async () => {
    const onChanged = vi.fn();
    abrir([V1, V2], onChanged);
    const dialogo = abrirDialogo();

    fireEvent.click(within(dialogo).getByRole("radio", { name: /Manter os preços desta versão/ }));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Criar nova versão" }));

    await waitFor(() => expect(duplicateQuoteVersion).toHaveBeenCalledWith("q1", "KEEP_PRICES"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(duplicateQuoteVersion).toHaveBeenCalledTimes(1);
  });

  it("revisar os preços manda REVIEW_PRICES", async () => {
    abrir([V1, V2]);
    const dialogo = abrirDialogo();

    fireEvent.click(within(dialogo).getByRole("radio", { name: /Revisar os preços/ }));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Criar nova versão" }));

    await waitFor(() => expect(duplicateQuoteVersion).toHaveBeenCalledWith("q1", "REVIEW_PRICES"));
  });

  it("cada abertura começa sem escolha", () => {
    abrir([V1, V2]);
    let dialogo = abrirDialogo();
    fireEvent.click(within(dialogo).getByRole("radio", { name: /Revisar os preços/ }));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));

    fireEvent.click(screen.getByRole("button", { name: "Duplicar como nova versão" }));
    dialogo = screen.getByRole("alertdialog", { name: "Duplicar como nova versão" });
    expect(within(dialogo).getByRole("radio", { name: /Revisar os preços/ })).not.toBeChecked();
    expect(within(dialogo).getByRole("button", { name: "Criar nova versão" })).toBeDisabled();
  });

  it("com rascunho aberto a ação fica indisponível e diz por quê", () => {
    const rascunho = versao({
      id: "q3",
      code: "ORC-000003",
      versionNumber: 3,
      versionLabel: "ORC-000003 · V3",
      status: "DRAFT",
      sentAt: null,
    });
    abrir([V1, V2, rascunho]);
    lerAV1();

    expect(screen.getByRole("button", { name: "Duplicar como nova versão" })).toBeDisabled();
    expect(screen.getByText(/Já existe a V3 em rascunho/)).toBeInTheDocument();
  });
});
