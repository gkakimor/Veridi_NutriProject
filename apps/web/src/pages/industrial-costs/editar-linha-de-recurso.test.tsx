import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  IndustrialCostResourceUsageDTO,
  IndustrialCostVersionDTO,
  ProductIndustrialCostResponse,
  UpdateIndustrialCostResourceUsageInput,
} from "@veridi/shared";

/**
 * Estrutura de Custos — editar a linha de recurso na própria linha
 * (COST-RESOURCE-EDIT-01).
 *
 * Trocar o tempo ou a quantidade de recursos era remover e declarar de novo: a
 * linha mudava de id e ia para o fim da lista. Agora "Editar recurso" abre os
 * dois campos na linha, e salvar manda um PATCH da MESMA linha. O servidor
 * falso guarda o estado e recalcula o total como o real (§87), para que a
 * leitura depois de salvar seja a da linha gravada.
 */

const getProductIndustrialCosts = vi.fn();
const updateResourceUsage = vi.fn();
const createResourceUsage = vi.fn();
const deleteResourceUsage = vi.fn();
vi.mock("../../lib/industrial-costs-api", () => ({
  getProductIndustrialCosts: (...a: unknown[]) => getProductIndustrialCosts(...a),
  updateIndustrialCostVersion: vi.fn(),
  createIndustrialCostLine: vi.fn(),
  createIndustrialCostVersion: vi.fn(),
  deleteIndustrialCostLine: vi.fn(),
  createResourceUsage: (...a: unknown[]) => createResourceUsage(...a),
  updateResourceUsage: (...a: unknown[]) => updateResourceUsage(...a),
  deleteResourceUsage: (...a: unknown[]) => deleteResourceUsage(...a),
  updateEnergyMode: vi.fn(),
  activateIndustrialCostVersion: vi.fn(),
}));
vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: vi.fn(async () => ({ resources: [], page: 1, pageSize: 20, total: 0 })),
  getIndustrialResource: vi.fn(),
  createIndustrialResource: vi.fn(),
}));
vi.mock("../../lib/cost-pricing-templates-api", () => ({ applyCostTemplateToProduct: vi.fn() }));
vi.mock("./CostCalculationSection", () => ({ CostCalculationSection: () => null }));
vi.mock("../cost-templates/UseCostTemplateDialog", () => ({ UseCostTemplateDialog: () => null }));
vi.mock("../cost-templates/CostTemplateOrigin", () => ({ CostTemplateOrigin: () => null }));
vi.mock("../../components/ProductRelatedLinks", () => ({ ProductRelatedLinks: () => null }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

import { IndustrialCostPage } from "./IndustrialCostPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

function uso(
  id: string,
  code: string,
  type: "LABOR" | "ENERGY",
  usageQuantity: string,
  resourceCount: number,
): IndustrialCostResourceUsageDTO {
  return {
    id,
    resourceId: `rin-${id}`,
    resourceCode: code,
    resourceName: type === "LABOR" ? "Operador de envase" : "Energia elétrica",
    resourceType: type,
    resourceActive: true,
    usageBasis: "FIXED_PER_REFERENCE_BATCH",
    usageQuantity,
    usageUom: type === "LABOR" ? "HOUR" : "KWH",
    resourceCount,
    totalUsageQuantity: String(Number(usageQuantity) * resourceCount),
    notes: null,
    currentRate: null,
    powerKw: null,
    rateValueSnapshot: null,
    rateCurrencySnapshot: null,
    rateUomSnapshot: null,
    rateEffectiveAtSnapshot: null,
    powerKwSnapshot: null,
    resourceNameSnapshot: null,
    derivedEnergyKwh: null,
  };
}

/** O "banco" do servidor falso: a ordem é a da estrutura, e o PATCH só troca campos. */
let usos: IndustrialCostResourceUsageDTO[] = [];

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
    resourceUsages: usos.map((registro) => ({ ...registro })),
    energyCalculationMode: "DIRECT",
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
      <nav>
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
        <Route path="/produtos/:productId/custos" element={<IndustrialCostPage />} />
        <Route path="/comercial/pedidos" element={<h1>Pedidos</h1>} />
      </Route>,
    ),
    { initialEntries: ["/produtos/prod-1/custos"] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByLabelText("Base de produção (un)");
}

/** As linhas da tabela de recursos, pela ordem em que aparecem. */
const linhasDeRecurso = () =>
  screen.getAllByRole("row").filter((linha) => /RIN-00000\d/.test(linha.textContent ?? ""));
const linhaDe = (codigo: string) => linhasDeRecurso().find((linha) => linha.textContent?.includes(codigo))!;

async function editar(codigo: string) {
  fireEvent.click(screen.getByRole("button", { name: `Mais ações de ${codigo}` }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Editar recurso" }));
}

const tempoDe = (codigo: string) => screen.getByLabelText(new RegExp(`^Tempo por recurso de ${codigo}`));
const recursosDe = (codigo: string) => screen.getByLabelText(`Quantidade de recursos de ${codigo}`);
const salvar = () => fireEvent.click(screen.getByRole("button", { name: "Salvar recurso" }));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  usos = [uso("uso-op", "RIN-000001", "LABOR", "2", 2), uso("uso-en", "RIN-000002", "ENERGY", "50", 1)];
  getProductIndustrialCosts.mockImplementation(async () => estrutura());
  updateResourceUsage.mockImplementation(
    async (id: string, input: UpdateIndustrialCostResourceUsageInput) => {
      usos = usos.map((registro) =>
        registro.id !== id
          ? registro
          : uso(
              registro.id,
              registro.resourceCode,
              registro.resourceType as "LABOR" | "ENERGY",
              input.usageQuantity ?? registro.usageQuantity,
              input.resourceCount ?? registro.resourceCount,
            ),
      );
      return versao();
    },
  );
});

describe("Estrutura de Custos — editar a linha de recurso (COST-RESOURCE-EDIT-01)", () => {
  it("editar a duração: PATCH da mesma linha, sem remover nem criar, e a leitura nova na mesma posição", async () => {
    await abrir();
    expect(linhaDe("RIN-000001").textContent).toContain("2 × 2");

    await editar("RIN-000001");
    expect(tempoDe("RIN-000001")).toHaveValue("2");
    expect(recursosDe("RIN-000001")).toHaveValue("2");
    fireEvent.change(tempoDe("RIN-000001"), { target: { value: "3,5" } });
    salvar();

    await waitFor(() =>
      expect(updateResourceUsage).toHaveBeenCalledWith("uso-op", { usageQuantity: "3.5", resourceCount: 2 }),
    );
    expect(createResourceUsage).not.toHaveBeenCalled();
    expect(deleteResourceUsage).not.toHaveBeenCalled();

    await waitFor(() => expect(linhaDe("RIN-000001").textContent).toContain("2 × 3,5"));
    expect(linhaDe("RIN-000001").textContent).toContain("Total: 7");
    // Nem linha a mais, nem troca de posição.
    expect(linhasDeRecurso().map((linha) => (linha.textContent?.includes("RIN-000001") ? "op" : "en"))).toEqual([
      "op",
      "en",
    ]);
    expect(screen.queryByRole("button", { name: "Salvar recurso" })).toBeNull();
  });

  it("editar a quantidade de recursos: 2 → 3, e de volta a 1", async () => {
    await abrir();

    await editar("RIN-000001");
    fireEvent.change(recursosDe("RIN-000001"), { target: { value: "3" } });
    salvar();
    await waitFor(() =>
      expect(updateResourceUsage).toHaveBeenCalledWith("uso-op", { usageQuantity: "2", resourceCount: 3 }),
    );
    await waitFor(() => expect(linhaDe("RIN-000001").textContent).toContain("3 × 2"));
    expect(linhaDe("RIN-000001").textContent).toContain("Total: 6");

    await editar("RIN-000001");
    expect(recursosDe("RIN-000001")).toHaveValue("3");
    fireEvent.change(recursosDe("RIN-000001"), { target: { value: "1" } });
    salvar();
    await waitFor(() =>
      expect(updateResourceUsage).toHaveBeenLastCalledWith("uso-op", { usageQuantity: "2", resourceCount: 1 }),
    );
    await waitFor(() => expect(linhaDe("RIN-000001").textContent).not.toContain("×"));
    expect(linhaDe("RIN-000001").textContent).not.toContain("Total:");
    expect(updateResourceUsage).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["quantidade de recursos zero", "recursos", "0"],
    ["quantidade de recursos vazia", "recursos", ""],
    ["tempo vazio", "tempo", ""],
  ])("valor inválido não sai da tela: %s", async (_nome, campo, valor) => {
    await abrir();
    await editar("RIN-000001");
    fireEvent.change(campo === "tempo" ? tempoDe("RIN-000001") : recursosDe("RIN-000001"), {
      target: { value: valor },
    });
    salvar();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(updateResourceUsage).not.toHaveBeenCalled();
    // A edição continua aberta para corrigir.
    expect(screen.getByRole("button", { name: "Salvar recurso" })).toBeInTheDocument();
  });

  it("cancelar descarta o que foi digitado e não grava", async () => {
    await abrir();
    await editar("RIN-000001");
    fireEvent.change(recursosDe("RIN-000001"), { target: { value: "5" } });
    fireEvent.click(within(linhaDe("RIN-000001")).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByLabelText("Quantidade de recursos de RIN-000001")).toBeNull();
    expect(linhaDe("RIN-000001").textContent).toContain("2 × 2");
    expect(updateResourceUsage).not.toHaveBeenCalled();

    // Reabrir parte do gravado, não do descartado.
    await editar("RIN-000001");
    expect(recursosDe("RIN-000001")).toHaveValue("2");
  });

  it("salvar sem mudar nada fecha sem gravar", async () => {
    await abrir();
    await editar("RIN-000001");
    salvar();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Salvar recurso" })).toBeNull());
    expect(updateResourceUsage).not.toHaveBeenCalled();
  });

  it("energia: sem quantidade de recursos, e o PATCH leva só o consumo", async () => {
    await abrir();
    await editar("RIN-000002");
    expect(screen.queryByLabelText("Quantidade de recursos de RIN-000002")).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Consumo de RIN-000002/), { target: { value: "60" } });
    salvar();

    await waitFor(() => expect(updateResourceUsage).toHaveBeenCalledWith("uso-en", { usageQuantity: "60" }));
  });

  it("edição alterada e não salva é pendência: sair pergunta", async () => {
    await abrir();
    await editar("RIN-000001");
    fireEvent.change(recursosDe("RIN-000001"), { target: { value: "3" } });

    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Pedidos" }));
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
  });
});
