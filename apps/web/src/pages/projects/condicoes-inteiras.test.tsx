import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProjectDTO, QuoteLineDTO, QuoteVersionDTO } from "@veridi/shared";

/**
 * Inteiro das condições que não dá para ler não vira "não informado" —
 * QUOTE-INT-FIELDS-01.
 *
 * Prazo, parcelas e intervalo eram convertidos com `Number(texto)`: `abc` virava
 * `NaN`, o JSON escreve `NaN` como `null`, e "Salvar condições" APAGAVA o valor
 * gravado — o que a pessoa tentou informar, e errou, virava a decisão de
 * limpar o campo.
 *
 * O que estes casos fixam:
 *
 * 1. texto que não é inteiro simples — letra, vírgula, ponto, notação
 *    científica, sinal — é INVÁLIDO: erro no próprio campo, salvar e simular
 *    presos, nenhum pedido, e o envio preso porque há condição por salvar;
 * 2. o inteiro fora dos limites da API (zero, acima do máximo) também;
 * 3. campo vazio é outra coisa: continua sendo "não informado", e apagar o
 *    valor gravado continua possível;
 * 4. corrigir o inválido libera salvar, e o pedido leva o inteiro.
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
  updateQuoteLine: vi.fn(),
  updateQuoteVersion: vi.fn(() => Promise.resolve()),
  useManualQuotePrice: vi.fn(),
}));

import { previewQuotePaymentSchedule, updateQuoteVersion } from "../../lib/projects-api";
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

/** Rascunho parcelado, com os três inteiros gravados. */
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
    discountPercent: null,
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

/** Os três inteiros das condições: rótulo, id do erro e o que a mensagem diz. */
const INTEIROS = [
  {
    chave: "leadTimeDays",
    rotulo: "Prazo de entrega (dias)",
    erro: "quote-lead-time-error",
    mensagem: "Prazo de entrega (dias): informe um número inteiro maior que zero.",
  },
  {
    chave: "installmentCount",
    rotulo: "Parcelas",
    erro: "quote-installments-error",
    mensagem: "Parcelas: informe um número inteiro de 1 a 120.",
  },
  {
    chave: "installmentIntervalDays",
    rotulo: "Intervalo (dias)",
    erro: "quote-interval-error",
    mensagem: "Intervalo (dias): informe um número inteiro de 1 a 365.",
  },
] as const;

/** Não é inteiro simples, ou é inteiro que a API recusa. */
const INVALIDOS = ["abc", "30abc", "3 dias", "30,5", "30.5", "1e2", "-1", "0"] as const;

const casos = INTEIROS.flatMap((inteiro) =>
  INVALIDOS.map((texto) => [inteiro.chave, texto, inteiro] as const),
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QUOTE-INT-FIELDS-01 — inteiro ilegível fica ilegível na tela", () => {
  it.each(casos)("%s = %j: erro no campo, nada salvo, nada simulado, envio preso", (_chave, texto, inteiro) => {
    abrirSecao();

    digitar(inteiro.rotulo, texto);

    // O texto fica: a pessoa vê o que escreveu, junto do erro.
    expect(campo(inteiro.rotulo).value).toBe(texto);
    const erro = document.getElementById(inteiro.erro);
    expect(erro?.textContent).toBe(inteiro.mensagem);
    expect(campo(inteiro.rotulo)).toHaveAttribute("aria-invalid", "true");
    expect(campo(inteiro.rotulo)).toHaveAttribute("aria-describedby", inteiro.erro);

    // Alterado E inválido: nunca "Tudo salvo".
    expect(situacao()).toBe("Alterações não salvas");
    expect(botao("Salvar condições").disabled).toBe(true);
    expect(botao("Simular").disabled).toBe(true);
    fireEvent.click(botao("Salvar condições"));
    fireEvent.click(botao("Simular"));
    expect(updateQuoteVersion).not.toHaveBeenCalled();
    expect(previewQuotePaymentSchedule).not.toHaveBeenCalled();

    // Condição por salvar segura o envio (QUOTE-SEND-DIRTY-01).
    expect(botao("Enviar ao cliente").disabled).toBe(true);
  });

  it.each([
    ["Parcelas", "121", "Parcelas: informe um número inteiro de 1 a 120."],
    ["Intervalo (dias)", "366", "Intervalo (dias): informe um número inteiro de 1 a 365."],
  ])("%s acima do máximo da API (%s) é recusado na tela", (rotulo, texto, mensagem) => {
    abrirSecao();

    digitar(rotulo, texto);

    expect(screen.getByText(mensagem)).toBeInTheDocument();
    expect(botao("Salvar condições").disabled).toBe(true);
  });

  it("gravado vazio e digitado inválido: continua sendo alteração, e inválida", () => {
    abrirSecao(versao({ leadTimeDays: null }));

    digitar("Prazo de entrega (dias)", "abc");

    // Inválido nunca equivale a vazio.
    expect(situacao()).toBe("Alterações não salvas");
    expect(botao("Salvar condições").disabled).toBe(true);
  });
});

describe("QUOTE-INT-FIELDS-01 — vazio, correção e escrita equivalente", () => {
  it("prazo 30, digitado abc: nada vai ao servidor; corrigido para 45, salva 45", async () => {
    abrirSecao();

    digitar("Prazo de entrega (dias)", "abc");
    fireEvent.click(botao("Salvar condições"));
    expect(updateQuoteVersion).not.toHaveBeenCalled();

    digitar("Prazo de entrega (dias)", "45");
    expect(document.getElementById("quote-lead-time-error")).toBeNull();
    expect(campo("Prazo de entrega (dias)")).not.toHaveAttribute("aria-invalid");
    expect(botao("Salvar condições").disabled).toBe(false);

    fireEvent.click(botao("Salvar condições"));
    await waitFor(() => expect(updateQuoteVersion).toHaveBeenCalledTimes(1));
    expect(updateQuoteVersion).toHaveBeenCalledWith("q1", expect.objectContaining({ leadTimeDays: 45 }));
  });

  it("apagar o prazo é limpar de propósito: salva null", async () => {
    abrirSecao();

    digitar("Prazo de entrega (dias)", "   ");

    expect(document.getElementById("quote-lead-time-error")).toBeNull();
    fireEvent.click(botao("Salvar condições"));
    await waitFor(() => expect(updateQuoteVersion).toHaveBeenCalledTimes(1));
    expect(updateQuoteVersion).toHaveBeenCalledWith("q1", expect.objectContaining({ leadTimeDays: null }));
  });

  it.each([
    [" 45 ", 45],
    ["045", 45],
  ])("%j é o inteiro %i", async (texto, esperado) => {
    abrirSecao();

    digitar("Prazo de entrega (dias)", texto);

    expect(document.getElementById("quote-lead-time-error")).toBeNull();
    fireEvent.click(botao("Salvar condições"));
    await waitFor(() => expect(updateQuoteVersion).toHaveBeenCalledTimes(1));
    expect(updateQuoteVersion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ leadTimeDays: esperado }),
    );
  });

  it("030 sobre 30 gravado é o mesmo prazo: nada a salvar", () => {
    abrirSecao();

    digitar("Prazo de entrega (dias)", "030");

    expect(document.getElementById("quote-lead-time-error")).toBeNull();
    expect(situacao()).toBe("Tudo salvo");
    expect(botao("Salvar condições").disabled).toBe(true);
  });

  it("parcelas e intervalo corrigidos saem como inteiros", async () => {
    abrirSecao();

    digitar("Parcelas", "3,5");
    digitar("Intervalo (dias)", "trinta");
    expect(botao("Salvar condições").disabled).toBe(true);

    digitar("Parcelas", "4");
    digitar("Intervalo (dias)", "28");
    fireEvent.click(botao("Salvar condições"));

    await waitFor(() => expect(updateQuoteVersion).toHaveBeenCalledTimes(1));
    expect(updateQuoteVersion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ installmentCount: 4, installmentIntervalDays: 28 }),
    );
  });
});
