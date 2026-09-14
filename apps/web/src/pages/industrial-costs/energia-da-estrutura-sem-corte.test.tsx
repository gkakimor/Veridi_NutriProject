import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Outlet, Route, RouterProvider, createMemoryRouter, createRoutesFromElements } from "react-router-dom";
import type {
  IndustrialCostVersionDTO,
  IndustrialResourceDTO,
  IndustrialResourceType,
  ProductIndustrialCostResponse,
} from "@veridi/shared";

/**
 * Estrutura de Custos — tarifa do kWh derivado sem corte (SELECTOR-CUTOFF-WAVE-02).
 *
 * As opções do campo saíam da primeira página de 50 recursos ATIVOS, que o
 * servidor ordena por tipo com energia por último: com 50 recursos de mão de
 * obra e equipamento, "Tarifa que valoriza o kWh derivado" não oferecia energia
 * nenhuma, e a tarifa gravada fora da página aparecia como "Selecione…". Agora:
 * primeira página de 20 só de energia ativa, busca no servidor com o mesmo
 * recorte, e a tarifa gravada que não veio nela resolvida pelo id, uma vez.
 */

const getProductIndustrialCosts = vi.fn();
const updateEnergyMode = vi.fn();
vi.mock("../../lib/industrial-costs-api", () => ({
  getProductIndustrialCosts: (...a: unknown[]) => getProductIndustrialCosts(...a),
  updateIndustrialCostVersion: vi.fn(),
  createIndustrialCostLine: vi.fn(),
  createIndustrialCostVersion: vi.fn(),
  deleteIndustrialCostLine: vi.fn(),
  createResourceUsage: vi.fn(),
  deleteResourceUsage: vi.fn(),
  updateEnergyMode: (...a: unknown[]) => updateEnergyMode(...a),
  activateIndustrialCostVersion: vi.fn(),
}));

vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: vi.fn(),
  getIndustrialResource: vi.fn(),
}));
vi.mock("../../lib/cost-pricing-templates-api", () => ({ applyCostTemplateToProduct: vi.fn() }));
vi.mock("./CostCalculationSection", () => ({ CostCalculationSection: () => null }));
vi.mock("../cost-templates/UseCostTemplateDialog", () => ({ UseCostTemplateDialog: () => null }));
vi.mock("../cost-templates/CostTemplateOrigin", () => ({ CostTemplateOrigin: () => null }));
vi.mock("../../components/ProductRelatedLinks", () => ({ ProductRelatedLinks: () => null }));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

import { getIndustrialResource, listIndustrialResources } from "../../lib/industrial-resources-api";
import { IndustrialCostPage } from "./IndustrialCostPage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

const PAGINA = 20;

function recurso(numero: number, type: IndustrialResourceType, extra: Partial<IndustrialResourceDTO> = {}) {
  return {
    id: `rin-${numero}`,
    code: `RIN-${String(numero).padStart(6, "0")}`,
    name: `Recurso de Volume ${String(numero).padStart(4, "0")}`,
    type,
    description: null,
    defaultUsageUom: type === "ENERGY" ? "KWH" : "HOUR",
    powerKw: null,
    capacityQuantity: null,
    notes: null,
    active: true,
    ...extra,
  } as IndustrialResourceDTO;
}

const faixa = (de: number, ate: number, type: IndustrialResourceType) =>
  Array.from({ length: ate - de + 1 }, (_, indice) => recurso(de + indice, type));

const TARIFA_ALVO = recurso(990, "ENERGY", { name: "Energia Zeta Tarifa Alvo" });
const TARIFA_INATIVA = recurso(991, "ENERGY", { name: "Energia Zeta Tarifa Antiga", active: false });
const EQUIPAMENTO_ZETA = recurso(992, "EQUIPMENT", { name: "Encapsuladora Zeta" });
const UNIVERSO = [
  ...faixa(1, 60, "LABOR"),
  ...faixa(61, 70, "EQUIPMENT"),
  ...faixa(201, 225, "ENERGY"),
  TARIFA_ALVO,
  TARIFA_INATIVA,
  EQUIPAMENTO_ZETA,
];

const ORDEM_DO_TIPO: Record<IndustrialResourceType, number> = { LABOR: 0, EQUIPMENT: 1, ENERGY: 2 };

type Consulta = Parameters<typeof listIndustrialResources>[0];

function servidor(params: Consulta = {}) {
  const termo = params.search?.toLowerCase();
  const linhas = UNIVERSO.filter((registro) => !params.type || registro.type === params.type)
    .filter((registro) => params.active === undefined || registro.active === params.active)
    .filter((registro) => !termo || `${registro.code} ${registro.name}`.toLowerCase().includes(termo))
    .sort((a, b) => ORDEM_DO_TIPO[a.type] - ORDEM_DO_TIPO[b.type] || a.code.localeCompare(b.code));
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  return { resources: linhas.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: linhas.length };
}

function versao(sobre: Partial<IndustrialCostVersionDTO> = {}): IndustrialCostVersionDTO {
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
    energyCalculationMode: "FROM_EQUIPMENT",
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
    ...sobre,
  };
}

function estrutura(rascunho: IndustrialCostVersionDTO): ProductIndustrialCostResponse {
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

async function abrir(rascunho: IndustrialCostVersionDTO) {
  getProductIndustrialCosts.mockResolvedValue(estrutura(rascunho));
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route
        element={
          <UnsavedChangesProvider>
            <Outlet />
          </UnsavedChangesProvider>
        }
      >
        <Route path="/gestao/custos-industriais/:productId" element={<IndustrialCostPage />} />
      </Route>,
    ),
    { initialEntries: ["/gestao/custos-industriais/prod-1"] },
  );
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByLabelText("Base de produção (un)")).toBeInTheDocument());
}

const campo = () => screen.getByRole("combobox", { name: "Tarifa que valoriza o kWh derivado" });
const opcaoDe = (codigo: string) => ({ name: new RegExp(`^${codigo}`) });
const rotuloDaTarifa = `${TARIFA_ALVO.code} · ${TARIFA_ALVO.name}`;
const consultasDeEnergia = () =>
  vi
    .mocked(listIndustrialResources)
    .mock.calls.map(([params]) => params)
    .filter((params) => params.type === "ENERGY");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listIndustrialResources).mockImplementation(async (params) => servidor(params));
  vi.mocked(getIndustrialResource).mockImplementation(async (id) => {
    const achado = UNIVERSO.find((registro) => registro.id === id);
    if (!achado) throw new Error("Recurso não encontrado");
    return { ...achado, rates: [] };
  });
  updateEnergyMode.mockResolvedValue({});
});

describe("o universo do teste reproduz o corte de antes", () => {
  it("os 50 primeiros ativos não traziam energia nenhuma", () => {
    const antigos = servidor({ active: true, pageSize: 50 }).resources;
    expect(antigos).toHaveLength(50);
    expect(antigos.some((registro) => registro.type === "ENERGY")).toBe(false);
  });
});

describe("Tarifa do kWh derivado — busca no servidor", () => {
  it("abre com 20 tarifas de energia ativa; a busca acha a de fora da página e escolher grava", async () => {
    await abrir(versao());

    fireEvent.focus(campo());
    const lista = await screen.findByRole("listbox");
    await waitFor(() => expect(within(lista).getAllByRole("option")).toHaveLength(PAGINA));
    for (const opcao of within(lista).getAllByRole("option")) expect(opcao).toHaveTextContent(/^RIN-0002/);
    expect(consultasDeEnergia()).toEqual([{ active: true, pageSize: PAGINA, type: "ENERGY" }]);

    fireEvent.change(campo(), { target: { value: "Zeta" } });
    await waitFor(() =>
      expect(listIndustrialResources).toHaveBeenCalledWith({
        active: true,
        search: "Zeta",
        pageSize: PAGINA,
        type: "ENERGY",
      }),
    );
    const alvo = await screen.findByRole("option", opcaoDe(TARIFA_ALVO.code));
    // Recorte preservado: nem tarifa inativa nem equipamento que casa com o termo.
    expect(screen.queryByRole("option", opcaoDe(TARIFA_INATIVA.code))).toBeNull();
    expect(screen.queryByRole("option", opcaoDe(EQUIPAMENTO_ZETA.code))).toBeNull();
    fireEvent.mouseDown(alvo);

    await waitFor(() =>
      expect(updateEnergyMode).toHaveBeenCalledWith("ec-1", {
        energyCalculationMode: "FROM_EQUIPMENT",
        energyResourceId: TARIFA_ALVO.id,
      }),
    );
    for (const params of vi.mocked(listIndustrialResources).mock.calls.map(([p]) => p)) {
      expect(params.pageSize).toBeLessThanOrEqual(50);
    }
  });

  it("tarifa gravada fora da página volta pelo id, uma vez; reescolher a mesma não grava", async () => {
    await abrir(versao({ energyResourceId: TARIFA_ALVO.id, energyResourceName: TARIFA_ALVO.name }));

    await waitFor(() => expect(campo()).toHaveValue(rotuloDaTarifa));
    expect(getIndustrialResource).toHaveBeenCalledTimes(1);
    expect(getIndustrialResource).toHaveBeenCalledWith(TARIFA_ALVO.id);

    fireEvent.focus(campo());
    fireEvent.change(campo(), { target: { value: TARIFA_ALVO.code } });
    await waitFor(() =>
      expect(listIndustrialResources).toHaveBeenCalledWith(expect.objectContaining({ search: TARIFA_ALVO.code })),
    );
    fireEvent.mouseDown(await screen.findByRole("option", opcaoDe(TARIFA_ALVO.code)));
    // jsdom: reescolher a mesma opção deixa a lista aberta (o foco devolvido a reabre).
    fireEvent.keyDown(campo(), { key: "Escape" });
    await waitFor(() => expect(campo()).toHaveValue(rotuloDaTarifa));

    expect(updateEnergyMode).not.toHaveBeenCalled();
    expect(getIndustrialResource).toHaveBeenCalledTimes(1);
  });

  it("fora do modo derivado nada de energia é pedido", async () => {
    await abrir(versao({ energyCalculationMode: "NONE" }));
    await waitFor(() => expect(listIndustrialResources).toHaveBeenCalled());
    expect(consultasDeEnergia()).toHaveLength(0);
    expect(getIndustrialResource).not.toHaveBeenCalled();
  });
});

describe("guarda estrutural", () => {
  it("a tarifa não sai mais da primeira página dos recursos da linha", () => {
    const fonte = readFileSync(
      join(process.cwd(), "src", "pages", "industrial-costs", "IndustrialCostPage.tsx"),
      "utf8",
    );
    expect(fonte).not.toMatch(/resources\s*\.filter\(\(resource\) => resource\.type === "ENERGY"\)/);
    expect(fonte).toMatch(/onSearch=\{buscarEnergia\}/);
  });
});
