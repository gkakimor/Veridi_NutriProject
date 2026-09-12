import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type {
  IndustrialCostVersionDTO,
  IndustrialResourceDTO,
  ProductIndustrialCostResponse,
} from "@veridi/shared";

/**
 * UNSAVED-CHANGES-WAVE-04 na Estrutura de Custo.
 *
 * Três blocos gravam separado aqui — base de produção, premissa e recurso —,
 * cada um com o seu botão. A guarda é a SOMA do que continua pendente: salvar
 * um bloco não absolve o outro, e o que a tela calcula (custo, energia
 * derivada, totais) nunca entra na conta.
 */

const getProductIndustrialCosts = vi.fn();
const updateIndustrialCostVersion = vi.fn();
const createIndustrialCostLine = vi.fn();
vi.mock("../../lib/industrial-costs-api", () => ({
  getProductIndustrialCosts: (...a: unknown[]) => getProductIndustrialCosts(...a),
  updateIndustrialCostVersion: (...a: unknown[]) => updateIndustrialCostVersion(...a),
  createIndustrialCostLine: (...a: unknown[]) => createIndustrialCostLine(...a),
  createIndustrialCostVersion: vi.fn(),
  deleteIndustrialCostLine: vi.fn(),
  createResourceUsage: vi.fn(),
  deleteResourceUsage: vi.fn(),
  updateEnergyMode: vi.fn(),
  activateIndustrialCostVersion: vi.fn(),
}));

const listIndustrialResources = vi.fn();
vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: (...a: unknown[]) => listIndustrialResources(...a),
}));
vi.mock("../../lib/cost-pricing-templates-api", () => ({
  applyCostTemplateToProduct: vi.fn(),
}));
vi.mock("./CostCalculationSection", () => ({ CostCalculationSection: () => null }));
vi.mock("../cost-templates/UseCostTemplateDialog", () => ({ UseCostTemplateDialog: () => null }));
vi.mock("../cost-templates/CostTemplateOrigin", () => ({ CostTemplateOrigin: () => null }));
vi.mock("../../components/ProductRelatedLinks", () => ({ ProductRelatedLinks: () => null }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

import { IndustrialCostPage } from "./IndustrialCostPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

function recurso(): IndustrialResourceDTO {
  return {
    id: "rin-1",
    code: "RIN-000001",
    name: "Mão de obra — Produção",
    type: "LABOR",
    description: null,
    defaultUsageUom: "HOUR",
    powerKw: null,
    capacityQuantity: null,
    notes: null,
    active: true,
    currentRate: null,
    rateCount: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdByName: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    updatedByName: null,
  };
}

function versao(): IndustrialCostVersionDTO {
  return {
    id: "ec-1",
    code: "EC-000001",
    productId: "prod-1",
    productCode: "PR-000001",
    productName: "Produto",
    customerName: null,
    versionNumber: 1,
    label: "EC-000001 · V1",
    status: "DRAFT",
    formulationVersionId: "fv-1",
    formulationVersionNumber: 1,
    formulationStatus: "ACTIVE",
    formulationPinned: false,
    originCostTemplateVersionId: null,
    originCostTemplateCode: null,
    originCostTemplateVersionNumber: null,
    originCostTemplateName: null,
    activeFormulationVersionNumber: 1,
    referenceOutputQuantity: "1000",
    referenceOutputUomCode: "un",
    unitsPerShippingBox: null,
    notes: null,
    materials: [],
    lines: [],
    resourceUsages: [],
    energyCalculationMode: "NONE",
    energyResourceId: null,
    energyResourceName: null,
    derivedEnergyKwh: null,
    complete: false,
    pendencies: [],
    createdAt: "2026-09-11T12:00:00.000Z",
    createdByName: "Admin",
    activatedAt: null,
    activatedByName: null,
    customerCodeSnapshot: null,
    customerNameSnapshot: null,
    productCodeSnapshot: null,
    productNameSnapshot: null,
  };
}

function estrutura(): ProductIndustrialCostResponse {
  const rascunho = versao();
  return {
    productId: "prod-1",
    productCode: "PR-000001",
    productName: "Produto",
    suggestedReferenceOutputQuantity: "1000",
    referenceOutputUomCode: "un",
    activeFormulationVersionId: "fv-1",
    activeFormulationVersionNumber: 1,
    versions: [
      {
        id: rascunho.id,
        code: rascunho.code,
        versionNumber: 1,
        label: rascunho.label,
        status: "DRAFT",
        formulationVersionNumber: 1,
        referenceOutputQuantity: "1000",
        referenceOutputUomCode: "un",
        complete: false,
        activatedAt: null,
      },
    ],
    current: null,
    draft: rascunho,
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
        <Route path="/gestao/custos-industriais/:productId" element={<IndustrialCostPage />} />
        <Route path="/comercial/pedidos" element={<h1>Pedidos</h1>} />
      </Route>,
    ),
    // Duas entradas: há para onde o "voltar" do navegador ir.
    { initialEntries: ["/comercial/pedidos", "/gestao/custos-industriais/prod-1"], initialIndex: 1 },
  );
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByLabelText("Base de produção (un)")).toBeInTheDocument());
  return router;
}

const base = () => screen.getByLabelText("Base de produção (un)");
const descricao = () => screen.getByLabelText("Descrição");
const menuPedidos = () => screen.getByRole("link", { name: "Pedidos" });
const pergunta = () => screen.queryByText("Sair sem salvar?");

beforeEach(() => {
  vi.clearAllMocks();
  getProductIndustrialCosts.mockResolvedValue(estrutura());
  listIndustrialResources.mockResolvedValue({
    resources: [recurso()],
    page: 1,
    pageSize: 50,
    total: 1,
  });
});

describe("Estrutura de Custo — guarda de alterações não salvas", () => {
  it("estrutura carregada e não tocada sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("alterar a base de produção pergunta antes de sair", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(base(), { target: { value: "500" } });
    await user.click(menuPedidos());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas nesta estrutura de custos/i)).toBeInTheDocument();
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

  it("premissa meio digitada pergunta, e voltar atrás limpa", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(descricao(), { target: { value: "Frete da embalagem" } });
    await user.click(menuPedidos());
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    fireEvent.change(descricao(), { target: { value: "" } });
    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
  });

  it("salvar a premissa não absolve a base ainda alterada", async () => {
    const user = userEvent.setup();
    await abrir();

    // Bloco A: a base. Bloco B: a premissa.
    fireEvent.change(base(), { target: { value: "500" } });
    fireEvent.change(descricao(), { target: { value: "Frete da embalagem" } });

    createIndustrialCostLine.mockResolvedValue(versao());
    await user.click(screen.getByRole("button", { name: "Adicionar premissa" }));
    await waitFor(() => expect(createIndustrialCostLine).toHaveBeenCalled());
    // A premissa saiu do campo; a base digitada continua na tela.
    await waitFor(() => expect(descricao()).toHaveValue(""));
    expect(base()).toHaveValue("500");

    await user.click(menuPedidos());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("voltar pelo navegador com alteração pendente também pergunta", async () => {
    const router = await abrir();

    fireEvent.change(base(), { target: { value: "500" } });
    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("salvar a base fecha a pendência e sair não pergunta mais", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(base(), { target: { value: "500" } });

    const salva = estrutura();
    salva.draft = { ...versao(), referenceOutputQuantity: "500" };
    updateIndustrialCostVersion.mockResolvedValue(salva.draft);
    getProductIndustrialCosts.mockResolvedValue(salva);
    await user.click(screen.getByRole("button", { name: "Salvar base" }));
    await waitFor(() => expect(updateIndustrialCostVersion).toHaveBeenCalled());

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });
});
