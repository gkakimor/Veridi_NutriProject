import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  EnergyCalculationMode,
  IndustrialCostResourceUsageDTO,
  IndustrialCostVersionDTO,
  IndustrialResourceDTO,
  IndustrialResourceType,
  ProductIndustrialCostResponse,
} from "@veridi/shared";

/**
 * Estrutura de Custos — campo "Recurso" sem corte (COST-USAGE-RESOURCE-BYID-01).
 *
 * As opções saíam dos 50 primeiros recursos ativos e do que a busca achava. O
 * recurso criado no contexto, ou restaurado do rascunho, fora deles voltava com
 * o campo vazio e o id escolhido por baixo; sem o tipo, "Quantidade de
 * recursos" sumia e o envio ia sem ela. O aviso de energia fora do modo direto
 * lia a mesma lista num instante em que ela ainda estava vazia, e não
 * disparava nunca. A busca, por sua vez, oferecia energia fora do modo direto e
 * recurso que a estrutura já usa.
 *
 * Agora o campo usa `useRecursosDoSeletor`: primeira página curta de cada tipo,
 * busca no servidor com o mesmo recorte, e o id escolhido que não veio em
 * página nenhuma perguntado uma vez, depois das páginas.
 */

const getProductIndustrialCosts = vi.fn();
const createResourceUsage = vi.fn();
vi.mock("../../lib/industrial-costs-api", () => ({
  getProductIndustrialCosts: (...a: unknown[]) => getProductIndustrialCosts(...a),
  updateIndustrialCostVersion: vi.fn(),
  createIndustrialCostLine: vi.fn(),
  createIndustrialCostVersion: vi.fn(),
  deleteIndustrialCostLine: vi.fn(),
  createResourceUsage: (...a: unknown[]) => createResourceUsage(...a),
  deleteResourceUsage: vi.fn(),
  updateEnergyMode: vi.fn(),
  activateIndustrialCostVersion: vi.fn(),
}));

vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: vi.fn(),
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

import {
  createIndustrialResource,
  getIndustrialResource,
  listIndustrialResources,
} from "../../lib/industrial-resources-api";
import { IndustrialCostPage } from "./IndustrialCostPage";
import { IndustrialResourceCreatePage } from "../industrial-resources/IndustrialResourceCreatePage";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import { PARAM_RETOMAR, startContextualCreate } from "../../lib/contextual-create";

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
    currentRate: null,
    rateCount: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdByName: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
    updatedByName: null,
    ...extra,
  } as IndustrialResourceDTO;
}

const faixa = (de: number, ate: number, type: IndustrialResourceType) =>
  Array.from({ length: ate - de + 1 }, (_, indice) => recurso(de + indice, type));

/** Na primeira página de mão de obra, e já usado pela estrutura. */
const USADO_NA_PAGINA = "rin-3";
const PRIMEIRO = recurso(1, "LABOR");
const ALVO = recurso(950, "LABOR", { name: "Operador Zeta Alvo" });
const USADO_ZETA = recurso(960, "LABOR", { name: "Operador Zeta Já Usado" });
const INATIVO_ZETA = recurso(970, "EQUIPMENT", { name: "Encapsuladora Zeta Parada", active: false });
const ENERGIA_ZETA = recurso(990, "ENERGY", { name: "Energia Zeta" });

function universoCompleto() {
  return [
    ...faixa(1, 60, "LABOR"),
    ...faixa(61, 75, "EQUIPMENT"),
    ...faixa(201, 230, "ENERGY"),
    ALVO,
    USADO_ZETA,
    INATIVO_ZETA,
    ENERGIA_ZETA,
  ];
}

/** O banco do servidor falso: o cadastro no contexto grava aqui. */
let universo: IndustrialResourceDTO[] = [];
let proximoNumero = 1001;
/** Atraso da primeira página de energia, para ela responder depois da de mão de obra e equipamento. */
let atrasoDaPaginaDeEnergia = 0;

const ORDEM_DO_TIPO: Record<IndustrialResourceType, number> = { LABOR: 0, EQUIPMENT: 1, ENERGY: 2 };

type Consulta = Parameters<typeof listIndustrialResources>[0];

/** `GET /industrial-resources`: filtra como o servidor, ordena por tipo e código, pagina. */
function servidor(params: Consulta = {}) {
  const termo = params.search?.toLowerCase();
  const linhas = universo
    .filter((registro) => !params.type || registro.type === params.type)
    .filter((registro) => params.active === undefined || registro.active === params.active)
    .filter((registro) => !termo || `${registro.code} ${registro.name}`.toLowerCase().includes(termo))
    .sort((a, b) => ORDEM_DO_TIPO[a.type] - ORDEM_DO_TIPO[b.type] || a.code.localeCompare(b.code));
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;
  return { resources: linhas.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: linhas.length };
}

function uso(id: string): IndustrialCostResourceUsageDTO {
  const registro = universo.find((item) => item.id === id)!;
  return {
    id: `uso-${id}`,
    resourceId: id,
    resourceCode: registro.code,
    resourceName: registro.name,
    resourceType: registro.type,
    resourceActive: registro.active,
    usageBasis: "FIXED_PER_REFERENCE_BATCH",
    usageQuantity: "1",
    usageUom: registro.defaultUsageUom,
    resourceCount: 1,
    totalUsageQuantity: "1",
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

function versao(modo: EnergyCalculationMode): IndustrialCostVersionDTO {
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
    resourceUsages: [USADO_NA_PAGINA, USADO_ZETA.id]
      .filter((id) => universo.some((item) => item.id === id))
      .map(uso),
    energyCalculationMode: modo,
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

function estrutura(modo: EnergyCalculationMode): ProductIndustrialCostResponse {
  const rascunho = versao(modo);
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

const ROTA = "/produtos/prod-1/custos";

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

async function abrir(modo: EnergyCalculationMode, rota = ROTA) {
  getProductIndustrialCosts.mockResolvedValue(estrutura(modo));
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/produtos/:productId/custos" element={<IndustrialCostPage />} />
        <Route path="/gestao/recursos-industriais/novo" element={<IndustrialResourceCreatePage />} />
        <Route path="/comercial/pedidos" element={<h1>Pedidos</h1>} />
      </Route>,
    ),
    { initialEntries: [rota] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByLabelText("Base de produção (un)");
}

const campo = () => screen.getByRole("combobox", { name: "Recurso" });
const consumo = () => screen.getByLabelText(/por lote de referência/);
const opcaoDe = (codigo: string) => ({ name: new RegExp(`^${codigo}`) });
const rotulo = (registro: Pick<IndustrialResourceDTO, "code" | "name">) => `${registro.code} · ${registro.name}`;
/** As opções de recurso da lista aberta — sem o "+ Novo recurso", que também é `option`. */
const opcoesDaLista = (lista: HTMLElement) =>
  within(lista)
    .getAllByRole("option")
    .filter((opcao) => !opcao.textContent?.startsWith("+"));
const AVISO_DE_ENERGIA = (codigo: string) =>
  `${codigo} foi criado, mas recursos de energia só entram nesta estrutura no modo de consumo informado diretamente.`;

/** Pedidos da lista de recursos, sem depender da ordem em que os efeitos saem. */
const consultas = () =>
  vi
    .mocked(listIndustrialResources)
    .mock.calls.map(([params]) => params)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const primeiraPagina = (...tipos: IndustrialResourceType[]) =>
  tipos
    .map((type) => ({ active: true, pageSize: PAGINA, type }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Deixa pedidos e respostas pendentes assentarem antes de contar. */
const assentar = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

/**
 * Sai pelo "+ Novo recurso" do campo, cadastra na tela oficial e volta. Zera a
 * contagem antes de salvar: a volta monta a tela de novo, e o que interessa é o
 * que ELA pede.
 */
async function cadastrarNoContexto(nome: string, tipo: IndustrialResourceType, antesDeSalvar?: () => void) {
  const user = userEvent.setup();
  fireEvent.focus(campo());
  fireEvent.change(campo(), { target: { value: nome } });
  fireEvent.mouseDown(await screen.findByRole("option", { name: /^\+ Novo recurso/ }));

  await user.type(await screen.findByLabelText(/^Nome/), nome);
  if (tipo !== "LABOR") await user.selectOptions(screen.getByLabelText("Tipo"), tipo);
  vi.mocked(listIndustrialResources).mockClear();
  vi.mocked(getIndustrialResource).mockClear();
  antesDeSalvar?.();
  await user.click(screen.getByRole("button", { name: "Criar recurso" }));

  await screen.findByLabelText("Base de produção (un)");
  const criado = universo.at(-1)!;
  expect(criado.name).toBe(nome);
  return criado;
}

/** Escolhe um recurso da primeira página, como quem já tinha começado a linha. */
async function escolherDaPagina(registro: IndustrialResourceDTO) {
  fireEvent.focus(campo());
  fireEvent.mouseDown(await screen.findByRole("option", opcaoDe(registro.code)));
  await waitFor(() => expect(campo()).toHaveValue(rotulo(registro)));
}

/**
 * Todo valor que o campo "Recurso" teve a partir de agora — inclusive o de um
 * render só, que o efeito seguinte desfaz. O React espelha o valor do campo
 * controlado no atributo `value`, e é ele que se observa.
 */
function historicoDoCampo() {
  const anteriores: (string | null)[] = [];
  const observador = new MutationObserver((registros) => {
    for (const registro of registros) {
      if ((registro.target as HTMLElement).id === "usage-resource") anteriores.push(registro.oldValue);
    }
  });
  observador.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["value"],
    attributeOldValue: true,
  });
  return () => {
    for (const registro of observador.takeRecords()) {
      if ((registro.target as HTMLElement).id === "usage-resource") anteriores.push(registro.oldValue);
    }
    observador.disconnect();
    return { anteriores, atual: campo().getAttribute("value") };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  universo = universoCompleto();
  proximoNumero = 1001;
  atrasoDaPaginaDeEnergia = 0;
  vi.mocked(listIndustrialResources).mockImplementation(async (params) => {
    if (params.type === "ENERGY" && !params.search && atrasoDaPaginaDeEnergia > 0) {
      await new Promise((resolve) => setTimeout(resolve, atrasoDaPaginaDeEnergia));
    }
    return servidor(params);
  });
  vi.mocked(getIndustrialResource).mockImplementation(async (id) => {
    const achado = universo.find((registro) => registro.id === id);
    if (!achado) throw new Error("Recurso não encontrado");
    return { ...achado, rates: [] };
  });
  vi.mocked(createIndustrialResource).mockImplementation(async (input) => {
    const criado = recurso(proximoNumero, input.type, { name: input.name });
    proximoNumero += 1;
    universo.push(criado);
    return { ...criado, rates: [] };
  });
  createResourceUsage.mockResolvedValue({});
});

describe("o universo do teste reproduz o corte de antes", () => {
  it("mais de 50 ativos: os 50 primeiros não traziam o alvo nem energia nenhuma", () => {
    expect(universo.filter((registro) => registro.active).length).toBeGreaterThan(50);
    const antigos = servidor({ active: true, pageSize: 50 }).resources;
    expect(antigos).toHaveLength(50);
    expect(antigos.some((registro) => registro.id === ALVO.id)).toBe(false);
    expect(antigos.some((registro) => registro.type === "ENERGY")).toBe(false);
  });
});

describe("Recurso da estrutura — primeira página e busca", () => {
  it("abre com a primeira página curta de cada tipo, sem energia fora do modo direto nem recurso já usado", async () => {
    await abrir("NONE");

    fireEvent.focus(campo());
    const lista = await screen.findByRole("listbox");
    // Mão de obra: 20 da página menos o já usado; equipamento: os 15 ativos.
    await waitFor(() => expect(opcoesDaLista(lista)).toHaveLength(19 + 15));
    const codigos = opcoesDaLista(lista).map((opcao) => opcao.textContent ?? "");
    expect(codigos.some((texto) => texto.startsWith("RIN-000003"))).toBe(false);
    expect(codigos.some((texto) => texto.startsWith(ALVO.code))).toBe(false);
    expect(codigos.some((texto) => texto.includes("Energia"))).toBe(false);

    await assentar();
    expect(consultas()).toEqual(primeiraPagina("LABOR", "EQUIPMENT"));
    expect(getIndustrialResource).not.toHaveBeenCalled();
  });

  it("a busca vai ao servidor com o mesmo recorte e acha o recurso fora da página; escolher leva a quantidade de recursos", async () => {
    await abrir("NONE");

    fireEvent.focus(campo());
    fireEvent.change(campo(), { target: { value: "Zeta" } });
    await waitFor(() => {
      expect(listIndustrialResources).toHaveBeenCalledWith({ active: true, search: "Zeta", pageSize: PAGINA, type: "LABOR" });
      expect(listIndustrialResources).toHaveBeenCalledWith({
        active: true,
        search: "Zeta",
        pageSize: PAGINA,
        type: "EQUIPMENT",
      });
    });
    const alvo = await screen.findByRole("option", opcaoDe(ALVO.code));
    // Achar não é poder usar: nem energia fora do modo direto, nem inativo, nem o já usado.
    expect(screen.queryByRole("option", opcaoDe(ENERGIA_ZETA.code))).toBeNull();
    expect(screen.queryByRole("option", opcaoDe(INATIVO_ZETA.code))).toBeNull();
    expect(screen.queryByRole("option", opcaoDe(USADO_ZETA.code))).toBeNull();
    expect(consultas().filter((params) => params.type === "ENERGY")).toHaveLength(0);

    fireEvent.mouseDown(alvo);
    await waitFor(() => expect(campo()).toHaveValue(rotulo(ALVO)));
    fireEvent.change(screen.getByLabelText("Quantidade de recursos"), { target: { value: "3" } });
    fireEvent.change(consumo(), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar recurso" }));

    await waitFor(() =>
      expect(createResourceUsage).toHaveBeenCalledWith("ec-1", {
        resourceId: ALVO.id,
        usageQuantity: "2",
        resourceCount: 3,
      }),
    );
    expect(getIndustrialResource).not.toHaveBeenCalled();
    expect(consultas().filter((params) => params.search === "Zeta")).toHaveLength(2);
  });

  it("modo direto: a energia ativa entra pela página de energia e pela busca, cada recorte pedido uma vez", async () => {
    await abrir("DIRECT");

    fireEvent.focus(campo());
    expect(await screen.findByRole("option", opcaoDe("RIN-000201"))).toBeInTheDocument();
    await assentar();
    expect(consultas()).toEqual(primeiraPagina("LABOR", "EQUIPMENT", "ENERGY"));

    fireEvent.change(campo(), { target: { value: "Zeta" } });
    expect(await screen.findByRole("option", opcaoDe(ENERGIA_ZETA.code))).toBeInTheDocument();
    expect(screen.getByRole("option", opcaoDe(ALVO.code))).toBeInTheDocument();
    expect(screen.queryByRole("option", opcaoDe(INATIVO_ZETA.code))).toBeNull();
    expect(screen.queryByRole("option", opcaoDe(USADO_ZETA.code))).toBeNull();
    expect(consultas().filter((params) => params.search === "Zeta")).toHaveLength(3);
    expect(getIndustrialResource).not.toHaveBeenCalled();
  });
});

describe("Recurso da estrutura — id que chega de fora", () => {
  it("rascunho restaurado com recurso fora da página: nome no campo, uma pergunta pelo id depois da página, quantidade e guarda mantidas", async () => {
    const token = startContextualCreate({
      originRoute: ROTA,
      fieldKey: "usageResourceId",
      entityType: "industrialResource",
      draft: {
        lendoAtiva: false,
        referenceQuantity: "1000",
        category: "SECONDARY_PACKAGING",
        description: "",
        basis: "FIXED_PER_BATCH",
        rateValue: "",
        usageResourceId: ALVO.id,
        usageQuantity: "2",
        usageResourceCount: "3",
      },
    })!;
    // Voltou pelo "Cancelar" do cadastro: rascunho sem resultado.
    await abrir("NONE", `${ROTA}?${PARAM_RETOMAR}=${token}`);

    await waitFor(() => expect(campo()).toHaveValue(rotulo(ALVO)));
    expect(screen.getByLabelText("Quantidade de recursos")).toHaveValue("3");
    expect(consumo()).toHaveValue("2");

    await assentar();
    expect(getIndustrialResource).toHaveBeenCalledTimes(1);
    expect(getIndustrialResource).toHaveBeenCalledWith(ALVO.id);
    const pedidoPeloId = vi.mocked(getIndustrialResource).mock.invocationCallOrder[0]!;
    for (const ordem of vi.mocked(listIndustrialResources).mock.invocationCallOrder) {
      expect(ordem).toBeLessThan(pedidoPeloId);
    }
    expect(consultas()).toEqual(primeiraPagina("LABOR", "EQUIPMENT"));

    // A linha restaurada é alteração pendente: sair pergunta.
    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Pedidos" }));
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continuar editando" }));

    fireEvent.click(screen.getByRole("button", { name: "Adicionar recurso" }));
    await waitFor(() =>
      expect(createResourceUsage).toHaveBeenCalledWith("ec-1", {
        resourceId: ALVO.id,
        usageQuantity: "2",
        resourceCount: 3,
      }),
    );
    expect(getIndustrialResource).toHaveBeenCalledTimes(1);
  });

  it("enquanto o id não resolve, adicionar fica travado — sem o tipo, a quantidade de recursos não iria", async () => {
    let responder: () => void = () => undefined;
    vi.mocked(getIndustrialResource).mockImplementation(
      (id) =>
        new Promise((resolve) => {
          responder = () => resolve({ ...universo.find((registro) => registro.id === id)!, rates: [] });
        }),
    );
    const token = startContextualCreate({
      originRoute: ROTA,
      fieldKey: "usageResourceId",
      entityType: "industrialResource",
      draft: { lendoAtiva: false, usageResourceId: ALVO.id, usageQuantity: "2", usageResourceCount: "3" },
    })!;
    await abrir("NONE", `${ROTA}?${PARAM_RETOMAR}=${token}`);

    await waitFor(() => expect(getIndustrialResource).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Adicionar recurso" })).toBeDisabled();
    expect(screen.queryByLabelText("Quantidade de recursos")).toBeNull();

    await act(async () => responder());
    await waitFor(() => expect(campo()).toHaveValue(rotulo(ALVO)));
    expect(screen.getByLabelText("Quantidade de recursos")).toHaveValue("3");
    expect(screen.getByRole("button", { name: "Adicionar recurso" })).toBeEnabled();
  });

  it.each([
    { onde: "fora da página", reduzir: false, pelosIds: 1 },
    { onde: "dentro da página", reduzir: true, pelosIds: 0 },
  ])(
    "cadastro no contexto $onde: volta com o criado escolhido e com nome, o rascunho e a guarda",
    async ({ reduzir, pelosIds }) => {
      if (reduzir) universo = [...faixa(1, 5, "LABOR"), ...faixa(61, 63, "EQUIPMENT")];
      await abrir("NONE");
      fireEvent.change(consumo(), { target: { value: "4" } });

      const criado = await cadastrarNoContexto("Operador Noturno", "LABOR");
      expect(servidor({ active: true, type: "LABOR", pageSize: PAGINA }).resources.some((r) => r.id === criado.id)).toBe(
        reduzir,
      );

      await waitFor(() => expect(campo()).toHaveValue(rotulo(criado)));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(consumo()).toHaveValue("4");
      expect(screen.getByLabelText("Quantidade de recursos")).toHaveValue("1");

      await assentar();
      expect(getIndustrialResource).toHaveBeenCalledTimes(pelosIds);
      if (pelosIds) expect(getIndustrialResource).toHaveBeenCalledWith(criado.id);
      expect(consultas()).toEqual(primeiraPagina("LABOR", "EQUIPMENT"));

      const user = userEvent.setup();
      await user.click(screen.getByRole("link", { name: "Pedidos" }));
      expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    },
  );
});

describe("Recurso da estrutura — energia criada no contexto", () => {
  it.each([
    { modo: "NONE" as const, onde: "sem página de energia", energias: 30, pelosIds: 1 },
    { modo: "FROM_EQUIPMENT" as const, onde: "fora da página de energia", energias: 30, pelosIds: 1 },
    { modo: "FROM_EQUIPMENT" as const, onde: "dentro da página de energia", energias: 3, pelosIds: 0 },
  ])(
    "modo $modo, $onde: o mesmo aviso de sempre, e o campo volta ao que o rascunho trazia",
    async ({ modo, energias, pelosIds }) => {
      universo = [
        ...faixa(1, 60, "LABOR"),
        ...faixa(61, 75, "EQUIPMENT"),
        ...faixa(201, 200 + energias, "ENERGY"),
      ];
      await abrir(modo);
      await escolherDaPagina(PRIMEIRO);
      fireEvent.change(consumo(), { target: { value: "5" } });

      // A página de energia responde por último: o id não pode ser perguntado antes dela.
      atrasoDaPaginaDeEnergia = 60;
      let lerHistorico: ReturnType<typeof historicoDoCampo> = () => ({ anteriores: [], atual: null });
      const criado = await cadastrarNoContexto("Energia Nova", "ENERGY", () => {
        lerHistorico = historicoDoCampo();
      });
      expect(
        servidor({ active: true, type: "ENERGY", pageSize: PAGINA }).resources.some((r) => r.id === criado.id),
      ).toBe(energias < PAGINA);

      expect(await screen.findByRole("alert")).toHaveTextContent(AVISO_DE_ENERGIA(criado.code));
      await waitFor(() => expect(campo()).toHaveValue(rotulo(PRIMEIRO)));
      expect(consumo()).toHaveValue("5");

      await assentar();
      expect(getIndustrialResource).toHaveBeenCalledTimes(pelosIds);
      expect(consultas()).toEqual(
        modo === "NONE" ? primeiraPagina("LABOR", "EQUIPMENT") : primeiraPagina("LABOR", "EQUIPMENT", "ENERGY"),
      );

      // Nem por um render a energia recusada apareceu no campo.
      const { anteriores, atual } = lerHistorico();
      expect(anteriores.length).toBeGreaterThan(0);
      expect(atual).toBe(rotulo(PRIMEIRO));
      expect(anteriores).not.toContain(rotulo(criado));

      // A página de energia da tarifa não vira opção do campo "Recurso".
      fireEvent.focus(campo());
      const lista = await screen.findByRole("listbox");
      expect(opcoesDaLista(lista).length).toBeGreaterThan(0);
      expect(opcoesDaLista(lista).some((opcao) => opcao.textContent?.includes("Energia"))).toBe(false);
      fireEvent.keyDown(campo(), { key: "Escape" });

      fireEvent.click(screen.getByRole("button", { name: "Adicionar recurso" }));
      await waitFor(() =>
        expect(createResourceUsage).toHaveBeenCalledWith("ec-1", {
          resourceId: PRIMEIRO.id,
          usageQuantity: "5",
          resourceCount: 1,
        }),
      );
    },
  );

  it("trocar de recurso antes da conferência: vale a escolha nova, sem aviso nem volta", async () => {
    let responder: () => void = () => undefined;
    vi.mocked(getIndustrialResource).mockImplementation(
      (id) =>
        new Promise((resolve) => {
          responder = () => resolve({ ...universo.find((registro) => registro.id === id)!, rates: [] });
        }),
    );
    await abrir("NONE");

    const criado = await cadastrarNoContexto("Energia Nova", "ENERGY");
    await waitFor(() => expect(getIndustrialResource).toHaveBeenCalledWith(criado.id));
    await escolherDaPagina(PRIMEIRO);
    await act(async () => responder());
    await assentar();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(campo()).toHaveValue(rotulo(PRIMEIRO));
  });

  it("modo direto: a energia criada fora da página fica escolhida, sem aviso e sem quantidade de recursos", async () => {
    await abrir("DIRECT");
    fireEvent.change(consumo(), { target: { value: "5" } });

    const criado = await cadastrarNoContexto("Energia Nova", "ENERGY");
    await waitFor(() => expect(campo()).toHaveValue(rotulo(criado)));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByLabelText("Quantidade de recursos")).toBeNull();
    expect(consumo()).toHaveValue("5");

    await assentar();
    expect(getIndustrialResource).toHaveBeenCalledTimes(1);
    expect(getIndustrialResource).toHaveBeenCalledWith(criado.id);
    expect(consultas()).toEqual(primeiraPagina("LABOR", "EQUIPMENT", "ENERGY"));

    fireEvent.click(screen.getByRole("button", { name: "Adicionar recurso" }));
    await waitFor(() =>
      expect(createResourceUsage).toHaveBeenCalledWith("ec-1", { resourceId: criado.id, usageQuantity: "5" }),
    );
  });
});

describe("guarda estrutural", () => {
  it("o campo não tem mais catálogo próprio de 50", () => {
    const fonte = readFileSync(
      join(process.cwd(), "src", "pages", "industrial-costs", "IndustrialCostPage.tsx"),
      "utf8",
    );
    expect(fonte).not.toMatch(/listIndustrialResources/);
    expect(fonte).not.toMatch(/resourcesRef/);
    expect(fonte).toMatch(/useRecursosDoSeletor\(ATIVOS_SEM_ENERGIA/);
    expect(fonte).toMatch(/onSearch=\{buscarRecursos\}/);
  });
});
