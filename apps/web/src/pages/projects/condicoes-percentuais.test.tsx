import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ProjectDTO, QuoteLineDTO, QuoteVersionDTO } from "@veridi/shared";

/**
 * Percentuais e preço da proposta com os campos pt-BR — PTBR-NUMERIC-INPUT-
 * ROLLOUT-01, e o fechamento de QUOTE-PERCENT-FIELDS-01.
 *
 * O que se fixa:
 *
 * 1. percentual é PONTO percentual: `12,5` na tela vai `12.5` à API — nunca a
 *    fração `0.125`; o gravado `7.5000` volta `7,5` e não é pendência;
 * 2. o percentual que não vira número (o `1.234` ambíguo — letra nem entra) tem
 *    o mesmo tratamento dos inteiros: erro com `id`, ligado ao campo por
 *    `aria-describedby`, e salvar e simular presos;
 * 3. à vista, entrada e juros não aparecem nem valem: o ilegível que ficou
 *    escondido NÃO trava "Salvar condições", e não vai à API;
 * 4. o preço unitário comercial é dinheiro de quatro casas: colar
 *    `R$ 1.234,5678` grava `1234.5678`, e a quinta casa não entra.
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
  updateQuoteVersion: vi.fn(() => Promise.resolve()),
  useManualQuotePrice: vi.fn(),
}));

import {
  previewQuotePaymentSchedule,
  updateQuoteLine,
  updateQuoteVersion,
} from "../../lib/projects-api";
import { QuoteVersionsSection } from "./QuoteVersionsSection";

function linha(): QuoteLineDTO {
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
    unitPrice: "12.5000",
    total: "12500.00",
    priceSource: "MANUAL",
    priceOrigin: "MANUAL",
    inheritedFromQuoteLineId: null,
    adjustmentPercent: null,
    priceOriginReason: null,
    pricing: null,
  };
}

/** Rascunho parcelado. */
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
    validUntil: "2099-12-31T00:00:00.000Z",
    expired: false,
    currencyCode: "BRL",
    lines: [linha()],
    total: "12500.00",
    subtotal: "12500.00",
    discountPercent: "7.5000",
    paymentMethod: "INSTALLMENTS",
    downPaymentPercent: null,
    installmentCount: 3,
    installmentIntervalDays: 30,
    monthlyInterestPercent: null,
    paymentSchedule: null,
    sourcedOrder: null,
    commercialNotes: null,
    paymentTerms: null,
    leadTimeDays: 30,
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

function abrirSecao(quote: QuoteVersionDTO = versao()) {
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
              status: "WAITING",
              products: [],
              quoteVersions: [quote],
              statusHistory: [],
            } as unknown as ProjectDTO
          }
          canEdit
          projectStatus="WAITING"
          onChanged={() => {}}
        />
      </MemoryRouter>
    </StrictMode>,
  );
}

function campo(rotulo: string): HTMLInputElement {
  return screen.getByLabelText(rotulo) as HTMLInputElement;
}

function digitar(rotulo: string, valor: string) {
  fireEvent.change(campo(rotulo), { target: { value: valor } });
}

function botao(nome: string): HTMLButtonElement {
  return screen.getByRole("button", { name: nome }) as HTMLButtonElement;
}

function situacao(): string {
  const aviso = screen
    .getAllByRole("status")
    .find((elemento) => /^(Alterações não salvas|Tudo salvo)$/.test(elemento.textContent ?? ""));
  return aviso?.textContent ?? "(sem aviso de situação)";
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("percentual em pontos — o número que a pessoa vê", () => {
  it("gravado 7.5000 aparece 7,5, e não é pendência", () => {
    abrirSecao();

    expect(campo("Desconto (%)").value).toBe("7,5");
    expect(situacao()).toBe("Tudo salvo");
  });

  it("12,5 na tela vai 12.5 à API — nunca 0.125", async () => {
    abrirSecao();

    digitar("Desconto (%)", "12,5");
    digitar("Juros ao mês (%)", "1,25");
    fireEvent.click(botao("Salvar condições"));

    await waitFor(() => expect(updateQuoteVersion).toHaveBeenCalledTimes(1));
    expect(updateQuoteVersion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ discountPercent: "12.5", monthlyInterestPercent: "1.25" }),
    );
  });

  it("letra e segunda vírgula não entram; colar 12,5% dá 12,5; a quinta casa não entra", async () => {
    const user = userEvent.setup();
    abrirSecao();

    digitar("Desconto (%)", "12a");
    expect(campo("Desconto (%)").value).toBe("7,5");
    digitar("Desconto (%)", "1,2,5");
    expect(campo("Desconto (%)").value).toBe("7,5");
    digitar("Desconto (%)", "1,23456");
    expect(campo("Desconto (%)").value).toBe("7,5");

    digitar("Desconto (%)", "");
    await user.click(campo("Desconto (%)"));
    await user.paste("12,5%");
    expect(campo("Desconto (%)").value).toBe("12,5");
  });

  it("zero continua zero", async () => {
    abrirSecao();

    digitar("Desconto (%)", "0");
    fireEvent.click(botao("Salvar condições"));
    await waitFor(() => expect(updateQuoteVersion).toHaveBeenCalledTimes(1));
    expect(updateQuoteVersion).toHaveBeenLastCalledWith("q1", expect.objectContaining({ discountPercent: "0" }));
  });

  it("apagar o desconto vai null", async () => {
    abrirSecao();

    digitar("Desconto (%)", "");
    fireEvent.click(botao("Salvar condições"));
    await waitFor(() => expect(updateQuoteVersion).toHaveBeenCalledTimes(1));
    expect(updateQuoteVersion).toHaveBeenLastCalledWith("q1", expect.objectContaining({ discountPercent: null }));
  });
});

describe("QUOTE-PERCENT-FIELDS-01 — percentual ilegível com o tratamento dos inteiros", () => {
  it.each([
    ["Desconto (%)", "quote-discount-error"],
    ["Entrada (%)", "quote-down-payment-error"],
    ["Juros ao mês (%)", "quote-interest-error"],
  ])("%s ambíguo: erro com id, ligado ao campo, salvar e simular presos", (rotulo, erroId) => {
    abrirSecao();

    digitar(rotulo, "1.234");

    const erro = document.getElementById(erroId);
    expect(erro?.textContent).toMatch(/ponto seguido de três dígitos pode ser milhar ou decimal/);
    expect(campo(rotulo)).toHaveAttribute("aria-invalid", "true");
    expect(campo(rotulo)).toHaveAttribute("aria-describedby", erroId);
    expect(botao("Salvar condições").disabled).toBe(true);
    expect(botao("Simular").disabled).toBe(true);
    fireEvent.click(botao("Salvar condições"));
    fireEvent.click(botao("Simular"));
    expect(updateQuoteVersion).not.toHaveBeenCalled();
    expect(previewQuotePaymentSchedule).not.toHaveBeenCalled();
  });

  it("à vista, entrada e juros ilegíveis escondidos não travam salvar — e não vão à API", async () => {
    abrirSecao();

    digitar("Entrada (%)", "1.234");
    digitar("Juros ao mês (%)", "2.500");
    expect(botao("Salvar condições").disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Forma de pagamento"), { target: { value: "CASH" } });

    expect(screen.queryByLabelText("Entrada (%)")).toBeNull();
    expect(botao("Salvar condições").disabled).toBe(false);
    fireEvent.click(botao("Salvar condições"));

    await waitFor(() => expect(updateQuoteVersion).toHaveBeenCalledTimes(1));
    expect(updateQuoteVersion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({
        paymentMethod: "CASH",
        downPaymentPercent: null,
        monthlyInterestPercent: null,
      }),
    );
  });
});

describe("preço unitário comercial — dinheiro de quatro casas", () => {
  it("colar R$ 1.234,5678 grava 1234.5678 ao sair do campo", async () => {
    const user = userEvent.setup();
    abrirSecao();
    const preco = campo("Preço unitário de PROD-000001");

    expect(preco.value).toBe("12,50");
    await user.click(preco);
    await user.keyboard("{Control>}a{/Control}");
    await user.paste("R$ 1.234,5678");
    expect(preco.value).toBe("1234,5678");
    await user.tab();

    await waitFor(() => expect(updateQuoteLine).toHaveBeenCalledTimes(1));
    expect(updateQuoteLine).toHaveBeenCalledWith("ql-1", { unitPrice: "1234.5678" });
    // Fora do foco, o preço aparece formatado — sem o símbolo, que está no rótulo da coluna.
    expect(preco.value).toBe("1.234,5678");
  });
});
