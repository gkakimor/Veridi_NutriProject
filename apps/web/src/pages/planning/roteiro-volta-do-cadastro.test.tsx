import { StrictMode } from "react";
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
  IndustrialResourceDTO,
  IndustrialResourceListResponse,
  ProductionProfileDTO,
  ProductionProfileStepDTO,
  ProductionProfileVersionDTO,
} from "@veridi/shared";

/**
 * ROUTE-CONTEXT-RESTORE-01 — o Roteiro de Produção na volta de um cadastro
 * contextual.
 *
 * Sair para cadastrar recurso guarda o rascunho inteiro, e a volta o restaura.
 * Só que a carga do roteiro sai na montagem e chega DEPOIS da restauração: base,
 * unidade e etapas voltavam a ser as do servidor — "Etapa Restaurada" virava
 * "Encapsulamento". Nome e descrição sobreviviam pela leitura anterior, menos
 * quando o campo tinha sido apagado.
 *
 * A regra: na carga inicial depois de uma restauração, o que está na tela é da
 * pessoa. A leitura só diz o que está gravado, e a diferença fica pendente até
 * alguém salvar. Depois da primeira leitura, salvar e ativar recarregam como
 * sempre, com o servidor como verdade.
 */

const getProductionProfile = vi.fn();
const updateProductionProfile = vi.fn();
const updateProductionProfileVersion = vi.fn();
const activateProductionProfileVersion = vi.fn();

vi.mock("../../lib/production-profiles-api", () => ({
  getProductionProfile: (...a: unknown[]) => getProductionProfile(...a),
  updateProductionProfile: (...a: unknown[]) => updateProductionProfile(...a),
  updateProductionProfileVersion: (...a: unknown[]) => updateProductionProfileVersion(...a),
  activateProductionProfileVersion: (...a: unknown[]) => activateProductionProfileVersion(...a),
  createProductionProfileVersionFrom: vi.fn(),
  setProductProductionProfile: vi.fn(),
}));

vi.mock("../../lib/industrial-resources-api", () => ({
  listIndustrialResources: vi.fn(),
  getIndustrialResource: vi.fn(),
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

import { listIndustrialResources } from "../../lib/industrial-resources-api";
import {
  PARAM_ORIGEM,
  PARAM_RETOMAR,
  finishContextualCreate,
  originRouteWithReturn,
  readContextualCreate,
  startContextualCreate,
} from "../../lib/contextual-create";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import { ProductionProfileDetailPage } from "./ProductionProfileDetailPage";

const ROTA = "/planejamento/perfis-producao/ppr-1";

const RECURSO_NOVO = {
  id: "rin-nova",
  code: "RIN-000042",
  name: "Encapsuladora Nova",
  type: "EQUIPMENT",
  description: null,
  defaultUsageUom: "HOUR",
  powerKw: null,
  capacityQuantity: null,
  notes: null,
  active: true,
} as IndustrialResourceDTO;

/** O catálogo de capacidade: vazio antes do cadastro, com o recurso novo depois. */
let catalogo: IndustrialResourceDTO[] = [];

function passo(sobre: Partial<ProductionProfileStepDTO> = {}): ProductionProfileStepDTO {
  return {
    id: "st-1",
    sequence: 1,
    name: "Encapsulamento",
    description: null,
    setupDurationMinutes: 30,
    runDurationMinutes: 60,
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
    ...sobre,
  };
}

/** O roteiro como o servidor devolve: rascunho V1 com "Encapsulamento" para 1000 un. */
function perfil(
  rascunho: ProductionProfileVersionDTO = versao(),
  sobre: Partial<ProductionProfileDTO> = {},
): ProductionProfileDTO {
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
    ...sobre,
  };
}

/** O rascunho no formato em que a tela o guarda ao sair para o cadastro. */
function rascunhoDaTela(sobre: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nome: "Cápsulas — linha padrão",
    descricao: "",
    base: "250,5",
    unidade: "kg",
    etapas: [
      {
        chave: "etapa-restaurada",
        name: "Etapa Restaurada",
        description: "",
        preparacao: "15",
        execucao: "45",
        scalingMode: "BY_BATCH",
        recursos: [],
      },
    ],
    ...sobre,
  };
}

/** Saiu do roteiro, cadastrou o recurso e a tela de cadastro devolveu o token. */
function voltarDoCadastro(draft = rascunhoDaTela()): string {
  const token = startContextualCreate({
    originRoute: ROTA,
    fieldKey: "industrialResourceId",
    entityType: "industrialResource",
    draft,
  })!;
  finishContextualCreate(token, {
    entityType: "industrialResource",
    entityId: RECURSO_NOVO.id,
    label: RECURSO_NOVO.name,
  });
  return token;
}

function adiada<T>() {
  let resolver: (valor: T) => void = () => {};
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
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

function abrir(entrada: string, { estrito = false } = {}) {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route
          path="/planejamento/perfis-producao/:profileId"
          element={<ProductionProfileDetailPage />}
        />
        <Route path="/gestao/recursos-industriais/novo" element={<h1>Novo recurso</h1>} />
        <Route path="/comercial/pedidos" element={<h1>Pedidos</h1>} />
      </Route>,
    ),
    { initialEntries: [entrada] },
  );
  const arvore = <RouterProvider router={router} />;
  render(estrito ? <StrictMode>{arvore}</StrictMode> : arvore);
  return router;
}

const cabecalho = () => screen.findByRole("heading", { level: 1, name: /PPR-000001/ });
const botao = (nome: string) => screen.getByRole("button", { name: nome });
const base = () => screen.getByLabelText("Quantidade de referência");
const unidade = () => screen.getByLabelText("Unidade de referência");
const nomeDaEtapa = () => screen.getByLabelText("Nome da etapa");

/** O rascunho que voltou do cadastro está na tela — nenhum campo do servidor. */
async function rascunhoRestauradoNaTela() {
  await waitFor(() => expect(unidade()).toHaveValue("kg"));
  expect(base()).toHaveValue("250,5");
  expect(screen.getAllByLabelText("Nome da etapa")).toHaveLength(1);
  expect(nomeDaEtapa()).toHaveValue("Etapa Restaurada");
  expect(screen.getByLabelText("Modo de escala")).toHaveValue("BY_BATCH");
  expect(screen.getByLabelText("Preparação (min)")).toHaveValue("15");
  expect(screen.getByLabelText("Execução por lote (min)")).toHaveValue("45");
  expect(screen.queryByDisplayValue("Encapsulamento")).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  catalogo = [RECURSO_NOVO];
  vi.mocked(listIndustrialResources).mockImplementation(
    async (params = {}): Promise<IndustrialResourceListResponse> => {
      const resources = catalogo.filter((recurso) => !params.type || recurso.type === params.type);
      return { resources, page: 1, pageSize: params.pageSize ?? 20, total: resources.length };
    },
  );
  updateProductionProfile.mockResolvedValue({});
  activateProductionProfileVersion.mockResolvedValue({});
});

describe("Roteiro — volta do cadastro contextual", () => {
  it("base, unidade e etapas restauradas continuam depois que a carga do roteiro chega", async () => {
    const carga = adiada<ProductionProfileDTO>();
    getProductionProfile.mockReturnValue(carga.promessa);
    const token = voltarDoCadastro();

    const router = abrir(`${ROTA}?${PARAM_RETOMAR}=${token}`);

    // A restauração acontece ANTES da resposta: contexto consumido, URL limpa,
    // e o roteiro ainda carregando.
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(readContextualCreate(token)).toBeNull();
    expect(getProductionProfile).toHaveBeenCalledWith("ppr-1");
    expect(screen.getByText("Carregando…")).toBeInTheDocument();

    await act(async () => carga.resolver(perfil()));
    await cabecalho();

    await rascunhoRestauradoNaTela();
    expect(screen.getByLabelText("Nome")).toHaveValue("Cápsulas — linha padrão");
    expect(screen.getByLabelText("Descrição")).toHaveValue("");
  });

  it("em StrictMode (dev) a montagem pede o roteiro duas vezes, e nenhuma das respostas escreve por cima", async () => {
    const cargas = [adiada<ProductionProfileDTO>(), adiada<ProductionProfileDTO>()];
    let chamada = 0;
    getProductionProfile.mockImplementation(
      () => cargas[chamada++]?.promessa ?? new Promise<ProductionProfileDTO>(() => {}),
    );
    const token = voltarDoCadastro();

    abrir(`${ROTA}?${PARAM_RETOMAR}=${token}`, { estrito: true });
    await waitFor(() => expect(getProductionProfile).toHaveBeenCalledTimes(2));

    await act(async () => cargas[0]!.resolver(perfil()));
    await cabecalho();
    await rascunhoRestauradoNaTela();

    await act(async () => cargas[1]!.resolver(perfil()));
    await rascunhoRestauradoNaTela();
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
  });

  it("ida e volta pela tela: o que foi digitado antes de sair continua depois da carga", async () => {
    catalogo = [];
    getProductionProfile.mockResolvedValue(perfil());
    const router = abrir(ROTA);
    await cabecalho();
    await waitFor(() => expect(unidade()).toHaveValue("un"));

    fireEvent.change(base(), { target: { value: "250,5" } });
    fireEvent.change(unidade(), { target: { value: "kg" } });
    fireEvent.change(nomeDaEtapa(), { target: { value: "Etapa Restaurada" } });
    fireEvent.change(screen.getByLabelText("Modo de escala"), { target: { value: "BY_BATCH" } });
    fireEvent.change(screen.getByLabelText("Preparação (min)"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Execução por lote (min)"), { target: { value: "45" } });
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar recurso" }));

    expect(await screen.findByRole("heading", { name: "Novo recurso" })).toBeInTheDocument();
    const token = new URLSearchParams(router.state.location.search).get(PARAM_ORIGEM)!;
    const registro = readContextualCreate(token)!;
    expect(registro.draft).toMatchObject({ base: "250,5", unidade: "kg" });

    // O que a tela oficial de cadastro faz ao salvar: registra e volta.
    catalogo = [RECURSO_NOVO];
    finishContextualCreate(token, {
      entityType: "industrialResource",
      entityId: RECURSO_NOVO.id,
      label: RECURSO_NOVO.name,
    });
    await act(() => router.navigate(originRouteWithReturn(registro)));

    await cabecalho();
    await rascunhoRestauradoNaTela();
    expect(getProductionProfile).toHaveBeenCalledTimes(2);
  });

  it("sem retomar, a carga continua trazendo base, unidade e etapas do servidor", async () => {
    // Criação contextual pendente de OUTRA tela não é desta: nada a restaurar.
    startContextualCreate({
      originRoute: "/comercial/pedidos/novo",
      fieldKey: "customerId",
      entityType: "customer",
      draft: { notes: "outra tela" },
    });
    getProductionProfile.mockResolvedValue(perfil());

    abrir(ROTA);
    await cabecalho();

    await waitFor(() => expect(unidade()).toHaveValue("un"));
    expect(base()).toHaveValue("1.000");
    expect(nomeDaEtapa()).toHaveValue("Encapsulamento");
    expect(screen.getByLabelText("Preparação (min)")).toHaveValue("30");
    expect(screen.getByLabelText("Execução da base (min)")).toHaveValue("60");
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(botao("Salvar rascunho")).toBeDisabled();
  });
});

describe("Roteiro restaurado — alterações não salvas", () => {
  it("restaurado diferente do servidor fica pendente; salvar grava o restaurado e a pendência some", async () => {
    const user = userEvent.setup();
    getProductionProfile.mockResolvedValue(perfil());
    const token = voltarDoCadastro();

    abrir(`${ROTA}?${PARAM_RETOMAR}=${token}`);
    await cabecalho();
    await rascunhoRestauradoNaTela();

    // Terminar a carga não absolve o que voltou do cadastro.
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    expect(botao("Salvar rascunho")).toBeEnabled();
    expect(botao("Ativar versão")).toBeDisabled();
    expect(screen.getByText("Salve o rascunho antes de ativar a versão.")).toBeInTheDocument();

    // A guarda de saída diz o mesmo que a frase.
    await user.click(screen.getByRole("link", { name: "Pedidos" }));
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    await user.click(botao("Continuar editando"));
    await waitFor(() => expect(screen.queryByText("Sair sem salvar?")).toBeNull());
    await rascunhoRestauradoNaTela();

    // Salvar grava o que voltou; a leitura seguinte é do servidor, que devolve
    // a base normalizada — e é ela que passa a valer.
    const gravado = versao({
      referenceQuantity: "250.5",
      referenceUomCode: "kg",
      steps: [
        passo({
          name: "Etapa Restaurada",
          setupDurationMinutes: 15,
          runDurationMinutes: 45,
          scalingMode: "BY_BATCH",
        }),
      ],
    });
    updateProductionProfileVersion.mockResolvedValue(gravado);
    getProductionProfile.mockResolvedValue(perfil(gravado));
    await user.click(botao("Salvar rascunho"));

    await waitFor(() => expect(updateProductionProfileVersion).toHaveBeenCalledTimes(1));
    expect(updateProductionProfileVersion).toHaveBeenCalledWith("ppv-1", {
      referenceQuantity: "250.5",
      referenceUomCode: "kg",
      steps: [
        {
          name: "Etapa Restaurada",
          description: null,
          setupDurationMinutes: 15,
          runDurationMinutes: 45,
          scalingMode: "BY_BATCH",
          resources: [],
        },
      ],
    });
    expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(base()).toHaveValue("250,5");
    expect(botao("Ativar versão")).toBeEnabled();

    await user.click(screen.getByRole("link", { name: "Pedidos" }));
    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(screen.queryByText("Sair sem salvar?")).toBeNull();
  });

  it("rascunho restaurado igual ao gravado não inventa pendência", async () => {
    const user = userEvent.setup();
    getProductionProfile.mockResolvedValue(perfil());
    const token = voltarDoCadastro(
      rascunhoDaTela({
        base: "1000",
        unidade: "un",
        etapas: [
          {
            chave: "etapa-igual",
            name: "Encapsulamento",
            description: "",
            preparacao: "30",
            execucao: "60",
            scalingMode: "PROPORTIONAL",
            recursos: [],
          },
        ],
      }),
    );

    abrir(`${ROTA}?${PARAM_RETOMAR}=${token}`);
    await cabecalho();

    await waitFor(() => expect(nomeDaEtapa()).toHaveValue("Encapsulamento"));
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(botao("Salvar rascunho")).toBeDisabled();
    expect(botao("Ativar versão")).toBeEnabled();

    await user.click(screen.getByRole("link", { name: "Pedidos" }));
    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(screen.queryByText("Sair sem salvar?")).toBeNull();
  });

  it("depois da volta, salvar a identificação não apaga o rascunho restaurado (StrictMode)", async () => {
    // ROUTE-IDENTIFICATION-SAVE-DRAFT-01: a trava da restauração só vale para a
    // carga inicial; a releitura depois de salvar o nome é outra carga.
    const user = userEvent.setup();
    getProductionProfile.mockResolvedValue(perfil());
    const token = voltarDoCadastro(rascunhoDaTela({ nome: "Cápsulas — linha 2" }));

    abrir(`${ROTA}?${PARAM_RETOMAR}=${token}`, { estrito: true });
    await cabecalho();
    await rascunhoRestauradoNaTela();
    await waitFor(() => expect(getProductionProfile).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText("Alterações não salvas")).toHaveLength(2);

    getProductionProfile.mockResolvedValue(perfil(versao(), { name: "Cápsulas — linha 2" }));
    await user.click(botao("Salvar identificação"));

    // Só com a releitura aplicada a identificação deixa de estar pendente.
    expect(await screen.findByText("Identificação salva.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: /Cápsulas — linha 2/ })).toBeInTheDocument();
    expect(getProductionProfile).toHaveBeenCalledTimes(3);
    expect(updateProductionProfile).toHaveBeenCalledWith("ppr-1", {
      name: "Cápsulas — linha 2",
      description: null,
    });
    expect(updateProductionProfileVersion).not.toHaveBeenCalled();

    await rascunhoRestauradoNaTela();
    expect(screen.getAllByText("Alterações não salvas")).toHaveLength(1);
    expect(botao("Salvar rascunho")).toBeEnabled();
    expect(botao("Ativar versão")).toBeDisabled();

    await user.click(screen.getByRole("link", { name: "Pedidos" }));
    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("nome e descrição apagados antes de sair continuam apagados depois da carga", async () => {
    getProductionProfile.mockResolvedValue(perfil(versao(), { description: "Linha antiga" }));
    const token = voltarDoCadastro(rascunhoDaTela({ nome: "", descricao: "" }));

    abrir(`${ROTA}?${PARAM_RETOMAR}=${token}`);
    await cabecalho();
    await rascunhoRestauradoNaTela();

    expect(screen.getByLabelText("Nome")).toHaveValue("");
    expect(screen.getByLabelText("Descrição")).toHaveValue("");
    // Os dois blocos pendentes: identificação e rascunho.
    expect(screen.getAllByText("Alterações não salvas")).toHaveLength(2);
    expect(botao("Salvar identificação")).toBeDisabled();
  });
});
