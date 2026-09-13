import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PRICING_PROVENANCE_ROLES, USER_ROLES } from "@veridi/shared";

/**
 * R-20 na tela — nada é oferecido a quem a API recusaria
 * (R20-EXPORT-AUTHORIZATION-01).
 *
 * A autorização é do servidor, em JSON, CSV e PDF — provada em
 * `api modules/reports/r20-autorizacao.test.ts`. Aqui: com a MESMA lista
 * (`PRICING_PROVENANCE_ROLES`), a tela do R-20 não consulta nem mostra CSV e
 * PDF para os outros perfis, e o catálogo de relatórios não o lista para eles.
 */

const sessao = vi.hoisted(() => ({ role: "ADMIN" }));

vi.mock("../../lib/reports-api", () => ({
  getIndustrialCostByProductReport: vi.fn(),
  getPricingByProductReport: vi.fn(),
  getQuotePricingAuditReport: vi.fn(),
}));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", name: "Ana", role: sessao.role } }),
  useOptionalAuth: () => ({ user: { id: "u-1", name: "Ana", role: sessao.role } }),
}));

import { getQuotePricingAuditReport } from "../../lib/reports-api";
import { QuotePricingAuditReportPage } from "./CostReports";
import { ReportsHubPage } from "./ReportsHubPage";

const pode = (role: string) => (PRICING_PROVENANCE_ROLES as readonly string[]).includes(role);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getQuotePricingAuditReport).mockResolvedValue({ rows: [], page: 1, pageSize: 25, total: 0 } as never);
});

describe("tela do R-20 por perfil", () => {
  it.each(USER_ROLES.map((role) => ({ role, autorizado: pode(role) })))(
    "$role: consulta, CSV e PDF só com autorização ($autorizado)",
    async ({ role, autorizado }) => {
      sessao.role = role;
      render(
        <MemoryRouter>
          <QuotePricingAuditReportPage />
        </MemoryRouter>,
      );

      expect(screen.getByRole("heading", { name: "R-20 · Orçamento × Precificação" })).toBeInTheDocument();
      if (autorizado) {
        await waitFor(() => expect(getQuotePricingAuditReport).toHaveBeenCalled());
        expect(screen.getByRole("link", { name: "Exportar CSV" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "PDF" })).toBeInTheDocument();
        expect(screen.queryByText("Seu perfil não permite ver este relatório.")).toBeNull();
        return;
      }
      expect(screen.getByRole("alert")).toHaveTextContent("Seu perfil não permite ver este relatório.");
      expect(getQuotePricingAuditReport).not.toHaveBeenCalled();
      expect(screen.queryByRole("link", { name: "Exportar CSV" })).toBeNull();
      expect(screen.queryByRole("button", { name: "PDF" })).toBeNull();
    },
  );
});

describe("catálogo de relatórios por perfil", () => {
  it.each(USER_ROLES.map((role) => ({ role, autorizado: pode(role) })))(
    "$role: R-20 listado só com autorização ($autorizado); os demais continuam",
    ({ role, autorizado }) => {
      sessao.role = role;
      render(
        <MemoryRouter>
          <ReportsHubPage />
        </MemoryRouter>,
      );

      const codigos = screen.getAllByRole("button").map((botao) => botao.querySelector("b")?.textContent);
      expect(codigos.includes("R-20")).toBe(autorizado);
      expect(codigos).toEqual(expect.arrayContaining(["R-01", "R-15", "R-18", "R-19"]));
    },
  );
});
