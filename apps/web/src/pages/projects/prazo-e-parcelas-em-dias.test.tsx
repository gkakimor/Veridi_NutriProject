import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CustomerOrderDTO, QuotePaymentScheduleDTO, QuoteVersionDTO } from "@veridi/shared";
import { emDias } from "../../lib/duration";
import { QuotePdf } from "../../pdf/documents/QuotePdf";
import { CommercialOriginSection } from "../customer-orders/CommercialOriginSection";
import { QuoteConditionsForm } from "./QuoteConditionsForm";

// O documento do cliente é PDF: as primitivas do renderer são lidas como DOM.
vi.mock("@react-pdf/renderer", async () => ({ ...(await import("../../pdf/testing/react-pdf-dom")) }));

/**
 * Prazo e parcelas do Orçamento em dias: "1 dia", nunca "1 dias"
 * (REPORTS-PRESENTATION-WAVE-02).
 *
 * O prazo de entrega no PDF, o vencimento das parcelas no PDF, no formulário
 * de condições e na Origem comercial do Pedido, e o intervalo do plano no
 * formulário escreviam "dias" fixo. Os números são os do servidor — a conta
 * não muda, só a palavra.
 */

/** Plano parcelado com vencimentos em 0, 1 e 2 dias — valores de apresentação. */
function plano(intervalo: number | null): QuotePaymentScheduleDTO {
  return {
    subtotal: "300.00",
    discountPercent: null,
    discountAmount: "0.00",
    total: "300.00",
    method: "INSTALLMENTS",
    downPaymentPercent: null,
    downPayment: "0.00",
    financedAmount: "300.00",
    monthlyInterestPercent: null,
    installmentIntervalDays: intervalo,
    installments: [
      { number: 1, amount: "100.00", dueInDays: 0 },
      { number: 2, amount: "100.00", dueInDays: 1 },
      { number: 3, amount: "100.00", dueInDays: 2 },
    ],
    totalPayable: "300.00",
    interestAmount: "0.00",
  };
}

function proposta(overrides: Partial<QuoteVersionDTO> = {}): QuoteVersionDTO {
  return {
    id: "q1",
    code: "ORC-000001",
    projectId: "prj-1",
    versionNumber: 1,
    versionLabel: "ORC-000001 · V1",
    status: "SENT",
    quoteDate: "2026-09-01T00:00:00.000Z",
    validUntil: "2026-09-30T00:00:00.000Z",
    currencyCode: "BRL",
    lines: [],
    total: "300.00",
    subtotal: "300.00",
    discountPercent: null,
    paymentMethod: "INSTALLMENTS",
    downPaymentPercent: null,
    installmentCount: 3,
    installmentIntervalDays: 1,
    monthlyInterestPercent: null,
    paymentSchedule: plano(1),
    leadTimeDays: null,
    commercialNotes: null,
    paymentTerms: null,
    sentAt: null,
    customerName: "Nutri Alfa Suplementos Ltda",
    customerCnpj: null,
    projectCode: "PRJ-000001",
    projectName: "Linha Whey",
    ...overrides,
  } as QuoteVersionDTO;
}

/** Valor de um campo rotulado do PDF. */
function campoDoPdf(container: HTMLElement, rotulo: string): string | null {
  for (const field of container.querySelectorAll('[data-pdf-role="field"]')) {
    const [label, value] = [...field.children];
    if (label?.textContent === rotulo) return value?.textContent ?? null;
  }
  return null;
}

describe("emDias", () => {
  it.each([
    [0, "0 dias"],
    [1, "1 dia"],
    [2, "2 dias"],
    [30, "30 dias"],
  ])("%i → %s", (quantidade, texto) => {
    expect(emDias(quantidade)).toBe(texto);
  });
});

describe("PDF do Orçamento", () => {
  it.each([
    [null, "—"],
    [1, "1 dia"],
    [2, "2 dias"],
  ])("prazo de entrega %s → %s", (prazo, texto) => {
    const { container } = render(
      <QuotePdf quote={proposta({ leadTimeDays: prazo })} generatedAt={new Date("2026-09-11T12:30:00.000Z")} />,
    );

    expect(campoDoPdf(container, "Prazo de entrega")).toBe(texto);
  });

  it("prazo 0 gravado continua saindo — (sem prazo), como antes", () => {
    const { container } = render(
      <QuotePdf quote={proposta({ leadTimeDays: 0 })} generatedAt={new Date("2026-09-11T12:30:00.000Z")} />,
    );

    expect(campoDoPdf(container, "Prazo de entrega")).toBe("—");
  });

  it("vencimento das parcelas: 0 dias, 1 dia, 2 dias", () => {
    const { container } = render(
      <QuotePdf quote={proposta()} generatedAt={new Date("2026-09-11T12:30:00.000Z")} />,
    );

    const parcelas = [...container.querySelectorAll('[data-pdf-role="row"]')]
      .map((linha) => [...linha.querySelectorAll('[data-pdf-role="cell"]')].map((celula) => celula.textContent))
      .filter((celulas) => /ª parcela$/.test(celulas[0] ?? ""));
    expect(parcelas.map((celulas) => celulas[1])).toEqual(["0 dias", "1 dia", "2 dias"]);
    expect(container.textContent).not.toContain("1 dias");
  });
});

describe("Condições do Orçamento na tela", () => {
  function montar(intervalo: number | null) {
    return render(
      <QuoteConditionsForm
        quote={proposta({ paymentSchedule: plano(intervalo), installmentIntervalDays: intervalo })}
        editable={false}
        saving={false}
        onSave={() => undefined}
      />,
    );
  }

  it("vencimento das parcelas na tabela do plano: 0 dias, 1 dia, 2 dias", () => {
    montar(1);

    const linhas = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(linhas.map((linha) => within(linha).getAllByRole("cell").at(-1)?.textContent)).toEqual([
      "0 dias",
      "1 dia",
      "2 dias",
    ]);
    expect(document.body.textContent).not.toContain("1 dias");
  });

  it.each([
    [1, "3× de R$ 100,00 a cada 1 dia"],
    [2, "3× de R$ 100,00 a cada 2 dias"],
    [30, "3× de R$ 100,00 por mês"],
    [null, "3× de R$ 100,00 por mês"],
  ])("intervalo %s → %s", (intervalo, texto) => {
    montar(intervalo);

    const rotulo = screen.getByText("Parcelas", { selector: "dt" });
    expect(rotulo.nextElementSibling?.textContent?.replace(/\s/g, " ")).toBe(texto);
  });
});

describe("Origem comercial do Pedido", () => {
  it("vencimento das parcelas acordadas: 0 dias, 1 dia, 2 dias", () => {
    const pedido = {
      id: "ord-1",
      code: "PED-000001",
      status: "DRAFT",
      lines: [],
      commercialOrigin: {
        quoteVersionId: "q1",
        quoteCode: "ORC-000001",
        quoteVersionNumber: 1,
        projectId: "prj-1",
        projectCode: "PRJ-000001",
        subtotalAmount: "300.00",
        discountPercent: null,
        totalAmount: "300.00",
        paymentSchedule: plano(1),
      },
    } as unknown as CustomerOrderDTO;

    render(
      <MemoryRouter>
        <CommercialOriginSection order={pedido} />
      </MemoryRouter>,
    );

    const linhas = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(linhas.map((linha) => within(linha).getAllByRole("cell").at(-1)?.textContent)).toEqual([
      "0 dias",
      "1 dia",
      "2 dias",
    ]);
    expect(document.body.textContent).not.toContain("1 dias");
  });
});
