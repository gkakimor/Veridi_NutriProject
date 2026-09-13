import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PRICING_PROVENANCE_ROLES, USER_ROLES } from "@veridi/shared";

/**
 * R-19 na tela — nada é oferecido a quem a API recusaria
 * (R19-REPORT-AUTHORIZATION-01).
 *
 * Margem e markup das faixas ativas são proveniência econômica: a autoridade é
 * `PRICING_PROVENANCE_ROLES`, a mesma do R-20. A recusa de verdade é do
 * servidor (`api modules/pricing/pricing.test.ts`, "perfil × formato"). Aqui:
 * a tela do R-19 não consulta nem mostra CSV e PDF para os outros perfis, e o
 * catálogo não o lista para eles. R-18 (só custo industrial) continua aberto.
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

import { getPricingByProductReport } from "../../lib/reports-api";
import { PricingByProductReportPage } from "./CostReports";
import { ReportsHubPage } from "./ReportsHubPage";

const pode = (role: string) => (PRICING_PROVENANCE_ROLES as readonly string[]).includes(role);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPricingByProductReport).mockResolvedValue({ rows: [], page: 1, pageSize: 25, total: 0 } as never);
});

describe("tela do R-19 por perfil", () => {
  it.each(USER_ROLES.map((role) => ({ role, autorizado: pode(role) })))(
    "$role: consulta, CSV e PDF só com autorização ($autorizado)",
    async ({ role, autorizado }) => {
      sessao.role = role;
      render(
        <MemoryRouter>
          <PricingByProductReportPage />
        </MemoryRouter>,
      );

      expect(screen.getByRole("heading", { name: "R-19 · Precificação por produto" })).toBeInTheDocument();
      if (autorizado) {
        await waitFor(() => expect(getPricingByProductReport).toHaveBeenCalled());
        expect(screen.getByRole("link", { name: "Exportar CSV" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "PDF" })).toBeInTheDocument();
        expect(screen.queryByText("Seu perfil não permite ver este relatório.")).toBeNull();
        return;
      }
      expect(screen.getByRole("alert")).toHaveTextContent("Seu perfil não permite ver este relatório.");
      expect(getPricingByProductReport).not.toHaveBeenCalled();
      expect(screen.queryByRole("link", { name: "Exportar CSV" })).toBeNull();
      expect(screen.queryByRole("button", { name: "PDF" })).toBeNull();
    },
  );
});

describe("catálogo de relatórios por perfil — R-19", () => {
  it.each(USER_ROLES.map((role) => ({ role, autorizado: pode(role) })))(
    "$role: R-19 listado só com autorização ($autorizado); R-18 continua",
    ({ role, autorizado }) => {
      sessao.role = role;
      render(
        <MemoryRouter>
          <ReportsHubPage />
        </MemoryRouter>,
      );

      const codigos = screen.getAllByRole("button").map((botao) => botao.querySelector("b")?.textContent);
      expect(codigos.includes("R-19")).toBe(autorizado);
      expect(codigos.includes("R-18")).toBe(true);
    },
  );
});
