import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type {
  FormulationTemplateDTO,
  FormulationVersionDTO,
  ItemDTO,
  UnitOfMeasureDTO,
} from "@veridi/shared";

/**
 * ASSISTED-ENTITY-SELECTOR-FOUNDATION-01 — o piloto: Item na bancada.
 *
 * O seletor de matéria-prima e o de embalagem da Formulação (e do Modelo, que
 * usa a mesma bancada) ganham "Consultar itens". O que se protege aqui é o que
 * o PO pediu que não se perca:
 *
 * - o autocomplete continua sendo o caminho rápido;
 * - a consulta abre com o termo digitado e o recorte DO CAMPO (tipo da seção,
 *   só ativos, fora o que outra linha usa) — nada inválido vira escolha;
 * - selecionar devolve o item à linha que pediu, sem navegar, sem recarregar e
 *   sem perder o que não foi salvo;
 * - "+ Novo item de estoque" só para quem cadastra Item, e é a criação no
 *   contexto de sempre: volta com o item escolhido na linha;
 * - Escape fecha só a consulta.
 */

const sessao = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: sessao.role } });
  return { useAuth: valor, useOptionalAuth: valor };
});
vi.mock("../../lib/formulations-api", () => ({
  getFormulationVersion: vi.fn(),
  updateFormulationVersion: vi.fn(),
  activateFormulationVersion: vi.fn(),
  createNewFormulationVersion: vi.fn(),
  getFormulationActivationImpact: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../../lib/formulation-templates-api", () => ({
  getFormulationTemplate: vi.fn(),
  updateFormulationTemplate: vi.fn(),
  updateFormulationTemplateVersion: vi.fn(),
  activateFormulationTemplateVersion: vi.fn(),
  createTemplateVersionFrom: vi.fn(),
  setFormulationTemplateArchived: vi.fn(),
  compareTemplateVersions: vi.fn(),
}));
vi.mock("../../lib/items-api", () => ({ listItems: vi.fn(), getItem: vi.fn() }));
vi.mock("../../lib/units-api", () => ({ listUnits: () => Promise.resolve(UNIDADES) }));
vi.mock("../../lib/costs-api", () => ({ getFormulationCostEstimate: () => Promise.resolve(null) }));

import { getFormulationVersion } from "../../lib/formulations-api";
import { getFormulationTemplate } from "../../lib/formulation-templates-api";
import { getItem, listItems } from "../../lib/items-api";
import type { ListItemsParams } from "../../lib/items-api";
import { PARAM_ORIGEM, readContextualCreate } from "../../lib/contextual-create";
import { useContextualCreateTarget } from "../../lib/use-contextual-create";
import { FormulationVersionPage } from "./FormulationVersionPage";
import { FormulationTemplateDetailPage } from "../formulation-templates/FormulationTemplateDetailPage";

const UNIDADES: UnitOfMeasureDTO[] = [
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
  { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
];

function item(parcial: Partial<ItemDTO> & Pick<ItemDTO, "id" | "code" | "name" | "type">): ItemDTO {
  const contagem = parcial.type === "PACKAGING" || parcial.type === "FINISHED_PRODUCT";
  return {
    unitCode: contagem ? "un" : "kg",
    unit: contagem
      ? { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" }
      : { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
    active: true,
    sourceName: null,
    declaredNutrient: null,
    family: null,
    packagingSubtype: null,
    defaultPurityPercent: null,
    externalCode: null,
    ...parcial,
  } as unknown as ItemDTO;
}

/**
 * O catálogo do servidor. Sessenta matérias-primas além das duas da receita:
 * a primeira página do seletor (50) não chega às últimas, e é de lá que a
 * consulta traz o item "de fora do catálogo".
 */
const CATALOGO: ItemDTO[] = [
  item({
    id: "item-mp",
    code: "MP-000030",
    name: "L-metilfolato de cálcio",
    type: "RAW_MATERIAL",
    declaredNutrient: "Folato",
    defaultPurityPercent: "88.7",
  }),
  item({ id: "item-sem-pureza", code: "MP-000499", name: "Proteína bovina", type: "RAW_MATERIAL" }),
  ...Array.from({ length: 60 }, (_, indice) =>
    item({
      id: `item-rib-${1001 + indice}`,
      code: `MP-00${1001 + indice}`,
      name: `Riboflavina lote ${1001 + indice}`,
      type: "RAW_MATERIAL",
    }),
  ),
  item({ id: "item-inativo", code: "MP-000900", name: "Riboflavina antiga", type: "RAW_MATERIAL", active: false }),
  item({ id: "item-emb", code: "ME-000455", name: "Pote R220", type: "PACKAGING" }),
  item({ id: "item-pa", code: "PA-000030", name: "Ácido Fólico PT 120 caps", type: "FINISHED_PRODUCT" }),
];

const ITEM_NOVO = item({ id: "item-novo", code: "MP-000777", name: "Creatina monoidratada", type: "RAW_MATERIAL" });

/** O servidor de mentira: filtra por tipo, situação e termo, ordena por código e pagina. */
function servidorDeItens(params: ListItemsParams = {}) {
  const termo = params.search?.toLowerCase();
  const filtrados = CATALOGO.filter(
    (candidato) =>
      (!params.type || candidato.type === params.type) &&
      (params.active === undefined || candidato.active === params.active) &&
      (!termo ||
        candidato.code.toLowerCase().includes(termo) ||
        candidato.name.toLowerCase().includes(termo)),
  ).sort((a, b) => a.code.localeCompare(b.code));
  const pagina = params.page ?? 1;
  const tamanho = params.pageSize ?? 20;
  return Promise.resolve({
    items: filtrados.slice((pagina - 1) * tamanho, pagina * tamanho),
    page: pagina,
    pageSize: tamanho,
    total: filtrados.length,
  });
}

function materiaPrima(overrides: Record<string, unknown> = {}) {
  return {
    id: "cmp-mp",
    itemId: "item-mp",
    itemCode: "MP-000030",
    itemName: "L-metilfolato de cálcio",
    itemType: "RAW_MATERIAL" as const,
    itemActive: true,
    quantity: "0.4",
    unitCode: "mg",
    basis: "PER_DOSE" as const,
    supplyResponsibility: "VERIDI" as const,
    purityPercentApplied: "70",
    overagePercent: null,
    quantityMode: "THEORETICAL_WITH_ADJUSTMENTS" as const,
    applyPurityAdjustment: true,
    applyOverageAdjustment: false,
    legacyTotalQuantity: null,
    legacyTotalUnitCode: null,
    legacyBatchUnits: null,
    theoreticalPerUnit: "0.000048",
    physicalPerUnit: "0.00006857142857142857",
    stockUnitCode: "kg",
    itemSourceName: null,
    itemDeclaredNutrient: "Folato",
    itemFamily: null,
    itemPackagingSubtype: null,
    itemDefaultPurityPercent: "88.7",
    itemExternalCode: null,
    theoreticalPerDose: "0.4",
    physicalPerDose: "0.571428571428571428",
    physicalPerCapsule: "0.571428571428571428",
    notes: null,
    position: 0,
    ...overrides,
  };
}

function versao(): FormulationVersionDTO {
  return {
    id: "fv-1",
    productId: "prod-1",
    productCode: "PROD-000030",
    productName: "Ácido Fólico PT 120 caps",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    basisQuantity: "1",
    calculationMode: "PER_DOSE",
    dosesPerPackage: 120,
    dosageForm: "CAPSULE",
    presentationType: "POT",
    capsulesPerDose: 1,
    capsulesPerPackage: 120,
    doseAmount: null,
    doseUomCode: null,
    packageContentAmount: null,
    packageContentUomCode: null,
    productProfile: {
      dosageForm: "CAPSULE",
      presentationType: "POT",
      capsulesPerDose: 1,
      doseAmount: null,
      doseUomCode: null,
      dosesPerPackage: 120,
      targetAgeGroup: null,
      minimumBatchQuantity: null,
      unitsPerShippingBox: null,
    },
    outputItemId: "pa-1",
    outputItemCode: "PA-000030",
    outputItemName: "Ácido Fólico PT 120 caps",
    outputUnitCode: "un",
    notes: null,
    components: [materiaPrima()],
    componentIssues: [],
    createdAt: new Date().toISOString(),
    createdBy: "Teste",
    activatedAt: null,
  } as unknown as FormulationVersionDTO;
}

const ROTA_FORMULACAO = "/producao/formulacoes/prod-1/versoes/fv-1";

function Localizacao() {
  const location = useLocation();
  return <span data-testid="url">{`${location.pathname}${location.search}`}</span>;
}

/**
 * A tela oficial de cadastro, reduzida ao que importa aqui: o MESMO hook de
 * volta que a `ItemCreatePage` usa. Salvar devolve o item à origem.
 */
function CadastroDeItem() {
  const contexto = useContextualCreateTarget("item");
  const tipo = new URLSearchParams(useLocation().search).get("tipo");
  return (
    <div>
      <h1>Cadastro de item</h1>
      <p>Tipo sugerido: {tipo}</p>
      <button
        type="button"
        onClick={() => contexto.completeAndReturn({ entityId: ITEM_NOVO.id, label: ITEM_NOVO.name })}
      >
        Salvar item
      </button>
    </div>
  );
}

async function abrirFormulacao() {
  render(
    <MemoryRouter initialEntries={[ROTA_FORMULACAO]}>
      <Routes>
        <Route
          path="/producao/formulacoes/:productId/versoes/:versionId"
          element={<FormulationVersionPage />}
        />
        <Route path="/cadastros/itens/novo" element={<CadastroDeItem />} />
      </Routes>
      <Localizacao />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getAllByText(/PROD-000030/).length).toBeGreaterThan(0));
}

/** A lista aberta do seletor — vai ao `body` por portal; a última é a da tela. */
function listaDoSeletor(): HTMLElement | null {
  const listas = document.querySelectorAll("ul[role='listbox']");
  return (listas[listas.length - 1] as HTMLElement | undefined) ?? null;
}

type Usuario = ReturnType<typeof userEvent.setup>;

/** Linha nova na seção, e o seletor dela. */
async function linhaNova(user: Usuario, secao: "matéria-prima" | "embalagem"): Promise<HTMLInputElement> {
  await user.click(
    screen.getByRole("button", {
      name: secao === "matéria-prima" ? /Adicionar matéria-prima/ : /Adicionar embalagem/,
    }),
  );
  return screen.getByPlaceholderText(
    secao === "matéria-prima"
      ? /Buscar matéria-prima por código ou nome/
      : /Buscar embalagem por código ou nome/,
  ) as HTMLInputElement;
}

/** Digita (se houver termo) e aciona "Consultar itens" na lista do seletor. */
async function consultar(user: Usuario, campo: HTMLElement, termo = "") {
  if (termo) await user.type(campo, termo);
  else await user.click(campo);
  const lista = listaDoSeletor();
  expect(lista, "lista do seletor não abriu").not.toBeNull();
  await user.click(within(lista!).getByRole("option", { name: "Consultar itens" }));
  return screen.findByRole("heading", { name: "Consulta de itens" });
}

function consultasAoServidor(): ListItemsParams[] {
  return vi.mocked(listItems).mock.calls.map(([params]) => params ?? {});
}

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  sessao.role = "ADMIN";
  vi.mocked(listItems).mockImplementation(servidorDeItens as never);
  vi.mocked(getItem).mockResolvedValue(ITEM_NOVO);
  vi.mocked(getFormulationVersion).mockResolvedValue(versao());
});

describe("Formulação — Consultar itens na bancada", () => {
  it("o autocomplete continua: a lista oferece Consultar, o cadastro e os resultados, e escolher segue igual", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    const campo = await linhaNova(user, "matéria-prima");
    await user.click(campo);

    await waitFor(() =>
      expect(within(listaDoSeletor()!).queryByRole("option", { name: /^MP-000499/ })).not.toBeNull(),
    );
    const opcoes = within(listaDoSeletor()!).getAllByRole("option");
    expect(opcoes[0]).toHaveTextContent("Consultar itens");
    expect(opcoes[1]).toHaveTextContent("+ Novo item de estoque");

    await user.click(within(listaDoSeletor()!).getByRole("option", { name: /^MP-000499/ }));
    await waitFor(() => expect(campo).toHaveValue("MP-000499 · Proteína bovina"));
    expect(screen.queryByRole("heading", { name: "Consulta de itens" })).toBeNull();
  });

  it("abre com o termo digitado e o recorte da matéria-prima, perguntado ao servidor", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    const campo = await linhaNova(user, "matéria-prima");
    await consultar(user, campo, "ribof");

    const busca = screen.getByRole("searchbox", { name: "Buscar itens" });
    expect(busca).toHaveValue("ribof");
    expect(screen.getByText("Tipo: Matéria-prima")).toBeInTheDocument();
    expect(screen.getByText("Situação: somente ativos")).toBeInTheDocument();
    await waitFor(() =>
      expect(consultasAoServidor()).toContainEqual({
        type: "RAW_MATERIAL",
        active: true,
        search: "ribof",
        page: 1,
        pageSize: 20,
      }),
    );
    // Só o que o campo aceita: nem o inativo, nem produto acabado, nem embalagem.
    expect(await screen.findByRole("button", { name: /^Selecionar MP-001001/ })).toBeEnabled();
    expect(screen.queryByText("MP-000900")).toBeNull();
    expect(screen.queryByText("PA-000030")).toBeNull();
    expect(screen.queryByText("ME-000455")).toBeNull();
    // A trilha diz de onde a consulta foi aberta.
    expect(screen.getByText(/Formulação/, { selector: ".modal-fullscreen__crumb" })).toBeInTheDocument();
  });

  it("na Embalagem, a consulta pede embalagem", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    const campo = await linhaNova(user, "embalagem");
    await consultar(user, campo);

    expect(screen.getByText("Tipo: Material de embalagem")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /^Selecionar ME-000455/ })).toBeEnabled();
    expect(consultasAoServidor()).toContainEqual({ type: "PACKAGING", active: true, page: 1, pageSize: 20 });
    expect(screen.queryByText("MP-000030")).toBeNull();
  });

  it("registro fora do recorte que chegue mesmo assim não vira escolha", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    const campo = await linhaNova(user, "matéria-prima");
    // Um servidor que ignorasse o filtro: a segunda trava é da tela.
    vi.mocked(listItems).mockImplementation((async (params?: ListItemsParams) =>
      params?.pageSize === 20
        ? {
            items: [CATALOGO.find((candidato) => candidato.code === "PA-000030")!],
            page: 1,
            pageSize: 20,
            total: 1,
          }
        : servidorDeItens(params)) as never);
    await consultar(user, campo);

    const botao = await screen.findByRole("button", { name: /^Selecionar PA-000030/ });
    expect(botao).toBeDisabled();
    expect(screen.getByText("Este campo aceita só Matéria-prima.")).toBeInTheDocument();
  });

  it("selecionar devolve à linha um item de fora do catálogo do seletor — sem recarregar e sem perder o que não foi salvo", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();

    // Alteração pendente antes da consulta.
    const reserva = screen.getByRole("textbox", { name: /Reserva % de MP-000030/ });
    await user.type(reserva, "10");
    expect(await screen.findByText("Alterações não salvas")).toBeInTheDocument();

    const campo = await linhaNova(user, "matéria-prima");
    await consultar(user, campo);
    // O termo vai DENTRO da consulta: o seletor nunca perguntou por ele, então
    // MP-001060 não está no catálogo da tela quando é escolhido.
    await user.type(screen.getByRole("searchbox", { name: "Buscar itens" }), "MP-00106");
    await user.click(await screen.findByRole("button", { name: /^Selecionar MP-001060/ }));
    expect(consultasAoServidor().some((params) => params.pageSize !== 20 && params.search)).toBe(false);

    // A consulta fecha e o item está na linha, com a unidade de estoque dele.
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Consulta de itens" })).toBeNull());
    await waitFor(() => expect(campo).toHaveValue("MP-001060 · Riboflavina lote 1060"));
    expect(campo.closest("td")!.textContent).toContain("Estoque em kg");
    // A tela é a mesma: nada recarregou, nada navegou, a pendência continua.
    expect(screen.getByRole("textbox", { name: /Reserva % de MP-000030/ })).toHaveValue("10");
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    expect(vi.mocked(getFormulationVersion)).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("url")).toHaveTextContent(ROTA_FORMULACAO);
    // O foco devolvido ao campo não reabre a lista por cima da tela.
    expect(listaDoSeletor()).toBeNull();
  });

  it("o item que outra linha já usa aparece desabilitado, com o motivo", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    const campo = await linhaNova(user, "matéria-prima");
    await consultar(user, campo, "MP-000030");

    expect(await screen.findByRole("button", { name: /^Selecionar MP-000030/ })).toBeDisabled();
    expect(screen.getByText("Já está em outra linha desta receita.")).toBeInTheDocument();
  });

  it("reescolher na consulta o item da própria linha não reaplica a pureza do cadastro", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    const campo = document.querySelector<HTMLInputElement>("input[id^='componente-']")!;
    expect(screen.getByRole("textbox", { name: /Pureza de MP-000030/ })).toHaveValue("70");

    await consultar(user, campo, "MP-000030");
    await user.click(await screen.findByRole("button", { name: /^Selecionar MP-000030/ }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Consulta de itens" })).toBeNull());
    // A versão declarou 70%; o cadastro diz 88,7%. Nada mudou.
    expect(screen.getByRole("textbox", { name: /Pureza de MP-000030/ })).toHaveValue("70");
  });

  it("pagina no servidor sem soltar o recorte nem o termo", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    const campo = await linhaNova(user, "matéria-prima");
    await consultar(user, campo, "riboflavina lote");

    expect(await screen.findByText("Página 1 de 3")).toBeInTheDocument();
    expect(screen.getByText("60 itens")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Próxima" }));

    expect(await screen.findByRole("button", { name: /^Selecionar MP-001021/ })).toBeInTheDocument();
    expect(consultasAoServidor()).toContainEqual({
      type: "RAW_MATERIAL",
      active: true,
      search: "riboflavina lote",
      page: 2,
      pageSize: 20,
    });
  });

  it("Escape fecha só a consulta: a Formulação fica, e o foco volta ao campo sem reabrir a lista", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    const campo = await linhaNova(user, "matéria-prima");
    await consultar(user, campo, "ribof");
    expect(screen.getByRole("searchbox", { name: "Buscar itens" })).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Consulta de itens" })).toBeNull());
    expect(screen.getAllByText(/PROD-000030/).length).toBeGreaterThan(0);
    expect(campo).toHaveFocus();
    expect(campo).toHaveValue("");
    expect(listaDoSeletor()).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("Formulação — criar a partir da consulta", () => {
  it.each(["COMMERCIAL", "VIEWER"])(
    "%s não cadastra Item: a consulta não oferece + Novo, e diz a quem pedir",
    async (role) => {
      sessao.role = role;
      const user = userEvent.setup();
      await abrirFormulacao();
      const campo = await linhaNova(user, "matéria-prima");
      await consultar(user, campo, "não existe");

      expect(await screen.findByText(/Nenhum item encontrado\. Solicite a/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Novo item de estoque/ })).toBeNull();
    },
  );

  it.each(["PURCHASING", "QUALITY", "PRODUCTION", "ADMIN"])(
    "%s cadastra Item: a consulta oferece + Novo item de estoque",
    async (role) => {
      sessao.role = role;
      const user = userEvent.setup();
      await abrirFormulacao();
      const campo = await linhaNova(user, "matéria-prima");
      await consultar(user, campo, "não existe");

      expect(await screen.findByRole("button", { name: "+ Novo item de estoque" })).toBeInTheDocument();
    },
  );

  it("+ Novo sai para o cadastro oficial com o tipo da seção; salvar volta com o item escolhido na linha e a pendência intacta", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    const reserva = screen.getByRole("textbox", { name: /Reserva % de MP-000030/ });
    await user.type(reserva, "10");

    const campo = await linhaNova(user, "matéria-prima");
    const chaveDaLinha = campo.id.replace(/^componente-/, "");
    await consultar(user, campo, "creatina");
    await user.click(await screen.findByRole("button", { name: "+ Novo item de estoque" }));

    // Saiu para a tela oficial, com o tipo sugerido e a linha que pediu guardada.
    expect(await screen.findByRole("heading", { name: "Cadastro de item" })).toBeInTheDocument();
    expect(screen.getByText("Tipo sugerido: RAW_MATERIAL")).toBeInTheDocument();
    const busca = new URLSearchParams(screen.getByTestId("url").textContent!.split("?")[1]);
    const registro = readContextualCreate(busca.get(PARAM_ORIGEM));
    expect(registro?.entityType).toBe("item");
    expect(registro?.context).toEqual({ rowKey: chaveDaLinha });
    expect(document.body.style.overflow).toBe("");

    await user.click(screen.getByRole("button", { name: "Salvar item" }));

    // De volta: o item novo na linha que pediu, e o que não estava salvo voltou junto.
    await waitFor(() =>
      expect(screen.getByPlaceholderText("MP-000777 · Creatina monoidratada")).toBeInTheDocument(),
    );
    expect(screen.getByRole("textbox", { name: /Reserva % de MP-000030/ })).toHaveValue("10");
    expect(vi.mocked(getItem)).toHaveBeenCalledWith("item-novo");
  });
});

/* ------------------------------------------------------------------ *
 * Modelo de formulação — a mesma bancada.
 * ------------------------------------------------------------------ */

function modeloComRascunho(): FormulationTemplateDTO {
  const versaoDoModelo = {
    id: "ver-1",
    formulationTemplateId: "tpl-1",
    templateCode: "TPL-000001",
    templateName: "Base proteica",
    versionNumber: 1,
    versionLabel: "V1",
    status: "DRAFT",
    basisQuantity: "1",
    calculationMode: "FIXED_BASIS",
    dosesPerPackage: null,
    outputUnitCode: "kg",
    notes: null,
    components: [
      {
        id: "comp-1",
        itemId: "item-sem-pureza",
        itemCode: "MP-000499",
        itemName: "Proteína bovina",
        quantity: "10",
        unitCode: "kg",
        supplyResponsibility: "VERIDI",
        sequence: 1,
      },
      {
        id: "comp-2",
        itemId: "",
        itemCode: "",
        itemName: "",
        quantity: "",
        unitCode: "",
        supplyResponsibility: "VERIDI",
        sequence: 2,
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    activatedAt: null,
    activatedBy: null,
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    usageCount: 0,
    componentIssues: [],
  };
  return {
    id: "tpl-1",
    code: "TPL-000001",
    name: "Base proteica",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: null,
    draftVersion: versaoDoModelo,
    versions: [versaoDoModelo],
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as FormulationTemplateDTO;
}

describe("Modelo de formulação — a mesma consulta", () => {
  it("a linha do Modelo consulta e recebe o item escolhido", async () => {
    vi.mocked(getFormulationTemplate).mockResolvedValue(modeloComRascunho());
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/producao/templates-formulacao/tpl-1"]}>
        <Routes>
          <Route path="/producao/templates-formulacao/:templateId" element={<FormulationTemplateDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(document.querySelectorAll("input[id^='componente-']")).toHaveLength(2),
    );
    const campo = document.querySelectorAll<HTMLInputElement>("input[id^='componente-']")[1]!;

    await consultar(user, campo);
    await user.type(screen.getByRole("searchbox", { name: "Buscar itens" }), "MP-00105");
    expect(
      screen.getByText(/Modelo de formulação/, { selector: ".modal-fullscreen__crumb" }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /^Selecionar MP-001055/ }));

    await waitFor(() => expect(campo).toHaveValue("MP-001055 · Riboflavina lote 1055"));
    expect(screen.queryByRole("heading", { name: "Consulta de itens" })).toBeNull();
    expect(vi.mocked(getFormulationTemplate)).toHaveBeenCalledTimes(1);
  });
});
