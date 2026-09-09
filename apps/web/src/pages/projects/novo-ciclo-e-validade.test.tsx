import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProjectDTO, ProjectStatus, QuoteLineDTO, QuoteVersionDTO } from "@veridi/shared";

/**
 * A tela do projeto aprovado abre a próxima negociação — COM-CORE.
 *
 * Ela dizia o contrário, com todas as letras: "Projeto aprovado é histórico...
 * Para propor de novo ao mesmo cliente, crie um projeto novo". Era coerente com
 * a regra antiga de um ciclo comercial por projeto, e mandava multiplicar o
 * cadastro pelo calendário.
 *
 * O que estes testes fixam:
 *
 * 1. **Aprovado oferece a ação.** Cancelado continua explicando por que não.
 * 2. **Vencida é visível e bloqueia o aceite**, com o motivo escrito — o
 *    servidor continua sendo a autoridade, a tela só evita o clique inútil.
 * 3. **Enviar exige validade**, dito antes do clique.
 * 4. **Várias aceitas convivem** sem virar "a proposta atual" sem contexto: a
 *    linha diz qual Pedido cada uma originou.
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
    status: "DRAFT",
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

function projeto(versions: QuoteVersionDTO[], status: ProjectStatus): ProjectDTO {
  return {
    id: "prj-1",
    code: "PROJ-000001",
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "Cliente Teste",
    name: "Linha Performance",
    status,
    products: [],
    quoteVersions: versions,
    statusHistory: [],
  } as unknown as ProjectDTO;
}

function abrir(versions: QuoteVersionDTO[], status: ProjectStatus = "SAMPLE") {
  render(
    <MemoryRouter>
      <QuoteVersionsSection
        project={projeto(versions, status)}
        canEdit
        projectStatus={status}
        onChanged={() => {}}
      />
    </MemoryRouter>,
  );
}

function botao(nome: RegExp | string): HTMLButtonElement | null {
  return (screen.queryByRole("button", { name: nome }) ?? null) as HTMLButtonElement | null;
}

describe("COM-01 — o projeto aprovado oferece a próxima negociação", () => {
  it("APROVADO mostra “Novo orçamento” e não manda criar outro projeto", () => {
    abrir([versao({ status: "ACCEPTED" })], "APPROVED");

    expect(botao("Novo orçamento")).toBeTruthy();
    expect(botao("Novo orçamento")!.disabled).toBe(false);
    expect(screen.queryByText(/crie um projeto novo/i)).toBeNull();
    expect(screen.queryByText(/Projeto aprovado é histórico/i)).toBeNull();
    // E diz, sem jargão, que a recompra acontece aqui mesmo.
    expect(screen.getByText(/Cada nova compra deste cliente é um orçamento novo/i)).toBeTruthy();
  });

  it("CANCELADO continua sem a ação, e diz por quê", () => {
    abrir([versao({ status: "ACCEPTED" })], "CANCELLED");

    expect(botao(/Novo orçamento|Criar nova versão/)).toBeNull();
    expect(screen.getByText(/Projeto cancelado é histórico/i)).toBeTruthy();
  });

  it("antes da aprovação a linguagem do primeiro ciclo não muda", () => {
    abrir([versao()], "SAMPLE");

    expect(botao("Abrir rascunho")).toBeTruthy();
    expect(screen.queryByText(/Cada nova compra deste cliente/i)).toBeNull();
  });

  it("com duas aceitas, cada linha diz qual Pedido originou", () => {
    abrir(
      [
        versao({
          id: "q1",
          status: "ACCEPTED",
          versionLabel: "ORC-000001 · V1",
          sourcedOrder: {
            id: "co-1",
            code: "PED-000001",
            status: "IN_FULFILLMENT",
            createdAt: "2026-01-10T00:00:00.000Z",
          },
        }),
        versao({
          id: "q2",
          status: "ACCEPTED",
          versionNumber: 2,
          versionLabel: "ORC-000001 · V2",
          sourcedOrder: {
            id: "co-2",
            code: "PED-000002",
            status: "DRAFT",
            createdAt: "2026-03-10T00:00:00.000Z",
          },
        }),
      ],
      "APPROVED",
    );

    expect(screen.getByText(/originou PED-000001/)).toBeTruthy();
    expect(screen.getByText(/originou PED-000002/)).toBeTruthy();
  });
});

describe("COM-02 — validade na tela", () => {
  it("proposta enviada e vencida mostra “Vencido” com a data, e o aceite fica bloqueado", () => {
    abrir(
      [versao({ status: "SENT", expired: true, validUntil: "2026-09-15T00:00:00.000Z" })],
      "SAMPLE",
    );

    expect(screen.getByText("Vencido")).toBeTruthy();
    // A data continua visível: o documento não some do histórico.
    expect(screen.getAllByText(/15\/09\/2026/).length).toBeGreaterThan(0);

    const aceite = botao("Registrar aceite")!;
    expect(aceite.disabled).toBe(true);
    expect(aceite.title).toMatch(/vencida em 15\/09\/2026/i);
    expect(screen.getByRole("alert").textContent).toMatch(/janela de aceite fechou/i);
  });

  it("proposta enviada e vigente aceita normalmente", () => {
    abrir([versao({ status: "SENT", expired: false })], "SAMPLE");

    expect(screen.queryByText("Vencido")).toBeNull();
    expect(botao("Registrar aceite")!.disabled).toBe(false);
  });

  it("rascunho sem validade não envia, e a tela diz o que falta", () => {
    abrir([versao({ status: "DRAFT", validUntil: null })], "SAMPLE");

    const enviar = botao("Enviar ao cliente")!;
    expect(enviar.disabled).toBe(true);
    expect(enviar.title).toMatch(/validade da proposta antes de enviar/i);
    expect(screen.getByText(/Informe a validade da proposta antes de enviar/i)).toBeTruthy();
  });

  it("rascunho com validade envia", () => {
    abrir([versao({ status: "DRAFT" })], "SAMPLE");

    expect(botao("Enviar ao cliente")!.disabled).toBe(false);
  });
});
