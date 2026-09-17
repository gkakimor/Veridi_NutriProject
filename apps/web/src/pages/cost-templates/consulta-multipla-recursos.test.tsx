import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type {
  CostTemplateDTO,
  CostTemplateResourceUsageDTO,
  CostTemplateVersionDTO,
  IndustrialResourceDTO,
  IndustrialResourceType,
} from "@veridi/shared";

/**
 * ASSISTED-ENTITY-MULTISELECT-01 — vários recursos de uma vez no Modelo de
 * Estrutura de Custo.
 *
 * "+ Adicionar recursos" abre a consulta com caixas de marcar no universo da
 * linha (todos os tipos, inativos incluídos — o Modelo nunca os filtrou) e cria
 * uma linha por recurso marcado, com os campos da linha prontos para preencher
 * e nenhum default novo. A consulta mostra o que o CADASTRO do recurso sabe
 * para distinguir dois parecidos — tipo, potência, capacidade, unidade de uso,
 * situação — e nada que não exista nele.
 */

const getCostTemplate = vi.fn();

vi.mock("../../lib/cost-pricing-templates-api", () => ({
  getCostTemplate: (...a: unknown[]) => getCostTemplate(...a),
  updateCostTemplate: vi.fn(),
  updateCostTemplateVersion: vi.fn(),
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

function recurso(
  numero: number,
  type: IndustrialResourceType,
  extra: Partial<IndustrialResourceDTO> = {},
): IndustrialResourceDTO {
  return {
    id: `rin-${numero}`,
    code: `RIN-${String(numero).padStart(6, "0")}`,
    name: `Recurso de volume ${numero}`,
    type,
    description: null,
    defaultUsageUom: type === "ENERGY" ? "KWH" : "HOUR",
    powerKw: null,
    notes: null,
    active: true,
    capacityQuantity: null,
    ...extra,
  } as IndustrialResourceDTO;
}

/*
 * Trinta de volume antes: os alvos ficam fora da primeira página do seletor da
 * linha, e é a consulta que os traz. Dois "Operador de encapsulamento" que só a
 * capacidade separa; duas "Encapsuladora" que potência e situação separam.
 */
const OPERADOR_2 = recurso(901, "LABOR", { name: "Operador de encapsulamento", capacityQuantity: 2 });
const OPERADOR_SEM = recurso(902, "LABOR", { name: "Operador de encapsulamento" });
const ENCAPSULADORA = recurso(903, "EQUIPMENT", {
  name: "Encapsuladora",
  powerKw: "1.5",
  capacityQuantity: 1,
  description: "Linha 1",
});
const ENCAPSULADORA_INATIVA = recurso(904, "EQUIPMENT", {
  name: "Encapsuladora",
  capacityQuantity: 3,
  active: false,
});
const ENERGIA = recurso(905, "ENERGY", { name: "Energia de encapsulamento" });
const AUXILIAR = recurso(906, "LABOR", { name: "Auxiliar de encapsulamento", capacityQuantity: 4 });

const UNIVERSO = [
  ...Array.from({ length: 30 }, (_, indice) => recurso(indice + 1, "LABOR")),
  OPERADOR_2,
  OPERADOR_SEM,
  ENCAPSULADORA,
  ENCAPSULADORA_INATIVA,
  ENERGIA,
  AUXILIAR,
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
  return Promise.resolve({
    resources: linhas.slice((page - 1) * pageSize, page * pageSize),
    page,
    pageSize,
    total: linhas.length,
  });
}

function usoDoAuxiliar(): CostTemplateResourceUsageDTO {
  return {
    id: "uso-aux",
    industrialResourceId: AUXILIAR.id,
    resourceCode: AUXILIAR.code,
    resourceName: AUXILIAR.name,
    resourceType: AUXILIAR.type,
    usageBasis: "FIXED_PER_REFERENCE_BATCH",
    usageQuantity: "2",
    usageUom: "HOUR",
    resourceCount: 1,
    totalUsageQuantity: "2",
    notes: null,
    sortOrder: 0,
  } as CostTemplateResourceUsageDTO;
}

function modelo(): CostTemplateDTO {
  const rascunho: CostTemplateVersionDTO = {
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
    resourceUsages: [usoDoAuxiliar()],
    additionalCosts: [],
    createdAt: "2026-09-01T12:00:00.000Z",
    createdBy: "Admin",
    activatedAt: null,
    activatedBy: null,
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    usageCount: 0,
  };
  return {
    id: "tec-1",
    code: "TEC-000004",
    name: "Cápsulas — Linha padrão",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: null,
    draftVersion: rascunho,
    versions: [rascunho],
    createdAt: "2026-07-01T12:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-08-01T12:00:00.000Z",
  };
}

async function abrir() {
  getCostTemplate.mockResolvedValue(modelo());
  render(
    <MemoryRouter>
      <CostTemplateDetailPage />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1, name: /TEC-000004/ });
}

type Usuario = ReturnType<typeof userEvent.setup>;

const caixa = (codigo: string) =>
  screen.getByRole("checkbox", { name: new RegExp(`^Selecionar ${codigo} · `) });
const caixaAchada = (codigo: string) =>
  screen.findByRole("checkbox", { name: new RegExp(`^Selecionar ${codigo} · `) });
const leituraDaLinha = (codigo: string) =>
  Array.from(caixa(codigo).closest("tr")!.querySelectorAll("td"))
    .slice(2)
    .map((celula) => celula.textContent)
    .join(" | ");
const camposDeRecurso = () => screen.getAllByRole("combobox", { name: "Recurso industrial" });

/** Abre a consulta da seção e busca pelos recursos de encapsulamento. */
async function consultarEncapsulamento(user: Usuario) {
  await user.click(screen.getByRole("button", { name: "+ Adicionar recursos" }));
  await screen.findByRole("heading", { name: "Consulta de recursos industriais" });
  await user.type(screen.getByRole("searchbox", { name: "Buscar recursos" }), "encapsul");
  await caixaAchada(OPERADOR_2.code);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listIndustrialResources).mockImplementation(servidor as never);
});

describe("Modelo de Estrutura de Custo — + Adicionar recursos", () => {
  it("abre no universo da linha — todos os tipos, inativos incluídos — com as colunas do cadastro do recurso", async () => {
    const user = userEvent.setup();
    await abrir();
    await consultarEncapsulamento(user);

    expect(screen.getByText("Tipo: todos")).toBeInTheDocument();
    expect(screen.getByText("Situação: ativos e inativos")).toBeInTheDocument();
    const perguntas = vi.mocked(listIndustrialResources).mock.calls.map(([params]) => params);
    expect(perguntas).toContainEqual({ search: "encapsul", page: 1, pageSize: 20 });

    const cabecalhos = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(cabecalhos).toEqual([
      "Marcar",
      "Código",
      "Nome",
      "Tipo",
      "Capacidade",
      "Unidade de uso",
      "Situação",
      "Observação",
    ]);
    // Nada que o recurso não tem, e nada de tarifa.
    for (const alheio of ["Pureza cadastrada", "Fonte / Função", "Subtipo", "Tarifa vigente"]) {
      expect(cabecalhos).not.toContain(alheio);
    }

    expect(leituraDaLinha(ENCAPSULADORA.code)).toBe(
      "EncapsuladoraLinha 1 | EquipamentoPotência: 1,5 kW | 1 | hora | Ativo | ",
    );
    // Energia não ocupa recurso: capacidade não se aplica, e o uso é em kWh.
    expect(leituraDaLinha(ENERGIA.code)).toBe("Energia de encapsulamento | Energia | — | kWh | Ativo | ");
    // Inativo entra no universo do Modelo, marcado como tal e escolhível.
    expect(leituraDaLinha(ENCAPSULADORA_INATIVA.code)).toBe(
      "Encapsuladora | EquipamentoPotência não informada | 3 | hora | Inativo | ",
    );
    expect(caixa(ENCAPSULADORA_INATIVA.code)).toBeEnabled();
  });

  it("recursos de mesmo nome se distinguem pelo que a consulta mostra: capacidade, potência, situação", async () => {
    const user = userEvent.setup();
    await abrir();
    await consultarEncapsulamento(user);

    const operadores = [OPERADOR_2, OPERADOR_SEM].map((registro) => leituraDaLinha(registro.code));
    expect(operadores[0]).toBe("Operador de encapsulamento | Mão de obra | 2 | hora | Ativo | ");
    // Sem capacidade cadastrada é lacuna de cadastro — nunca zero.
    expect(operadores[1]).toBe("Operador de encapsulamento | Mão de obra | Não cadastrada | hora | Ativo | ");
    const encapsuladoras = [ENCAPSULADORA, ENCAPSULADORA_INATIVA].map((registro) => leituraDaLinha(registro.code));
    expect(new Set(encapsuladoras).size).toBe(2);
  });

  it("marcar 3 cria três linhas prontas para preencher, sem default novo — e a pendência aparece", async () => {
    const user = userEvent.setup();
    await abrir();
    await waitFor(() => expect(camposDeRecurso()).toHaveLength(1));
    expect(screen.queryByText("Alterações não salvas")).toBeNull();

    await consultarEncapsulamento(user);
    await user.click(caixa(OPERADOR_2.code));
    await user.click(caixa(ENCAPSULADORA.code));
    await user.click(caixa(ENERGIA.code));
    await user.click(screen.getByRole("button", { name: "Adicionar 3 recursos" }));

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Consulta de recursos industriais" })).toBeNull(),
    );
    await waitFor(() => expect(camposDeRecurso()).toHaveLength(4));
    const [, operador, encapsuladora, energia] = camposDeRecurso().map((campo) => campo.closest("tr")!);

    // O recurso escolhido na consulta fica nomeado na linha — fora da primeira
    // página do seletor, e sem perguntar de novo ao servidor.
    await waitFor(() => expect(camposDeRecurso()[1]).toHaveValue(`${OPERADOR_2.code} · ${OPERADOR_2.name}`));
    expect(camposDeRecurso()[2]).toHaveValue(`${ENCAPSULADORA.code} · ${ENCAPSULADORA.name}`);
    expect(camposDeRecurso()[3]).toHaveValue(`${ENERGIA.code} · ${ENERGIA.name}`);
    expect(getIndustrialResource).not.toHaveBeenCalled();

    // Mão de obra e equipamento se contam: 1, como "+ Adicionar recurso" sempre fez.
    expect(within(operador!).getByRole("textbox", { name: "Quantidade de recursos" })).toHaveValue("1");
    expect(within(encapsuladora!).getByRole("textbox", { name: "Quantidade de recursos" })).toHaveValue("1");
    // Energia não se conta.
    expect(within(energia!).queryByRole("textbox", { name: "Quantidade de recursos" })).toBeNull();
    // Uso por lote em branco, para a pessoa preencher; unidade como sempre nasceu.
    for (const linha of [operador!, encapsuladora!, energia!]) {
      const campos = within(linha).getAllByRole("textbox");
      expect(campos[campos.length - 1]).toHaveValue("");
      expect(within(linha).getByRole("combobox", { name: "Unidade de uso" })).toHaveValue("HOUR");
    }

    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Adicionar recursos" })).toHaveFocus();
  });

  it("o que o modelo já tem aparece travado, com o motivo — nunca duplicata", async () => {
    const user = userEvent.setup();
    await abrir();
    await consultarEncapsulamento(user);

    const auxiliar = await caixaAchada(AUXILIAR.code);
    expect(auxiliar).toBeDisabled();
    expect(auxiliar).toHaveAccessibleDescription("Já adicionado neste modelo.");
  });

  it("Cancelar fecha sem mexer nas linhas", async () => {
    const user = userEvent.setup();
    await abrir();
    await waitFor(() => expect(camposDeRecurso()).toHaveLength(1));
    await consultarEncapsulamento(user);
    await user.click(caixa(OPERADOR_2.code));

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Consulta de recursos industriais" })).toBeNull(),
    );
    expect(camposDeRecurso()).toHaveLength(1);
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
  });
});
