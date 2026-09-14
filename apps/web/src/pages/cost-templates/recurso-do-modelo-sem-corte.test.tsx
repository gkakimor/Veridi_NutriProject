import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  CostTemplateDTO,
  CostTemplateResourceUsageDTO,
  CostTemplateVersionDTO,
  IndustrialResourceDTO,
  IndustrialResourceType,
} from "@veridi/shared";

/**
 * Modelo de Estrutura de Custo — recurso da linha e recurso de energia sem
 * corte (SELECTOR-CUTOFF-WAVE-02).
 *
 * A tela pedia os 100 primeiros recursos, que o servidor ordena por tipo e
 * código com energia por último, e os punha num `<select>`. Três defeitos
 * saíam daí: o recurso 101 em diante não era escolhível; a energia era a
 * primeira a sumir; e o tipo da linha gravada saía da mesma lista — fora dela a
 * linha perdia "Quantidade de recursos" e o próximo "Salvar rascunho" gravava 1
 * no lugar do número. Agora: primeira página de 20, busca no servidor com o
 * mesmo universo (todos os tipos, inativos incluídos; só energia no campo de
 * energia), tipo da linha gravada lido do template e a tarifa gravada fora da
 * página resolvida pelo id, uma vez.
 */

const getCostTemplate = vi.fn();
const updateCostTemplateVersion = vi.fn();

vi.mock("../../lib/cost-pricing-templates-api", () => ({
  getCostTemplate: (...a: unknown[]) => getCostTemplate(...a),
  updateCostTemplate: vi.fn(),
  updateCostTemplateVersion: (...a: unknown[]) => updateCostTemplateVersion(...a),
  setCostTemplateArchived: vi.fn(),
  activateCostTemplateVersion: vi.fn(),
  createCostTemplateVersionFrom: vi.fn(),
  compareCostTemplateVersions: vi.fn(),
}));

vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: vi.fn(),
  getIndustrialResource: vi.fn(),
}));

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...real, useNavigate: () => vi.fn(), useParams: () => ({ templateId: "tec-1" }) };
});

import { getIndustrialResource, listIndustrialResources } from "../../lib/industrial-resources-api";
import { CostTemplateDetailPage } from "./CostTemplateDetailPage";

const PAGINA = 20;

function recurso(
  numero: number,
  type: IndustrialResourceType,
  extra: Partial<IndustrialResourceDTO> = {},
): IndustrialResourceDTO {
  return {
    id: `rin-${numero}`,
    code: `RIN-${String(numero).padStart(6, "0")}`,
    name: `Recurso de Volume ${String(numero).padStart(4, "0")}`,
    type,
    description: null,
    defaultUsageUom: type === "ENERGY" ? "KWH" : "HOUR",
    powerKw: null,
    notes: null,
    active: true,
    ...extra,
  } as IndustrialResourceDTO;
}

const faixa = (de: number, ate: number, type: IndustrialResourceType) =>
  Array.from({ length: ate - de + 1 }, (_, indice) => recurso(de + indice, type));

const ALVO = recurso(901, "EQUIPMENT", { name: "Encapsuladora Zeta Alvo" });
const INATIVO = recurso(902, "LABOR", { name: "Operador Zeta Inativo", active: false });
const TARIFA_ALVO = recurso(990, "ENERGY", { name: "Energia Zeta Tarifa Alvo" });
const UNIVERSO = [
  ...faixa(1, 60, "LABOR"),
  ...faixa(61, 110, "EQUIPMENT"),
  ...faixa(201, 224, "ENERGY"),
  ALVO,
  INATIVO,
  TARIFA_ALVO,
];

/** A ordem do servidor: tipo na ordem do enum, depois código. */
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

function uso(registro: IndustrialResourceDTO, extra: Partial<CostTemplateResourceUsageDTO> = {}) {
  return {
    id: `uso-${registro.id}`,
    industrialResourceId: registro.id,
    resourceCode: registro.code,
    resourceName: registro.name,
    resourceType: registro.type,
    usageBasis: "FIXED_PER_REFERENCE_BATCH",
    usageQuantity: "2",
    usageUom: "HOUR",
    resourceCount: 1,
    totalUsageQuantity: "2",
    notes: null,
    sortOrder: 0,
    ...extra,
  } as CostTemplateResourceUsageDTO;
}

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
    resourceUsages: [],
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

function modelo(draft: CostTemplateVersionDTO | null, ativa: CostTemplateVersionDTO | null = null): CostTemplateDTO {
  return {
    id: "tec-1",
    code: "TEC-000004",
    name: "Cápsulas — Linha padrão",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: ativa,
    draftVersion: draft,
    versions: [ativa, draft].filter((versao): versao is CostTemplateVersionDTO => versao !== null),
    createdAt: "2026-07-01T12:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-08-01T12:00:00.000Z",
  };
}

async function abrir(dto: CostTemplateDTO) {
  getCostTemplate.mockResolvedValue(dto);
  render(
    <MemoryRouter>
      <CostTemplateDetailPage />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: /TEC-000004/ });
}

const campoDaLinha = () => screen.getAllByRole("combobox", { name: "Recurso industrial" }).at(-1)!;
const campoDeEnergia = () => screen.getByRole("combobox", { name: "Recurso de energia" });
const opcaoDe = (codigo: string) => ({ name: new RegExp(`^${codigo}`) });
const rotulo = (registro: IndustrialResourceDTO) => `${registro.code} · ${registro.name}`;
const consultas = () => vi.mocked(listIndustrialResources).mock.calls.map(([params]) => params);
const consultasDeEnergia = () => consultas().filter((params) => params.type === "ENERGY");
const consultasDasLinhas = () => consultas().filter((params) => params.type === undefined);

async function buscarNoCampo(campo: HTMLElement, termo: string, esperada: Consulta) {
  fireEvent.focus(campo);
  fireEvent.change(campo, { target: { value: termo } });
  await waitFor(() => expect(listIndustrialResources).toHaveBeenCalledWith(esperada));
}

/** Nenhuma pergunta passa da página do seletor. */
function perguntasCurtas() {
  for (const params of consultas()) expect(params.pageSize ?? 20).toBeLessThanOrEqual(PAGINA);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listIndustrialResources).mockImplementation(async (params) => servidor(params));
  vi.mocked(getIndustrialResource).mockImplementation(async (id) => {
    const achado = UNIVERSO.find((registro) => registro.id === id);
    if (!achado) throw new Error("Recurso não encontrado");
    return { ...achado, rates: [] };
  });
  updateCostTemplateVersion.mockResolvedValue(rascunho());
});

describe("o universo do teste reproduz o corte de antes", () => {
  it("os 100 primeiros não alcançavam o recurso #112 nem energia nenhuma", () => {
    const antigos = servidor({ pageSize: 100 }).resources;
    expect(antigos).toHaveLength(100);
    expect(antigos.some((registro) => registro.id === ALVO.id)).toBe(false);
    expect(antigos.some((registro) => registro.type === "ENERGY")).toBe(false);
    // E a tarifa alvo não está nem na primeira página só de energia.
    expect(servidor({ type: "ENERGY", pageSize: PAGINA }).resources.some((r) => r.id === TARIFA_ALVO.id)).toBe(false);
  });
});

describe("Linha do Modelo — busca no servidor", () => {
  it("abre com a primeira página — 20 — e o resto se alcança buscando", async () => {
    await abrir(modelo(rascunho()));
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar recurso" }));

    fireEvent.focus(campoDaLinha());
    const lista = await screen.findByRole("listbox");
    await waitFor(() => expect(within(lista).getAllByRole("option")).toHaveLength(PAGINA));
    expect(within(lista).queryByRole("option", opcaoDe(ALVO.code))).toBeNull();
    expect(within(lista).getByText("Digite para buscar em todo o catálogo.")).toBeInTheDocument();
    expect(consultas()).toEqual([{ pageSize: PAGINA }]);
  });

  it("#112 achado pelo código, escolhido, conta recursos e grava a quantidade digitada", async () => {
    await abrir(modelo(rascunho()));
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar recurso" }));

    await buscarNoCampo(campoDaLinha(), ALVO.code, { search: ALVO.code, pageSize: PAGINA });
    fireEvent.mouseDown(await screen.findByRole("option", opcaoDe(ALVO.code)));
    await waitFor(() => expect(campoDaLinha()).toHaveValue(rotulo(ALVO)));
    fireEvent.keyDown(campoDaLinha(), { key: "Escape" });

    // Equipamento se conta: o campo aparece porque o tipo veio da busca.
    const linha = campoDaLinha().closest("tr")!;
    fireEvent.change(within(linha).getByLabelText("Quantidade de recursos"), { target: { value: "3" } });
    fireEvent.change(linha.querySelector('input[inputmode="decimal"]')!, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    await waitFor(() => expect(updateCostTemplateVersion).toHaveBeenCalledTimes(1));
    expect(updateCostTemplateVersion.mock.calls[0]![1].resourceUsages).toEqual([
      { industrialResourceId: ALVO.id, usageQuantity: "4", usageUom: "HOUR", resourceCount: 3 },
    ]);
    perguntasCurtas();
  });

  it("universo preservado: a busca da linha segue incluindo inativo e todos os tipos", async () => {
    await abrir(modelo(rascunho()));
    fireEvent.click(screen.getByRole("button", { name: "+ Adicionar recurso" }));

    await buscarNoCampo(campoDaLinha(), "Zeta", { search: "Zeta", pageSize: PAGINA });
    const inativo = await screen.findByRole("option", opcaoDe(INATIVO.code));
    expect(inativo).toHaveTextContent("Mão de obra, inativo");
    expect(screen.getByRole("option", opcaoDe(ALVO.code))).toHaveTextContent("Equipamento");
    expect(screen.getByRole("option", opcaoDe(TARIFA_ALVO.code))).toBeInTheDocument();
    for (const params of consultasDasLinhas()) expect(params.active).toBeUndefined();
  });
});

describe("Linha gravada fora da primeira página — o tipo vem do template", () => {
  it("linha do #112 com 3 recursos: nome e quantidade na tela, e salvar outra alteração grava 3", async () => {
    await abrir(
      modelo(rascunho({ resourceUsages: [uso(ALVO, { resourceCount: 3, totalUsageQuantity: "6" })] })),
    );

    await waitFor(() => expect(campoDaLinha()).toHaveValue(rotulo(ALVO)));
    expect(screen.getByLabelText("Quantidade de recursos")).toHaveValue("3");

    fireEvent.change(screen.getByLabelText("Base de produção"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    await waitFor(() => expect(updateCostTemplateVersion).toHaveBeenCalledTimes(1));
    const enviado = updateCostTemplateVersion.mock.calls[0]![1];
    expect(enviado.referenceOutputQuantity).toBe("2000");
    expect(enviado.resourceUsages).toEqual([
      expect.objectContaining({ industrialResourceId: ALVO.id, usageQuantity: "2", resourceCount: 3 }),
    ]);
    // O nome e o tipo vieram do template: nenhuma pergunta pelo id nem busca.
    expect(getIndustrialResource).not.toHaveBeenCalled();
    for (const params of consultas()) expect(params.search).toBeUndefined();
  });
});

describe("Recurso de energia — energia derivada dos equipamentos", () => {
  it("abre só com energia e acha pela busca a tarifa fora da primeira página; o rascunho grava a escolhida", async () => {
    await abrir(modelo(rascunho({ energyCalculationMode: "FROM_EQUIPMENT" })));

    fireEvent.focus(campoDeEnergia());
    const lista = await screen.findByRole("listbox");
    await waitFor(() => expect(within(lista).getAllByRole("option")).toHaveLength(PAGINA));
    for (const opcao of within(lista).getAllByRole("option")) expect(opcao).toHaveTextContent(/RIN-0002/);
    fireEvent.keyDown(campoDeEnergia(), { key: "Escape" });

    await buscarNoCampo(campoDeEnergia(), "Zeta", { type: "ENERGY", search: "Zeta", pageSize: PAGINA });
    expect(await screen.findByRole("option", opcaoDe(TARIFA_ALVO.code))).toBeInTheDocument();
    // Filtro de domínio: equipamento que casa com a busca não é tarifa de energia.
    expect(screen.queryByRole("option", opcaoDe(ALVO.code))).toBeNull();
    fireEvent.mouseDown(screen.getByRole("option", opcaoDe(TARIFA_ALVO.code)));
    await waitFor(() => expect(campoDeEnergia()).toHaveValue(rotulo(TARIFA_ALVO)));

    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(updateCostTemplateVersion).toHaveBeenCalledTimes(1));
    expect(updateCostTemplateVersion.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ energyCalculationMode: "FROM_EQUIPMENT", energyResourceId: TARIFA_ALVO.id }),
    );
    for (const params of consultasDeEnergia()) expect(params.active).toBeUndefined();
    perguntasCurtas();
  });

  it("tarifa gravada fora da primeira página volta pelo id — uma pergunta só, depois da página", async () => {
    await abrir(
      modelo(
        rascunho({
          energyCalculationMode: "FROM_EQUIPMENT",
          energyResourceId: TARIFA_ALVO.id,
          energyResourceName: TARIFA_ALVO.name,
        }),
      ),
    );

    await waitFor(() => expect(campoDeEnergia()).toHaveValue(rotulo(TARIFA_ALVO)));
    fireEvent.change(screen.getByLabelText("Base de produção"), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText("Base de produção"), { target: { value: "1800" } });

    expect(getIndustrialResource).toHaveBeenCalledTimes(1);
    expect(getIndustrialResource).toHaveBeenCalledWith(TARIFA_ALVO.id);
    expect(consultasDeEnergia()).toEqual([{ type: "ENERGY", pageSize: PAGINA }]);
  });

  it("fora do modo derivado nada de energia é pedido", async () => {
    await abrir(modelo(rascunho({ energyCalculationMode: "NONE" })));
    await waitFor(() => expect(consultasDasLinhas()).toHaveLength(1));
    expect(consultasDeEnergia()).toHaveLength(0);
    expect(getIndustrialResource).not.toHaveBeenCalled();
  });
});

describe("pedidos", () => {
  it("template sem rascunho não pede catálogo de recurso nenhum", async () => {
    const ativa = rascunho({ id: "tecv-2", status: "ACTIVE", resourceUsages: [uso(ALVO)] });
    await abrir(modelo(null, ativa));
    expect(screen.getByText(ALVO.name)).toBeInTheDocument();
    expect(listIndustrialResources).not.toHaveBeenCalled();
    expect(getIndustrialResource).not.toHaveBeenCalled();
  });
});

describe("guarda estrutural", () => {
  it("a tela não carrega catálogo de recurso com teto num select", () => {
    const fonte = readFileSync(
      join(process.cwd(), "src", "pages", "cost-templates", "CostTemplateDetailPage.tsx"),
      "utf8",
    );
    expect(fonte).not.toMatch(/listIndustrialResources\(/);
    expect(fonte).not.toMatch(/pageSize:\s*\d{3,}/);
    expect(fonte).toMatch(/onSearch=\{buscarRecursoDaLinha\}/);
    expect(fonte).toMatch(/onSearch=\{buscarRecursoDeEnergia\}/);
  });
});
