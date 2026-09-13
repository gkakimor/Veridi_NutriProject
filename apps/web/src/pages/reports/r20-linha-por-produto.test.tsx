import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { QuotePricingAuditRowDTO } from "@veridi/shared";

/**
 * R-20 — uma linha do relatório por LINHA de orçamento (R20-UX-CLEANUP-WAVE-01).
 *
 * Numa versão com dois produtos, as duas linhas trazem o mesmo
 * `quoteVersionId`. Usado como chave da `<tr>`, ele se repetia: o React
 * avisava e, ao trocar o recorte, podia duplicar ou omitir linha. A identidade
 * de cada linha é a da linha de orçamento (`quoteLineId`), que a API devolve.
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

import { getQuotePricingAuditReport } from "../../lib/reports-api";
import { QuotePricingAuditReportPage } from "./CostReports";

function linha(
  quoteLineId: string,
  quoteVersionId: string,
  orcamento: string,
  productCode: string,
): QuotePricingAuditRowDTO {
  return {
    quoteLineId,
    quoteVersionId,
    quoteLabel: `${orcamento} · V1`,
    projectId: "proj-1",
    projectCode: "PROJ-000012",
    projectName: "Projeto multiproduto",
    customerName: "Nutri Alfa Ltda",
    productCode,
    status: "SENT",
    quotedQuantity: "100",
    uomCode: "kg",
    unitPrice: "10.0000",
    total: "1000.00",
    priceSource: "MANUAL",
    pricingLabel: null,
    tierQuantity: null,
    calculationCode: null,
    costQuality: null,
    industrialCostPerUnit: null,
    contributionMarginPercent: null,
    sentAt: null,
    acceptedAt: null,
  };
}

// ORC-000001 tem três produtos na mesma versão; ORC-000002, um.
const A = linha("ql-a", "qv-1", "ORC-000001", "PROD-A");
const B = linha("ql-b", "qv-1", "ORC-000001", "PROD-B");
const C = linha("ql-c", "qv-2", "ORC-000002", "PROD-C");
const D = linha("ql-d", "qv-1", "ORC-000001", "PROD-D");

let erro: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  erro = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  erro.mockRestore();
});

function responder(rows: QuotePricingAuditRowDTO[]) {
  return { rows, page: 1, pageSize: 25, total: rows.length };
}

/** Produto de cada linha da tabela, na ordem da tela. */
function produtosNaTela(): string[] {
  const corpo = screen.getByRole("table").querySelector("tbody")!;
  return within(corpo)
    .getAllByRole("row")
    .map((row) => within(row).getAllByRole("cell")[3]?.textContent ?? "");
}

function avisosDeChave(): string[] {
  return erro.mock.calls
    .map((args) => args.map(String).join(" "))
    .filter((texto) => /same key/i.test(texto));
}

describe("R-20 — versão com vários produtos", () => {
  it("todas as linhas aparecem, na ordem da API, sem aviso de chave duplicada", async () => {
    vi.mocked(getQuotePricingAuditReport).mockResolvedValue(responder([A, B, C]));
    render(
      <MemoryRouter>
        <QuotePricingAuditReportPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(produtosNaTela()).toEqual(["PROD-A", "PROD-B", "PROD-C"]));
    expect(avisosDeChave()).toEqual([]);
  });

  it("trocar o recorte reordena sem duplicar nem omitir linha da mesma versão", async () => {
    vi.mocked(getQuotePricingAuditReport).mockImplementation(async (filters) =>
      filters["priceSource"] === "MANUAL" ? responder([C, D, B, A]) : responder([A, B, C]),
    );
    render(
      <MemoryRouter>
        <QuotePricingAuditReportPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(produtosNaTela()).toEqual(["PROD-A", "PROD-B", "PROD-C"]));

    fireEvent.change(screen.getByLabelText("Origem do preço"), { target: { value: "MANUAL" } });

    await waitFor(() => expect(produtosNaTela()).toEqual(["PROD-C", "PROD-D", "PROD-B", "PROD-A"]));
    expect(avisosDeChave()).toEqual([]);
  });
});
