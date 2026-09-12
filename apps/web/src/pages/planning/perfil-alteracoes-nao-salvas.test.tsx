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
import type {
  IndustrialResourceDTO,
  ProductionProfileDTO,
  ProductionProfileVersionDTO,
} from "@veridi/shared";

/**
 * UNSAVED-CHANGES-FOUNDATION-01 no Roteiro de Produção.
 *
 * A tela já compara a assinatura do rascunho com a do que está gravado — é
 * dela que sai o aviso "Alterações não salvas". A guarda de saída usa a MESMA
 * assinatura: perfil aberto e não tocado sai calado; base, unidade, etapa,
 * recurso ou tempo alterados perguntam.
 */

const getProductionProfile = vi.fn();
vi.mock("../../lib/production-profiles-api", () => ({
  getProductionProfile: (...a: unknown[]) => getProductionProfile(...a),
  updateProductionProfile: vi.fn(),
  updateProductionProfileVersion: vi.fn(),
  activateProductionProfileVersion: vi.fn(),
  createProductionProfileVersionFrom: vi.fn(),
  setProductProductionProfile: vi.fn(),
}));

const listIndustrialResources = vi.fn();
vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: (...a: unknown[]) => listIndustrialResources(...a),
}));
vi.mock("../../lib/units-api", () => ({
  listUnits: () =>
    Promise.resolve([
      { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
      { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    ]),
}));
vi.mock("../../lib/products-api", () => ({
  listProducts: () => Promise.resolve({ products: [], page: 1, pageSize: 20, total: 0 }),
}));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

import { ProductionProfileDetailPage } from "./ProductionProfileDetailPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

function recurso(id: string, name: string): IndustrialResourceDTO {
  return {
    id,
    code: `RIN-${id}`,
    name,
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

function versao(): ProductionProfileVersionDTO {
  return {
    id: "ppv-1",
    productionProfileId: "ppr-1",
    profileCode: "PPR-000001",
    profileName: "Cápsulas — linha padrão",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    referenceQuantity: "1000",
    referenceUomCode: "un",
    notes: null,
    steps: [
      {
        id: "st-1",
        sequence: 1,
        name: "Mistura",
        description: null,
        setupDurationMinutes: 0,
        runDurationMinutes: 120,
        scalingMode: "PROPORTIONAL",
        resources: [],
      },
    ],
    createdAt: "2026-09-11T12:00:00.000Z",
    createdBy: "Admin",
    activatedAt: null,
    activatedBy: null,
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
  };
}

function perfil(): ProductionProfileDTO {
  const rascunho = versao();
  return {
    id: "ppr-1",
    code: "PPR-000001",
    name: "Cápsulas — linha padrão",
    description: null,
    activeVersion: null,
    draftVersion: rascunho,
    versions: [rascunho],
    defaultProducts: [],
    createdAt: "2026-09-11T12:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-09-11T12:00:00.000Z",
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
  getProductionProfile.mockResolvedValue(perfil());
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route
          path="/planejamento/perfis-producao/:profileId"
          element={<ProductionProfileDetailPage />}
        />
        <Route path="/comercial/pedidos" element={<h1>Pedidos</h1>} />
      </Route>,
    ),
    { initialEntries: ["/planejamento/perfis-producao/ppr-1"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: /PPR-000001/ });
  await waitFor(() => expect(screen.getByLabelText("Quantidade de referência")).toBeInTheDocument());
}

const pergunta = () => screen.queryByRole("alertdialog");
const menuPedidos = () => screen.getByRole("link", { name: "Pedidos" });

beforeEach(() => {
  vi.clearAllMocks();
  listIndustrialResources.mockResolvedValue({
    resources: [recurso("op", "Mão de obra — Produção")],
    page: 1,
    pageSize: 100,
    total: 1,
  });
});

describe("Roteiro de Produção — guarda de alterações não salvas", () => {
  it("roteiro carregado e não tocado sai sem perguntar", async () => {
    const user = userEvent.setup();
    await abrir();

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("alterar a quantidade de referência pergunta antes de sair", async () => {
    const user = userEvent.setup();
    await abrir();

    fireEvent.change(screen.getByLabelText("Quantidade de referência"), { target: { value: "500" } });
    await user.click(menuPedidos());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(
      screen.getByText(/alterações não salvas neste roteiro de produção/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("alterar o tempo de uma etapa também pergunta", async () => {
    const user = userEvent.setup();
    await abrir();

    // PROPORTIONAL: o rótulo é "Execução da base (min)".
    fireEvent.change(screen.getByLabelText("Execução da base (min)"), {
      target: { value: "150" },
    });
    await user.click(menuPedidos());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });
});
