import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProjectDTO, QuoteLineDTO, QuoteVersionDTO } from "@veridi/shared";

/**
 * Sair do campo sem mudar nada não grava — QUOTE-LINE-NOOP-BLUR-01.
 *
 * Quantidade, unidade e preço da linha gravam ao sair do campo. A tela
 * gravava SEMPRE, mesmo sem alteração, e o servidor tratava a presença da
 * quantidade ou da unidade no pedido como mudança: um Tab por cima do campo
 * apagava o preço herdado da condição acordada. O servidor passou a comparar
 * antes de agir; a tela, a não mandar o que não mudou.
 *
 * "Não mudou" é a mesma pergunta que decide a pendência do envio
 * (`digitadoIgualAoGravado`): por VALOR — `1000,0` é a quantidade gravada
 * `1000.000000000000` —, nunca por texto.
 */

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
  getQuotePricingOptions: vi.fn(() => Promise.resolve(null)),
  inheritQuotePrice: vi.fn(),
  previewQuotePaymentSchedule: vi.fn(),
  rejectQuoteVersion: vi.fn(),
  removeQuoteLine: vi.fn(),
  sendQuoteVersion: vi.fn(),
  updateQuoteLine: vi.fn(() => Promise.resolve()),
  updateQuoteVersion: vi.fn(),
  useManualQuotePrice: vi.fn(),
}));

import { updateQuoteLine } from "../../lib/projects-api";
import { QuoteVersionsSection } from "./QuoteVersionsSection";

const QUANTIDADE = "Quantidade de PROD-000001";
const UNIDADE = "Unidade de PROD-000001";
const PRECO = "Preço unitário de PROD-000001";

/** Linha da recompra: preço herdado da condição acordada, como a API devolve. */
function linha(overrides: Partial<QuoteLineDTO> = {}): QuoteLineDTO {
  return {
    id: "ql-1",
    quoteVersionId: "q2",
    projectProductId: "pp-1",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Pré-Treino",
    sortOrder: 1,
    quotedQuantity: "1000.000000000000",
    uomCode: "un",
    unitPrice: "12.5000",
    total: "12500.00",
    priceSource: "MANUAL",
    priceOrigin: "INHERITED_AGREEMENT",
    inheritedFromQuoteLineId: "ql-v1",
    adjustmentPercent: null,
    priceOriginReason: null,
    pricing: null,
    ...overrides,
  };
}

function versao(): QuoteVersionDTO {
  return {
    id: "q2",
    code: "ORC-000002",
    projectId: "prj-1",
    versionNumber: 2,
    versionLabel: "ORC-000002 · V2",
    externalCode: null,
    status: "DRAFT",
    source: "MANUAL",
    quoteDate: "2026-01-02T00:00:00.000Z",
    validUntil: "2099-12-31T00:00:00.000Z",
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

function abrirSecao() {
  render(
    <StrictMode>
      <MemoryRouter>
        <QuoteVersionsSection
          project={
            {
              id: "prj-1",
              code: "PROJ-000001",
              customerId: "cli-1",
              customerName: "Cliente Teste",
              name: "Linha Performance",
              status: "APPROVED",
              products: [],
              quoteVersions: [versao()],
              statusHistory: [],
            } as unknown as ProjectDTO
          }
          canEdit
          projectStatus="APPROVED"
          onChanged={() => {}}
        />
      </MemoryRouter>
    </StrictMode>,
  );
}

function campo(rotulo: string): HTMLInputElement {
  return screen.getByLabelText(rotulo) as HTMLInputElement;
}

/** Entra no campo, (opcionalmente) digita, e sai — o Tab de quem só passa por ele. */
function passarPeloCampo(rotulo: string, digitado?: string) {
  const alvo = campo(rotulo);
  fireEvent.focus(alvo);
  if (digitado !== undefined) fireEvent.change(alvo, { target: { value: digitado } });
  fireEvent.blur(alvo);
}

function botaoEnviar(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Enviar ao cliente" }) as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QUOTE-LINE-NOOP-BLUR-01 — sair do campo sem mudar nada não grava", () => {
  it.each([
    ["quantidade", QUANTIDADE],
    ["unidade", UNIDADE],
    ["preço", PRECO],
  ])("%s: passar pelo campo não manda nada ao servidor, e o envio segue livre", (_campo, rotulo) => {
    abrirSecao();

    passarPeloCampo(rotulo);

    expect(updateQuoteLine).not.toHaveBeenCalled();
    expect(botaoEnviar().disabled).toBe(false);
    expect(document.getElementById("quote-send-pending")).toBeNull();
  });

  it("o mesmo valor escrito de outro jeito não grava, e o campo volta a mostrar o gravado", () => {
    abrirSecao();

    passarPeloCampo(QUANTIDADE, "1000,0");
    passarPeloCampo(UNIDADE, " un ");
    passarPeloCampo(PRECO, "12,5");

    expect(updateQuoteLine).not.toHaveBeenCalled();
    expect(campo(QUANTIDADE).value).toBe("1000.000000000000");
    expect(campo(UNIDADE).value).toBe("un");
    expect(campo(PRECO).value).toBe("12.5000");
    expect(botaoEnviar().disabled).toBe(false);
  });
});

describe("QUOTE-LINE-NOOP-BLUR-01 — alteração real continua gravando", () => {
  it.each([
    ["quantidade", QUANTIDADE, "1200", { quotedQuantity: "1200" }],
    ["unidade", UNIDADE, "cx", { uomCode: "cx" }],
    ["preço", PRECO, "13,00", { unitPrice: "13.00" }],
    ["quantidade apagada", QUANTIDADE, "", { quotedQuantity: null }],
  ] as const)("%s: grava uma vez, com o valor novo", async (_campo, rotulo, digitado, payload) => {
    abrirSecao();

    passarPeloCampo(rotulo, digitado);

    await waitFor(() => expect(updateQuoteLine).toHaveBeenCalledTimes(1));
    expect(updateQuoteLine).toHaveBeenCalledWith("ql-1", payload);
  });

  it("texto ilegível não vira pedido: o erro aparece e o envio fica preso", async () => {
    abrirSecao();

    passarPeloCampo(QUANTIDADE, "1,2,3");

    await screen.findByRole("alert");
    expect(updateQuoteLine).not.toHaveBeenCalled();
    expect(botaoEnviar().disabled).toBe(true);
  });
});
