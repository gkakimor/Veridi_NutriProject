import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FormulationVersionDTO, ProjectSampleDTO } from "@veridi/shared";

/**
 * Catálogo grande: quem procura precisa achar.
 *
 * As telas que escolhem item carregavam uma página fixa e filtravam no
 * navegador. Acima do teto o item EXISTIA e não aparecia na busca, sem
 * aviso nenhum — e como o campo oferece "+ Novo item de estoque" no topo, o
 * caminho natural de quem não achava era cadastrar de novo o que já existia.
 * Medido na base local: 2.729 itens ativos contra teto de 1000 na Contagem
 * Física; 1.211 matérias-primas ativas contra teto de 1000 na Formulação.
 *
 * O servidor daqui é de mentira, mas obedece de verdade aos filtros
 * (`type`, `active`, `search`, `pageSize`): é isso que torna honesta a
 * afirmação "o item inelegível continua fora" — ele fica de fora porque a
 * tela perguntou certo, não porque o teste combinou a resposta.
 */

interface ItemFalso {
  id: string;
  code: string;
  name: string;
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_PRODUCT";
  active: boolean;
  controlsLot: boolean;
  unitCode: string;
  unit: { code: string; dimension: string };
}

interface Consulta {
  ids?: string[];
  search?: string;
  type?: string;
  active?: boolean;
  page?: number;
  pageSize?: number;
}

function item(
  id: string,
  code: string,
  name: string,
  extra: Partial<ItemFalso> = {},
): ItemFalso {
  return {
    id,
    code,
    name,
    type: "RAW_MATERIAL",
    active: true,
    controlsLot: false,
    unitCode: "kg",
    unit: { code: "kg", dimension: "MASS" },
    ...extra,
  };
}

/** Sessenta excipientes ocupam sozinhos a primeira página de cinquenta. */
const EXCIPIENTES = Array.from({ length: 60 }, (_, indice) =>
  item(
    `ex-${indice + 1}`,
    `MP-${String(indice + 1).padStart(6, "0")}`,
    `Excipiente ${indice + 1}`,
  ),
);

/** O alvo: existe, é elegível, e nunca cabe na primeira página. */
const BETA = item("it-beta", "MP-002500", "Beta-Alanina");
/** Casa com a busca, mas outra linha da fórmula já consome. */
const BETA_USADA = item("it-beta-usada", "MP-002499", "Beta-Alanina Complexo");
/** Casa com a busca e está inativa. */
const BETA_INATIVA = item("it-beta-inativa", "MP-002501", "Beta-Alanina Descontinuada", {
  active: false,
});
/** Casa com a busca e é produto acabado — não entra em fórmula. */
const BETA_ACABADO = item("it-beta-pa", "PA-000900", "Beta-Alanina 300g Pote", {
  type: "FINISHED_PRODUCT",
});
/** Segundo alvo, para provar qual resposta a lista mostra. */
const CAFEINA = item("it-cafeina", "MP-002400", "Cafeína Anidra");

const CATALOGO: ItemFalso[] = [
  ...EXCIPIENTES,
  CAFEINA,
  BETA_USADA,
  BETA,
  BETA_INATIVA,
  BETA_ACABADO,
];

/** Toda consulta que a tela fez ao catálogo, na ordem. */
let chamadas: Consulta[] = [];
/** Buscas presas: `pendentes[i]()` libera a i-ésima. */
let pendentes: Array<() => void> = [];
/** Enquanto ligado, busca no servidor não responde sozinha. */
let segurarBusca = false;

function responder(params: Consulta) {
  let linhas = CATALOGO;
  const ids = params.ids;
  if (ids) linhas = linhas.filter((linha) => ids.includes(linha.id));
  if (params.type) linhas = linhas.filter((linha) => linha.type === params.type);
  if (params.active !== undefined) linhas = linhas.filter((linha) => linha.active === params.active);
  if (params.search) {
    const termo = params.search.toLowerCase();
    linhas = linhas.filter((linha) =>
      `${linha.code} ${linha.name}`.toLowerCase().includes(termo),
    );
  }
  const pageSize = params.pageSize ?? 20;
  return { items: linhas.slice(0, pageSize), page: 1, pageSize, total: linhas.length };
}

const listItems = vi.fn();
const getItem = vi.fn();
const getInventoryItem = vi.fn();
const createStockCount = vi.fn();
const getFormulationVersion = vi.fn();
const updateFormulationVersion = vi.fn();
const getSample = vi.fn();
const registerSampleConsumption = vi.fn();

vi.mock("../lib/items-api", () => ({
  listItems: (params?: Consulta) => listItems(params ?? {}),
  getItem: (id: string) => getItem(id),
}));

vi.mock("../lib/inventory-api", () => ({
  getInventoryItem: (id: string) => getInventoryItem(id),
  createStockCount: (input: unknown) => createStockCount(input),
}));

vi.mock("../lib/formulations-api", () => ({
  getFormulationVersion: (id: string) => getFormulationVersion(id),
  updateFormulationVersion: (id: string, input: unknown) => updateFormulationVersion(id, input),
  activateFormulationVersion: vi.fn(),
  createNewFormulationVersion: vi.fn(),
  getFormulationActivationImpact: () => Promise.resolve(null),
}));

vi.mock("../lib/samples-api", () => ({
  getSample: (id: string) => getSample(id),
  registerSampleConsumption: (id: string, input: unknown) => registerSampleConsumption(id, input),
  approveSample: vi.fn(),
  cancelSample: vi.fn(),
  produceSample: vi.fn(),
  rejectSample: vi.fn(),
}));

vi.mock("../lib/units-api", () => ({ listUnits: () => Promise.resolve([]) }));
vi.mock("../lib/costs-api", () => ({ getFormulationCostEstimate: () => Promise.resolve(null) }));
vi.mock("../app/AuthProvider", () => ({ useAuth: () => ({ user: { role: "ADMIN" } }) }));

import { StockCountPage } from "./inventory/StockCountPage";
import { FormulationVersionPage } from "./formulations/FormulationVersionPage";
import { SampleDetailPage } from "./samples/SampleDetailPage";

beforeEach(() => {
  chamadas = [];
  pendentes = [];
  segurarBusca = false;
  listItems.mockImplementation((params: Consulta) => {
    chamadas.push(params);
    if (params.search && segurarBusca) {
      return new Promise((resolve) => {
        pendentes.push(() => resolve(responder(params)));
      });
    }
    return Promise.resolve(responder(params));
  });
  getItem.mockImplementation((id: string) => {
    const encontrado = CATALOGO.find((linha) => linha.id === id);
    return encontrado
      ? Promise.resolve(encontrado)
      : Promise.reject(new Error("item inexistente"));
  });
  getInventoryItem.mockResolvedValue({ controlsLot: false, onHand: "10", lots: [] });
  createStockCount.mockResolvedValue({});
});

const buscasPor = (termo: string) => chamadas.filter((chamada) => chamada.search === termo);

describe("Contagem Física — busca de item no servidor", () => {
  async function abrir() {
    render(
      <MemoryRouter>
        <StockCountPage />
      </MemoryRouter>,
    );
    const campo = screen.getByPlaceholderText("Digite código ou nome do item…");
    fireEvent.focus(campo);
    await screen.findByRole("option", { name: /MP-000001/ });
    return campo;
  }

  it("a primeira página do catálogo não contém o item procurado", async () => {
    await abrir();
    expect(screen.queryByRole("option", { name: /MP-002500/ })).toBeNull();
    expect(chamadas[0]).toEqual({ active: true, pageSize: 50 });
  });

  it("digitar busca no servidor com o mesmo filtro de negócio da carga inicial", async () => {
    const campo = await abrir();
    fireEvent.change(campo, { target: { value: "Beta-Alanina" } });
    await waitFor(() => expect(buscasPor("Beta-Alanina").length).toBe(1));
    expect(buscasPor("Beta-Alanina")[0]).toEqual({
      active: true,
      search: "Beta-Alanina",
      pageSize: 50,
    });
  });

  it("acha o item fora da primeira página, escolhe pelo id e mantém o rótulo", async () => {
    const campo = await abrir();
    fireEvent.change(campo, { target: { value: "Beta-Alanina" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /MP-002500/ }));

    // A tela consulta o saldo pelo ID do item escolhido, não pelo texto.
    await waitFor(() => expect(getInventoryItem).toHaveBeenCalledWith("it-beta"));
    // E o campo continua rotulado, mesmo o item não estando na primeira página.
    await waitFor(() =>
      expect((campo as HTMLInputElement).value).toBe("MP-002500 · Beta-Alanina"),
    );
  });

  it("item inativo não é contável e continua fora do resultado", async () => {
    const campo = await abrir();
    fireEvent.change(campo, { target: { value: "Beta-Alanina" } });
    await screen.findByRole("option", { name: /MP-002500/ });
    expect(screen.queryByRole("option", { name: /MP-002501/ })).toBeNull();
  });

  it("enquanto a busca está no ar, a lista não diz que nada foi encontrado", async () => {
    segurarBusca = true;
    const campo = await abrir();
    fireEvent.change(campo, { target: { value: "Beta-Alanina" } });

    await waitFor(() => expect(pendentes.length).toBe(1));
    expect(screen.getByText(/Procurando/)).toBeTruthy();
    expect(screen.queryByText(/Nenhum resultado/)).toBeNull();

    await act(async () => {
      pendentes[0]!();
    });
    expect(screen.getByRole("option", { name: /MP-002500/ })).toBeTruthy();
  });

  it("resposta atrasada não sobrescreve o resultado da busca mais recente", async () => {
    segurarBusca = true;
    const campo = await abrir();

    fireEvent.change(campo, { target: { value: "Cafeína" } });
    await waitFor(() => expect(pendentes.length).toBe(1));
    fireEvent.change(campo, { target: { value: "Beta-Alanina" } });
    await waitFor(() => expect(pendentes.length).toBe(2));

    // A mais recente responde primeiro; a antiga chega depois.
    await act(async () => {
      pendentes[1]!();
    });
    await act(async () => {
      pendentes[0]!();
    });

    expect(screen.getByRole("option", { name: /MP-002500/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /MP-002400/ })).toBeNull();
  });
});

function componenteDTO(): FormulationVersionDTO["components"][number] {
  return {
    id: "cmp-1",
    itemId: BETA_USADA.id,
    itemCode: BETA_USADA.code,
    itemName: BETA_USADA.name,
    itemType: "RAW_MATERIAL",
    itemActive: true,
    quantity: "200",
    unitCode: "kg",
    basis: "FIXED_BASIS",
    supplyResponsibility: "VERIDI",
    purityPercentApplied: null,
    overagePercent: null,
    legacyTotalQuantity: null,
    legacyTotalUnitCode: null,
    legacyBatchUnits: null,
    theoreticalPerUnit: null,
    physicalPerUnit: null,
    stockEquivalentQuantity: "200",
    stockUnitCode: "kg",
    notes: null,
    position: 0,
  } as FormulationVersionDTO["components"][number];
}

function versaoDTO(): FormulationVersionDTO {
  return {
    id: "fv-1",
    productId: "prod-1",
    productCode: "PROD-000005",
    productName: "Beta-Alanina 60 cápsulas",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    basisQuantity: "1",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    outputItemId: "pa-1",
    outputItemCode: "PA-000005",
    outputItemName: "Beta-Alanina 60 cápsulas",
    outputUnitCode: "un",
    notes: null,
    components: [componenteDTO()],
    componentIssues: [],
    createdAt: new Date().toISOString(),
    createdBy: "Teste",
    activatedAt: null,
    activatedBy: null,
    inactivatedAt: null,
    inactivatedBy: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    originTemplateVersionId: null,
    originTemplateCode: null,
    originTemplateVersionNumber: null,
    originTemplateName: null,
  };
}

describe("Formulação — busca de matéria-prima no servidor", () => {
  async function abrir() {
    getFormulationVersion.mockResolvedValue(versaoDTO());
    updateFormulationVersion.mockResolvedValue(versaoDTO());
    render(
      <MemoryRouter initialEntries={["/producao/formulacoes/prod-1/versoes/fv-1"]}>
        <Routes>
          <Route
            path="/producao/formulacoes/:productId/versoes/:versionId"
            element={<FormulationVersionPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getAllByText(/PROD-000005/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /Adicionar componente/ }));
    // A linha preenchida mostra o item escolhido no lugar do placeholder, então
    // o texto padrão pertence à linha nova — a que vai procurar.
    const campo = screen.getByPlaceholderText("Digite código ou nome do item…");
    fireEvent.focus(campo);
    await screen.findByRole("option", { name: /MP-000001/ });
    return campo;
  }

  it("a primeira página do catálogo não contém o item procurado", async () => {
    await abrir();
    expect(screen.queryByRole("option", { name: /MP-002500/ })).toBeNull();
    expect(chamadas.slice(0, 2)).toEqual([
      { type: "RAW_MATERIAL", active: true, pageSize: 50 },
      { type: "PACKAGING", active: true, pageSize: 50 },
    ]);
  });

  it("digitar busca no servidor com os mesmos filtros de negócio da carga inicial", async () => {
    const campo = await abrir();
    fireEvent.change(campo, { target: { value: "Beta-Alanina" } });
    await waitFor(() => expect(buscasPor("Beta-Alanina").length).toBe(2));
    expect(buscasPor("Beta-Alanina")).toEqual([
      { type: "RAW_MATERIAL", active: true, search: "Beta-Alanina", pageSize: 50 },
      { type: "PACKAGING", active: true, search: "Beta-Alanina", pageSize: 50 },
    ]);
  });

  it("acha o item fora da primeira página e grava a escolha pelo id", async () => {
    const campo = await abrir();
    fireEvent.change(campo, { target: { value: "Beta-Alanina" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /MP-002500/ }));
    await waitFor(() =>
      expect((campo as HTMLInputElement).value).toBe("MP-002500 · Beta-Alanina"),
    );

    fireEvent.click(screen.getByRole("button", { name: /Salvar rascunho/ }));
    await waitFor(() => expect(updateFormulationVersion).toHaveBeenCalled());
    const enviado = updateFormulationVersion.mock.calls.at(-1)![1] as {
      components: Array<{ itemId: string }>;
    };
    expect(enviado.components.map((linha) => linha.itemId)).toContain("it-beta");
  });

  it("inelegível continua inelegível: inativo, acabado e item de outra linha ficam fora", async () => {
    const campo = await abrir();
    fireEvent.change(campo, { target: { value: "Beta-Alanina" } });
    await screen.findByRole("option", { name: /MP-002500/ });

    // Inativo — o servidor nem devolve, porque a tela pediu `active: true`.
    expect(screen.queryByRole("option", { name: /MP-002501/ })).toBeNull();
    // Produto acabado — fora do filtro de tipo da tela.
    expect(screen.queryByRole("option", { name: /PA-000900/ })).toBeNull();
    // Já consumido por outro componente — regra da tela, e vale na busca.
    expect(screen.queryByRole("option", { name: /MP-002499/ })).toBeNull();
  });

  it("enquanto a busca está no ar, a lista não diz que nada foi encontrado", async () => {
    segurarBusca = true;
    const campo = await abrir();
    fireEvent.change(campo, { target: { value: "Beta-Alanina" } });

    await waitFor(() => expect(pendentes.length).toBe(2));
    expect(screen.getByText(/Procurando/)).toBeTruthy();
    expect(screen.queryByText(/Nenhum resultado/)).toBeNull();

    await act(async () => {
      pendentes[0]!();
      pendentes[1]!();
    });
    expect(screen.getByRole("option", { name: /MP-002500/ })).toBeTruthy();
  });

  it("resposta atrasada não sobrescreve o resultado da busca mais recente", async () => {
    segurarBusca = true;
    const campo = await abrir();

    fireEvent.change(campo, { target: { value: "Cafeína" } });
    await waitFor(() => expect(pendentes.length).toBe(2));
    fireEvent.change(campo, { target: { value: "Beta-Alanina" } });
    await waitFor(() => expect(pendentes.length).toBe(4));

    // A mais recente responde primeiro; a antiga chega depois.
    await act(async () => {
      pendentes[2]!();
      pendentes[3]!();
    });
    await act(async () => {
      pendentes[0]!();
      pendentes[1]!();
    });

    expect(screen.getByRole("option", { name: /MP-002500/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /MP-002400/ })).toBeNull();
  });
});

function amostraDTO(): ProjectSampleDTO {
  return {
    id: "am-1",
    code: "AM-000001",
    externalCode: null,
    projectId: "prj-1",
    projectCode: "PRJ-000001",
    projectName: "Linha esportiva",
    customerId: "cli-1",
    customerName: "Cliente Teste",
    projectProductId: null,
    productId: null,
    productCode: null,
    productName: null,
    testSequence: 1,
    testLabel: "T1",
    status: "DRAFT",
    source: "MANUAL",
    description: null,
    productionNotes: null,
    decisionNotes: null,
    outputQuantity: null,
    outputUomCode: null,
    customerNameSnapshot: null,
    projectCodeSnapshot: null,
    projectNameSnapshot: null,
    qrPayload: "SAMPLE:AM-000001",
    consumptions: [],
    createdAt: new Date().toISOString(),
    createdByName: "Teste",
    startedAt: null,
    startedByName: null,
    producedAt: null,
    producedByName: null,
    approvedAt: null,
    approvedByName: null,
    rejectedAt: null,
    rejectedByName: null,
    cancelledAt: null,
    cancelledByName: null,
  } as ProjectSampleDTO;
}

describe("Amostra — busca de item no servidor", () => {
  async function abrir() {
    getSample.mockResolvedValue(amostraDTO());
    registerSampleConsumption.mockResolvedValue(amostraDTO());
    render(
      <MemoryRouter initialEntries={["/comercial/amostras/am-1"]}>
        <Routes>
          <Route path="/comercial/amostras/:id" element={<SampleDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const campo = await screen.findByPlaceholderText("Digite código ou nome do item…");
    fireEvent.focus(campo);
    await screen.findByRole("option", { name: /MP-000001/ });
    return campo;
  }

  it("a primeira página do catálogo não contém o item procurado", async () => {
    await abrir();
    expect(screen.queryByRole("option", { name: /MP-002500/ })).toBeNull();
    expect(chamadas[0]).toEqual({ active: true, pageSize: 50 });
  });

  it("digitar busca no servidor com o mesmo filtro de negócio da carga inicial", async () => {
    const campo = await abrir();
    fireEvent.change(campo, { target: { value: "Beta-Alanina" } });
    await waitFor(() => expect(buscasPor("Beta-Alanina").length).toBe(1));
    expect(buscasPor("Beta-Alanina")[0]).toEqual({
      active: true,
      search: "Beta-Alanina",
      pageSize: 50,
    });
    expect(await screen.findByRole("option", { name: /MP-002500/ })).toBeTruthy();
  });

  it("acha o item fora da primeira página e o consumo vai pelo id", async () => {
    const campo = await abrir();
    fireEvent.change(campo, { target: { value: "Beta-Alanina" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /MP-002500/ }));

    // Saldo e lote do item escolhido são lidos pelo ID, não pelo texto.
    await waitFor(() => expect(getInventoryItem).toHaveBeenCalledWith("it-beta"));
    // O rótulo sobrevive, e a unidade do item aparece ao lado da quantidade.
    await waitFor(() =>
      expect((campo as HTMLInputElement).value).toBe("MP-002500 · Beta-Alanina"),
    );

    fireEvent.change(screen.getByLabelText(/^Quantidade \(kg\)$/), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /Registrar consumo/ }));

    await waitFor(() => expect(registerSampleConsumption).toHaveBeenCalled());
    const [, enviado] = registerSampleConsumption.mock.calls.at(-1)! as [
      string,
      { itemId: string; quantity: string },
    ];
    expect(enviado.itemId).toBe("it-beta");
  });

  it("item inativo continua fora do resultado", async () => {
    const campo = await abrir();
    fireEvent.change(campo, { target: { value: "Beta-Alanina" } });
    await screen.findByRole("option", { name: /MP-002500/ });
    // Achar não é poder consumir, mas item inativo nem aparece: a tela pediu
    // `active: true` e o servidor obedeceu.
    expect(screen.queryByRole("option", { name: /MP-002501/ })).toBeNull();
  });
});
