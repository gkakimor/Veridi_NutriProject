import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

/**
 * R-20 — a tabela, o CSV e o PDF levam o MESMO objeto de filtros
 * (R20-QUOTE-FILTER-COMPOSITION-01).
 *
 * A composição em AND mora no servidor, num `where` só, e é provada em
 * `api modules/reports/r20-filtros-compostos.test.ts` (JSON, contagem,
 * páginas e CSV). O que cabe à tela é não montar um segundo recorte: o que a
 * tabela consulta é o que o link do CSV e a rota do PDF recebem.
 */

vi.mock("../../lib/reports-api", () => ({
  getIndustrialCostByProductReport: vi.fn(),
  getPricingByProductReport: vi.fn(),
  getQuotePricingAuditReport: vi.fn(),
}));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }),
  useOptionalAuth: () => null,
}));

import { getQuotePricingAuditReport } from "../../lib/reports-api";
import { QuotePricingAuditReportPage } from "./CostReports";

function Destino() {
  const location = useLocation();
  return <p data-testid="destino">{`${location.pathname}${location.search}`}</p>;
}

function ultimaConsulta(): Record<string, unknown> {
  const chamadas = vi.mocked(getQuotePricingAuditReport).mock.calls;
  return (chamadas[chamadas.length - 1]?.[0] ?? {}) as Record<string, unknown>;
}

/** Filtros de uma URL, sem paginação — o CSV e o PDF levam o recorte inteiro. */
function filtrosDa(url: string): Record<string, string> {
  const params = new URL(url, "http://exemplo.invalid").searchParams;
  return Object.fromEntries([...params.entries()].filter(([chave]) => chave !== "page" && chave !== "pageSize"));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getQuotePricingAuditReport).mockImplementation(async (filters) => ({
    rows: [],
    page: Number(filters["page"] ?? 1),
    pageSize: 25,
    total: 0,
  }));
});

describe("R-20 — tela, CSV e PDF com o mesmo recorte", () => {
  it("origem do preço + busca: a consulta da tabela é o que o CSV e o PDF recebem", async () => {
    render(
      <MemoryRouter initialEntries={["/relatorio"]}>
        <Routes>
          <Route path="/relatorio" element={<QuotePricingAuditReportPage />} />
          <Route path="/print/relatorios/:code" element={<Destino />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Origem do preço"), { target: { value: "MANUAL" } });
    fireEvent.change(screen.getByPlaceholderText("Buscar por ORC, PREC, CALC ou projeto…"), {
      target: { value: "PROJ-000012" },
    });
    await waitFor(() =>
      expect(ultimaConsulta()).toMatchObject({ priceSource: "MANUAL", search: "PROJ-000012", page: 1 }),
    );

    const tabela = { priceSource: "MANUAL", search: "PROJ-000012" };
    const csv = screen.getByRole("link", { name: "Exportar CSV" }).getAttribute("href") ?? "";
    expect(new URL(csv, "http://exemplo.invalid").pathname).toBe("/reports/commercial/quote-pricing/export.csv");
    expect(filtrosDa(csv)).toEqual(tabela);

    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    const pdf = (await screen.findByTestId("destino")).textContent ?? "";
    expect(pdf.startsWith("/print/relatorios/R-20?")).toBe(true);
    expect(filtrosDa(pdf)).toEqual(tabela);
  });
});
