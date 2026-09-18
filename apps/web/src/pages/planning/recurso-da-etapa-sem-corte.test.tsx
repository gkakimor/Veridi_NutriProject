import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  IndustrialResourceDTO,
  IndustrialResourceType,
  IndustrialResourceListResponse,
  ProductionProfileDTO,
  ProductionProfileStepDTO,
  ProductionProfileVersionDTO,
} from "@veridi/shared";

/**
 * Roteiro de Produção — recurso da etapa sem corte (SELECTOR-CUTOFF-WAVE-02).
 *
 * A etapa oferecia os 100 primeiros recursos ativos num `<select>`, filtrando
 * mão de obra e equipamento no navegador: do 101º em diante o recurso existia,
 * o servidor aceitaria a etapa, e o campo não o oferecia. Agora: primeira
 * página de 20 por tipo de capacidade, busca no servidor com o mesmo recorte
 * (mão de obra e equipamento, só ativos) e recurso gravado lido do próprio
 * roteiro. A resolução pelo id do escolhido que chega de fora é da foundation
 * (`recursos-do-seletor.test.tsx`).
 */

const getProductionProfile = vi.fn();
const updateProductionProfileVersion = vi.fn();

vi.mock("../../lib/production-profiles-api", () => ({
  listProductionProfiles: vi.fn(),
  getProductionProfile: (...a: unknown[]) => getProductionProfile(...a),
  createProductionProfile: vi.fn(),
  updateProductionProfile: vi.fn(),
  updateProductionProfileVersion: (...a: unknown[]) => updateProductionProfileVersion(...a),
  activateProductionProfileVersion: vi.fn(),
  createProductionProfileVersionFrom: vi.fn(),
  setProductProductionProfile: vi.fn(),
}));

vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: vi.fn(),
  getIndustrialResource: vi.fn(),
}));

vi.mock("../../lib/units-api", () => ({
  listUnits: () => Promise.resolve([{ code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" }]),
}));

vi.mock("../../lib/products-api", () => ({
  listProducts: () => Promise.resolve({ products: [], page: 1, pageSize: 20, total: 0 }),
}));

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

vi.mock("react-router-dom", async () => {
  const real = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...real, useNavigate: () => vi.fn(), useParams: () => ({ profileId: "ppr-1" }) };
});

import { getIndustrialResource, listIndustrialResources } from "../../lib/industrial-resources-api";
import { ProductionProfileDetailPage } from "./ProductionProfileDetailPage";

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
    capacityQuantity: null,
    notes: null,
    active: true,
    ...extra,
  } as IndustrialResourceDTO;
}

const faixa = (de: number, ate: number, type: IndustrialResourceType) =>
  Array.from({ length: ate - de + 1 }, (_, indice) => recurso(de + indice, type));

const ALVO = recurso(901, "EQUIPMENT", { name: "Encapsuladora Zeta Alvo" });
const INATIVO = recurso(902, "EQUIPMENT", { name: "Misturador Zeta Inativo", active: false });
const ENERGIA = recurso(903, "ENERGY", { name: "Energia Zeta" });
const UNIVERSO = [...faixa(1, 70, "LABOR"), ...faixa(71, 120, "EQUIPMENT"), ALVO, INATIVO, ENERGIA];

const ORDEM_DO_TIPO: Record<IndustrialResourceType, number> = { LABOR: 0, EQUIPMENT: 1, ENERGY: 2 };

type Consulta = Parameters<typeof listIndustrialResources>[0];

function servidor(params: Consulta = {}): IndustrialResourceListResponse {
  const termo = params.search?.toLowerCase();
  const linhas = UNIVERSO.filter((registro) => !params.type || registro.type === params.type)
    .filter((registro) => params.active === undefined || registro.active === params.active)
    .filter((registro) => !termo || `${registro.code} ${registro.name}`.toLowerCase().includes(termo))
    .sort((a, b) => ORDEM_DO_TIPO[a.type] - ORDEM_DO_TIPO[b.type] || a.code.localeCompare(b.code));
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  return { resources: linhas.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: linhas.length };
}

function passo(sobre: Partial<ProductionProfileStepDTO> = {}): ProductionProfileStepDTO {
  return {
    id: "st-1",
    sequence: 1,
    name: "Encapsulamento",
    description: null,
    setupDurationMinutes: 0,
    runDurationMinutes: 120,
    scalingMode: "PROPORTIONAL",
    resources: [],
    ...sobre,
  };
}

function versao(sobre: Partial<ProductionProfileVersionDTO> = {}): ProductionProfileVersionDTO {
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
    steps: [passo()],
    createdAt: "2026-09-11T12:00:00.000Z",
    createdBy: "Admin",
    activatedAt: null,
    activatedBy: null,
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    profileArchived: false,
    ...sobre,
  };
}

function perfil(rascunho: ProductionProfileVersionDTO): ProductionProfileDTO {
  return {
    id: "ppr-1",
    code: "PPR-000001",
    name: "Cápsulas — linha padrão",
    description: null,
    archived: false,
    archivedAt: null,
    archivedBy: null,
    activeVersion: null,
    draftVersion: rascunho,
    versions: [rascunho],
    defaultProducts: [],
    createdAt: "2026-09-11T12:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-09-11T12:00:00.000Z",
  } as ProductionProfileDTO;
}

async function abrir(dto: ProductionProfileDTO) {
  getProductionProfile.mockResolvedValue(dto);
  render(
    <MemoryRouter>
      <ProductionProfileDetailPage />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: /PPR-000001/ });
}

const campo = () => screen.getAllByRole("combobox", { name: "Recurso" }).at(-1)!;
const opcaoDe = (codigo: string) => ({ name: new RegExp(`^${codigo}`) });
const rotuloDoAlvo = `${ALVO.code} · ${ALVO.name}`;
const consultas = () => vi.mocked(listIndustrialResources).mock.calls.map(([params]) => params);
const simulacao = () => screen.getAllByRole("region", { name: "Simulação do roteiro" })[0]!;

/** Toda pergunta: página curta, só ativos, só mão de obra ou equipamento. */
function perguntasNoRecorte() {
  expect(consultas().length).toBeGreaterThan(0);
  for (const params of consultas()) {
    expect(params.pageSize).toBe(PAGINA);
    expect(params.active).toBe(true);
    expect(["LABOR", "EQUIPMENT"]).toContain(params.type);
  }
}

async function adicionarLinha() {
  fireEvent.click(await screen.findByRole("button", { name: "+ Adicionar recurso" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listIndustrialResources).mockImplementation(async (params) => servidor(params));
  vi.mocked(getIndustrialResource).mockImplementation(async (id) => {
    const achado = UNIVERSO.find((registro) => registro.id === id);
    if (!achado) throw new Error("Recurso não encontrado");
    return { ...achado, rates: [] };
  });
  updateProductionProfileVersion.mockResolvedValue(versao());
});

describe("o universo do teste reproduz o corte de antes", () => {
  it("os 100 primeiros ativos não alcançavam o equipamento #121", () => {
    const antigos = servidor({ pageSize: 100, active: true }).resources;
    expect(antigos).toHaveLength(100);
    expect(antigos.some((registro) => registro.id === ALVO.id)).toBe(false);
  });
});

describe("Recurso da etapa — busca no servidor", () => {
  it("abre com a primeira página de cada tipo de capacidade — 20 + 20 — e o resto se alcança buscando", async () => {
    await abrir(perfil(versao()));
    await adicionarLinha();

    fireEvent.focus(campo());
    const lista = await screen.findByRole("listbox");
    await waitFor(() => expect(within(lista).getAllByRole("option")).toHaveLength(2 * PAGINA));
    expect(within(lista).queryByRole("option", opcaoDe(ALVO.code))).toBeNull();
    expect(within(lista).getByText("Digite para buscar em todo o catálogo.")).toBeInTheDocument();
    expect(consultas()).toEqual([
      { active: true, pageSize: PAGINA, type: "LABOR" },
      { active: true, pageSize: PAGINA, type: "EQUIPMENT" },
    ]);
  });

  it("equipamento #121 achado pelo código, escolhido, simulado com nome e gravado na etapa", async () => {
    await abrir(perfil(versao()));
    await adicionarLinha();

    fireEvent.focus(campo());
    fireEvent.change(campo(), { target: { value: ALVO.code } });
    await waitFor(() =>
      expect(listIndustrialResources).toHaveBeenCalledWith({
        active: true,
        search: ALVO.code,
        pageSize: PAGINA,
        type: "EQUIPMENT",
      }),
    );
    fireEvent.mouseDown(await screen.findByRole("option", opcaoDe(ALVO.code)));
    await waitFor(() => expect(campo()).toHaveValue(rotuloDoAlvo));
    fireEvent.keyDown(campo(), { key: "Escape" });

    fireEvent.change(screen.getByLabelText("Quantidade necessária"), { target: { value: "2" } });
    expect(within(simulacao()).getByText(/2 × Encapsuladora Zeta Alvo: 4 h de recurso/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(updateProductionProfileVersion).toHaveBeenCalledTimes(1));
    expect(updateProductionProfileVersion.mock.calls[0]![1].steps[0].resources).toEqual([
      { industrialResourceId: ALVO.id, resourceQuantity: 2 },
    ]);
    perguntasNoRecorte();
  });

  it("recorte preservado: inativo e energia não entram, nem quando casam com a busca", async () => {
    await abrir(perfil(versao()));
    await adicionarLinha();

    fireEvent.focus(campo());
    fireEvent.change(campo(), { target: { value: "Zeta" } });
    expect(await screen.findByRole("option", opcaoDe(ALVO.code))).toHaveTextContent("Equipamento");
    expect(screen.queryByRole("option", opcaoDe(INATIVO.code))).toBeNull();
    expect(screen.queryByRole("option", opcaoDe(ENERGIA.code))).toBeNull();
    perguntasNoRecorte();
  });
});

describe("Recurso da etapa — fora da primeira página", () => {
  it("gravado no roteiro: nome vem do próprio roteiro, sem perguntar pelo id", async () => {
    const gravado = {
      id: "sr-alvo",
      industrialResourceId: ALVO.id,
      resourceCode: ALVO.code,
      resourceName: ALVO.name,
      resourceType: "EQUIPMENT" as const,
      resourceActive: true,
      resourceQuantity: 2,
      notes: null,
      sortOrder: 0,
    };
    await abrir(perfil(versao({ steps: [passo({ resources: [gravado] })] })));

    await waitFor(() => expect(campo()).toHaveValue(rotuloDoAlvo));
    fireEvent.change(screen.getByLabelText("Nome da etapa"), { target: { value: "Encapsulamento lento" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));

    await waitFor(() => expect(updateProductionProfileVersion).toHaveBeenCalledTimes(1));
    expect(updateProductionProfileVersion.mock.calls[0]![1].steps[0].resources).toEqual([
      { industrialResourceId: ALVO.id, resourceQuantity: 2 },
    ]);
    expect(getIndustrialResource).not.toHaveBeenCalled();
  });
});

describe("catálogo vazio × catálogo que ainda não chegou", () => {
  it("sem resposta, a tela não diz que não há recurso; com resposta vazia, diz", async () => {
    const pendentes: ((resposta: IndustrialResourceListResponse) => void)[] = [];
    vi.mocked(listIndustrialResources).mockImplementation(
      () =>
        new Promise((resolve) => {
          pendentes.push(resolve);
        }),
    );
    await abrir(perfil(versao()));

    await waitFor(() => expect(listIndustrialResources).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Nenhum recurso de produção cadastrado.")).toBeNull();

    for (const responder of pendentes) responder({ resources: [], page: 1, pageSize: PAGINA, total: 0 });
    expect(await screen.findByText("Nenhum recurso de produção cadastrado.")).toBeInTheDocument();
  });
});

describe("guarda estrutural", () => {
  it("a etapa não carrega catálogo de recurso com teto num select", () => {
    const fonte = readFileSync(
      join(process.cwd(), "src", "pages", "planning", "ProductionProfileDetailPage.tsx"),
      "utf8",
    );
    expect(fonte).not.toMatch(/listIndustrialResources\(/);
    expect(fonte).not.toMatch(/pageSize:\s*\d{3,}/);
    expect(fonte).toMatch(/onSearch=\{buscarRecursoDaEtapa\}/);
  });
});
