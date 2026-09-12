import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { CostTemplateDTO, CostTemplateVersionDTO } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-04 no Modelo de Estrutura de Custo.
 *
 * Dois blocos gravam separado — identificação e rascunho —, cada um com o seu
 * botão, e a guarda soma os dois: "Salvar identificação" não absolve a base
 * alterada. A versão ativa, o histórico e a comparação entre versões são
 * leitura e nunca sujam a tela.
 */

const getCostTemplate = vi.fn();
const updateCostTemplate = vi.fn();
const updateCostTemplateVersion = vi.fn();

vi.mock("../../lib/cost-pricing-templates-api", () => ({
  getCostTemplate: (...a: unknown[]) => getCostTemplate(...a),
  updateCostTemplate: (...a: unknown[]) => updateCostTemplate(...a),
  updateCostTemplateVersion: (...a: unknown[]) => updateCostTemplateVersion(...a),
  setCostTemplateArchived: vi.fn(),
  activateCostTemplateVersion: vi.fn(),
  createCostTemplateVersionFrom: vi.fn(),
  compareCostTemplateVersions: vi.fn(),
}));

vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: () =>
    Promise.resolve({
      resources: [
        {
          id: "res-enc",
          code: "REC-001",
          name: "Encapsuladora",
          type: "EQUIPMENT",
          defaultUsageUom: "HOUR",
          active: true,
        },
      ],
    }),
}));

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

import { CostTemplateDetailPage } from "./CostTemplateDetailPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

function rascunho(overrides: Partial<CostTemplateVersionDTO> = {}): CostTemplateVersionDTO {
  return {
    id: "tecv-3",
    industrialCostTemplateId: "tec-1",
    templateCode: "TEC-000004",
    templateName: "Cápsulas — Linha padrão",
    versionNumber: 3,
    versionLabel: "TEC-000004 V3",
    status: "DRAFT",
    referenceOutputQuantity: "1000",
    referenceOutputUomCode: "un",
    energyCalculationMode: "NONE",
    energyResourceId: null,
    energyResourceName: null,
    notes: null,
    resourceUsages: [
      {
        id: "u1",
        industrialResourceId: "res-enc",
        resourceCode: "REC-001",
        resourceName: "Encapsuladora",
        resourceType: "EQUIPMENT",
        usageBasis: "FIXED_PER_REFERENCE_BATCH",
        usageQuantity: "4",
        usageUom: "HOUR",
        resourceCount: 1,
        totalUsageQuantity: "4",
        notes: null,
        sortOrder: 0,
      },
    ],
    additionalCosts: [],
    createdAt: "2026-09-01T12:00:00.000Z",
    createdBy: "Admin",
    activatedAt: null,
    activatedBy: null,
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    usageCount: 0,
    ...overrides,
  };
}

function template(overrides: Partial<CostTemplateDTO> = {}): CostTemplateDTO {
  const draft = rascunho();
  return {
    id: "tec-1",
    code: "TEC-000004",
    name: "Cápsulas — Linha padrão",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: null,
    draftVersion: draft,
    versions: [draft],
    createdAt: "2026-07-01T12:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <nav id="sidebar">
        <Link to="/comercial/pedidos">Pedidos</Link>
      </nav>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

async function abrir() {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/gestao/templates-estrutura/:templateId" element={<CostTemplateDetailPage />} />
        <Route path="/comercial/pedidos" element={<h1>Pedidos</h1>} />
      </Route>,
    ),
    { initialEntries: ["/gestao/templates-estrutura/tec-1"] },
  );
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByLabelText("Base de produção")).toBeInTheDocument());
}

const nome = () => screen.getByLabelText("Nome");
const base = () => screen.getByLabelText("Base de produção");
const menuPedidos = () => screen.getByRole("link", { name: "Pedidos" });
const pergunta = () => screen.queryByText("Sair sem salvar?");

beforeEach(() => {
  vi.clearAllMocks();
  getCostTemplate.mockResolvedValue(template());
});

describe("Modelo de Estrutura de Custo — guarda de alterações não salvas", () => {
  it("modelo carregado e não tocado sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("alterar a base do rascunho pergunta antes de sair", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(base(), { target: { value: "2000" } });
    await user.click(menuPedidos());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(
      screen.getByText(/alterações não salvas neste modelo de estrutura de custo/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("redigitar a mesma base em outra forma não é alteração", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(base(), { target: { value: "1000,00" } });
    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("alterar o nome também pergunta, e desfazer limpa", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(nome(), { target: { value: "Cápsulas — Linha nova" } });
    await user.click(menuPedidos());
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    fireEvent.change(nome(), { target: { value: "Cápsulas — Linha padrão" } });
    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
  });

  it("salvar a identificação não absolve o rascunho ainda alterado", async () => {
    const user = userEvent.setup();
    await abrir();

    // Bloco A: identificação. Bloco B: rascunho.
    fireEvent.change(nome(), { target: { value: "Cápsulas — Linha nova" } });
    fireEvent.change(base(), { target: { value: "2000" } });

    updateCostTemplate.mockResolvedValue(undefined);
    getCostTemplate.mockResolvedValue(template({ name: "Cápsulas — Linha nova" }));
    await user.click(screen.getByRole("button", { name: "Salvar identificação" }));
    await waitFor(() => expect(updateCostTemplate).toHaveBeenCalled());
    await waitFor(() => expect(nome()).toHaveValue("Cápsulas — Linha nova"));

    await user.click(menuPedidos());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("salvar o rascunho fecha a pendência dele", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(base(), { target: { value: "2000" } });

    updateCostTemplateVersion.mockResolvedValue(undefined);
    getCostTemplate.mockResolvedValue(
      template({ draftVersion: rascunho({ referenceOutputQuantity: "2000" }) }),
    );
    await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(updateCostTemplateVersion).toHaveBeenCalled());

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("linha de recurso em branco não conta como trabalho a perder", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(screen.getByRole("button", { name: "+ Adicionar recurso" }));
    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });
});
