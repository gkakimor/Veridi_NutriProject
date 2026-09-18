import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CostTemplateDTO, CostTemplateVersionDTO } from "@veridi/shared";

/**
 * "Excluir definitivamente" no Modelo de Estrutura de Custo —
 * MASTER-DATA-HARD-DELETE-01, com o desenho que as três bibliotecas e o
 * Roteiro compartilham: botão só para o Administrador, no grupo do Arquivar;
 * liberado, exclui e volta à lista; bloqueado, a saída é Arquivar.
 */

const getCostTemplate = vi.fn();
const setCostTemplateArchived = vi.fn();

vi.mock("../../lib/cost-pricing-templates-api", () => ({
  getCostTemplate: (...a: unknown[]) => getCostTemplate(...a),
  setCostTemplateArchived: (...a: unknown[]) => setCostTemplateArchived(...a),
  updateCostTemplate: vi.fn(),
  updateCostTemplateVersion: vi.fn(),
  activateCostTemplateVersion: vi.fn(),
  createCostTemplateVersionFrom: vi.fn(),
  compareCostTemplateVersions: vi.fn(),
}));
vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: () => Promise.resolve({ resources: [] }),
}));
vi.mock("../../lib/units-api", () => ({ listUnits: () => Promise.resolve([]) }));
vi.mock("../../lib/master-data-deletion-api", async (original) => ({
  ...(await original<object>()),
  consultarExclusaoDefinitiva: vi.fn(),
  excluirDefinitivamente: vi.fn(),
}));

const sessao = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u1", name: "Sessão", role: sessao.role } });
  return { useAuth: valor, useOptionalAuth: valor };
});

import { consultarExclusaoDefinitiva, excluirDefinitivamente } from "../../lib/master-data-deletion-api";
import { CostTemplateDetailPage } from "./CostTemplateDetailPage";

function v1(): CostTemplateVersionDTO {
  return {
    id: "tecv-1",
    industrialCostTemplateId: "tec-1",
    templateCode: "TEC-000009",
    templateName: "Modelo criado por engano",
    versionNumber: 1,
    versionLabel: "TEC-000009 V1",
    status: "DRAFT",
    referenceOutputQuantity: "1000",
    referenceOutputUomCode: "un",
    energyCalculationMode: "NONE",
    energyResourceId: null,
    energyResourceName: null,
    notes: null,
    resourceUsages: [],
    additionalCosts: [],
    createdAt: "2026-09-18T10:00:00.000Z",
    createdBy: "Admin",
    activatedAt: null,
    activatedBy: null,
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    usageCount: 0,
  };
}

function modelo(): CostTemplateDTO {
  const draft = v1();
  return {
    id: "tec-1",
    code: "TEC-000009",
    name: "Modelo criado por engano",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: null,
    draftVersion: draft,
    versions: [draft],
    createdAt: "2026-09-18T10:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-09-18T10:00:00.000Z",
  };
}

function abrir() {
  render(
    <MemoryRouter initialEntries={["/gestao/templates-estrutura/tec-1"]}>
      <Routes>
        <Route path="/gestao/templates-estrutura/:templateId" element={<CostTemplateDetailPage />} />
        <Route path="/gestao/templates-estrutura" element={<p>Lista de modelos de estrutura</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const PREVIA = {
  entityType: "INDUSTRIAL_COST_TEMPLATE" as const,
  entityId: "tec-1",
  entityCode: "TEC-000009",
  entityName: "Modelo criado por engano",
  alternative: "ARCHIVE" as const,
  alternativeAvailable: true,
};

beforeEach(() => {
  sessao.role = "ADMIN";
  getCostTemplate.mockReset().mockResolvedValue(modelo());
  setCostTemplateArchived.mockReset().mockResolvedValue({ ...modelo(), archived: true });
  vi.mocked(consultarExclusaoDefinitiva).mockReset();
  vi.mocked(excluirDefinitivamente).mockReset();
});

describe("quem vê", () => {
  it("Administrador: Excluir definitivamente no grupo do Arquivar, com peso de ação destrutiva", async () => {
    abrir();
    const excluir = await screen.findByRole("button", { name: "Excluir definitivamente" });
    expect(excluir).toHaveClass("btn--danger");
    expect(excluir.closest(".form-actions__group")).toBe(
      screen.getByRole("button", { name: "Arquivar" }).closest(".form-actions__group"),
    );
    // Abrir o Modelo não consulta nada: a prévia só roda quando o diálogo abre.
    expect(consultarExclusaoDefinitiva).not.toHaveBeenCalled();
  });

  it("Produção edita e arquiva o Modelo, mas não exclui definitivamente", async () => {
    sessao.role = "PRODUCTION";
    abrir();
    expect(await screen.findByRole("button", { name: "Arquivar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir definitivamente" })).toBeNull();
  });
});

describe("Administrador", () => {
  it("liberado: exclui com o motivo e volta à lista", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue({
      ...PREVIA,
      canDelete: true,
      references: [],
      removedTogether: [{ source: "Versão V1 em rascunho, sem conteúdo", count: 1 }],
    });
    vi.mocked(excluirDefinitivamente).mockResolvedValue({
      historyId: "h-1",
      entityType: "INDUSTRIAL_COST_TEMPLATE",
      entityId: "tec-1",
      entityCode: "TEC-000009",
      entityName: "Modelo criado por engano",
      deletedAt: "2026-09-18T12:00:00.000Z",
    });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Excluir definitivamente" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(await within(dialogo).findByText("Versão V1 em rascunho, sem conteúdo")).toBeInTheDocument();
    fireEvent.change(within(dialogo).getByLabelText("Motivo da exclusão *"), { target: { value: "Duplicado" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Excluir definitivamente" }));

    expect(await screen.findByText("Lista de modelos de estrutura")).toBeInTheDocument();
    expect(excluirDefinitivamente).toHaveBeenCalledWith("INDUSTRIAL_COST_TEMPLATE", "tec-1", "Duplicado");
  });

  it("bloqueado: a saída Arquivar arquiva o Modelo, e nada é excluído", async () => {
    vi.mocked(consultarExclusaoDefinitiva).mockResolvedValue({
      ...PREVIA,
      canDelete: false,
      references: [
        {
          source: "Estruturas de custo criadas a partir do modelo",
          count: 1,
          reason: "O modelo já foi aplicado — a estrutura de custo guarda a origem.",
        },
      ],
      removedTogether: [],
    });
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: "Excluir definitivamente" }));
    const dialogo = await screen.findByRole("alertdialog");
    fireEvent.click(await within(dialogo).findByRole("button", { name: "Arquivar" }));

    await waitFor(() => expect(setCostTemplateArchived).toHaveBeenCalledWith("tec-1", true));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(excluirDefinitivamente).not.toHaveBeenCalled();
  });
});
