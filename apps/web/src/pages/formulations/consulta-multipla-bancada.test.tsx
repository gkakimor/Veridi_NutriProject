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
 * ASSISTED-ENTITY-MULTISELECT-01 — várias matérias-primas e embalagens de uma
 * vez, na Formulação e no Modelo de Formulação.
 *
 * A ação da SEÇÃO abre a consulta com caixas de marcar, no recorte da seção, e
 * cada item marcado vira uma linha nova pelo mesmo caminho da escolha na linha:
 * base derivada, fornecimento padrão, unidade e pureza do cadastro. O que a
 * receita já tem aparece travado. A consulta mostra o que o cadastro sabe para
 * DISTINGUIR registros parecidos — e só o que faz sentido para o tipo: a
 * matéria-prima traz fonte, função e pureza CADASTRADA; a embalagem traz o
 * subtipo, e nunca pureza.
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
import { listItems } from "../../lib/items-api";
import type { ListItemsParams } from "../../lib/items-api";
import { FormulationVersionPage } from "./FormulationVersionPage";
import { FormulationTemplateDetailPage } from "../formulation-templates/FormulationTemplateDetailPage";

const UNIDADES: UnitOfMeasureDTO[] = [
  { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
  { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
  { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
];

function item(parcial: Partial<ItemDTO> & Pick<ItemDTO, "id" | "code" | "name" | "type">): ItemDTO {
  const contagem = parcial.type === "PACKAGING";
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
 * Registros PARECIDOS de propósito: três "L-TRIPTOFANO" (pureza 98%, 90% e
 * sem pureza cadastrada com outra função) e duas "Tampa 38 mm" (tampa e selo).
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
  item({
    id: "trp-98",
    code: "MP-000049",
    name: "L-TRIPTOFANO",
    type: "RAW_MATERIAL",
    sourceName: "L-Triptofano",
    family: "AMINO_ACID",
    declaredNutrient: "Triptofano",
    defaultPurityPercent: "98",
  }),
  item({
    id: "trp-sem-pureza",
    code: "MP-000050",
    name: "L-TRIPTOFANO",
    type: "RAW_MATERIAL",
    family: "OTHER_RAW_MATERIAL",
    declaredNutrient: "Cafeína",
  }),
  item({
    id: "trp-90",
    code: "MP-000051",
    name: "L-TRIPTOFANO",
    type: "RAW_MATERIAL",
    sourceName: "L-Triptofano",
    family: "AMINO_ACID",
    declaredNutrient: "Triptofano",
    defaultPurityPercent: "90",
  }),
  item({ id: "item-499", code: "MP-000499", name: "Proteína bovina", type: "RAW_MATERIAL" }),
  item({ id: "item-inativo", code: "MP-000900", name: "L-TRIPTOFANO antigo", type: "RAW_MATERIAL", active: false }),
  item({ id: "tampa", code: "ME-000100", name: "Tampa 38 mm", type: "PACKAGING", packagingSubtype: "CAP" }),
  item({ id: "selo", code: "ME-000101", name: "Tampa 38 mm", type: "PACKAGING", packagingSubtype: "SEAL" }),
  item({ id: "frasco", code: "ME-000456", name: "Frasco genérico", type: "PACKAGING" }),
  item({ id: "item-pa", code: "PA-000030", name: "Ácido Fólico PT 120 caps", type: "FINISHED_PRODUCT" }),
];

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
    productProfile: null,
    outputItemId: "pa-1",
    outputItemCode: "PA-000030",
    outputItemName: "Ácido Fólico PT 120 caps",
    outputUnitCode: "un",
    notes: null,
    components: [
      {
        id: "cmp-mp",
        itemId: "item-mp",
        itemCode: "MP-000030",
        itemName: "L-metilfolato de cálcio",
        itemType: "RAW_MATERIAL",
        itemActive: true,
        quantity: "0.4",
        unitCode: "mg",
        basis: "PER_DOSE",
        supplyResponsibility: "VERIDI",
        purityPercentApplied: "70",
        overagePercent: null,
        quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
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
      },
    ],
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

async function abrirFormulacao() {
  render(
    <MemoryRouter initialEntries={[ROTA_FORMULACAO]}>
      <Routes>
        <Route
          path="/producao/formulacoes/:productId/versoes/:versionId"
          element={<FormulationVersionPage />}
        />
      </Routes>
      <Localizacao />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getAllByText(/PROD-000030/).length).toBeGreaterThan(0));
}

type Usuario = ReturnType<typeof userEvent.setup>;

/** Aciona a ação da seção e espera a consulta com a primeira página. */
async function consultarSecao(user: Usuario, acao: "+ Adicionar matérias-primas" | "+ Adicionar embalagens", primeiro: string) {
  await user.click(screen.getByRole("button", { name: acao }));
  await screen.findByRole("heading", { name: "Consulta de itens" });
  await caixaAchada(primeiro);
}

const caixa = (codigo: string) =>
  screen.getByRole("checkbox", { name: new RegExp(`^Selecionar ${codigo} · `) });
const caixaAchada = (codigo: string) =>
  screen.findByRole("checkbox", { name: new RegExp(`^Selecionar ${codigo} · `) });
const linhaDaConsulta = (codigo: string) => caixa(codigo).closest("tr")!;
/** O que a linha da consulta diz, fora caixa e código — o que distingue. */
const leituraDaLinha = (codigo: string) =>
  Array.from(linhaDaConsulta(codigo).querySelectorAll("td"))
    .slice(2)
    .map((celula) => celula.textContent)
    .join(" | ");

/** Os seletores de Item das linhas, pelo valor mostrado. */
const itensNaReceita = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>("input[id^='componente-']")).map(
    (campo) => campo.value,
  );

function consultasAoServidor(): ListItemsParams[] {
  return vi.mocked(listItems).mock.calls.map(([params]) => params ?? {});
}

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  sessao.role = "ADMIN";
  vi.mocked(listItems).mockImplementation(servidorDeItens as never);
  vi.mocked(getFormulationVersion).mockResolvedValue(versao());
});

describe("Formulação — + Adicionar matérias-primas", () => {
  it("abre a consulta múltipla no recorte da composição, com as colunas que distinguem matérias-primas", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    await consultarSecao(user, "+ Adicionar matérias-primas", "MP-000049");

    expect(screen.getByText("Tipo: Matéria-prima")).toBeInTheDocument();
    expect(screen.getByText("Situação: somente ativos")).toBeInTheDocument();
    expect(consultasAoServidor()).toContainEqual({ type: "RAW_MATERIAL", active: true, page: 1, pageSize: 20 });
    // Nem inativo, nem produto acabado, nem embalagem.
    expect(screen.queryByText("MP-000900")).toBeNull();
    expect(screen.queryByText("PA-000030")).toBeNull();
    expect(screen.queryByText("ME-000100")).toBeNull();

    const cabecalhos = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(cabecalhos).toEqual(["Marcar", "Código", "Nome", "Fonte / Função", "Pureza cadastrada", "Unidade", "Situação", "Observação"]);
    expect(cabecalhos).not.toContain("Subtipo");

    const triptofano = linhaDaConsulta("MP-000049");
    expect(within(triptofano).getByText("L-Triptofano")).toBeInTheDocument();
    expect(within(triptofano).getByText("Aminoácido · Triptofano")).toBeInTheDocument();
    // Pureza do CADASTRO, com esse nome — não a da formulação.
    expect(within(triptofano).getByText("98%").closest("td")).toHaveAttribute("data-label", "Pureza cadastrada");
    expect(within(triptofano).getByText("kg")).toBeInTheDocument();
    expect(within(triptofano).getByText("Ativo")).toBeInTheDocument();
  });

  it("pureza não cadastrada diz 'Não informada' — nunca vira 0%", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    await consultarSecao(user, "+ Adicionar matérias-primas", "MP-000050");

    const semPureza = linhaDaConsulta("MP-000050");
    const pureza = semPureza.querySelector("td[data-label='Pureza cadastrada']")!;
    expect(pureza).toHaveTextContent(/^Não informada$/);
    expect(semPureza).not.toHaveTextContent("%");
    // Sem fonte, a família e o nutriente sobem para a célula.
    expect(semPureza.querySelector("td[data-label='Fonte / Função']")).toHaveTextContent(
      /^Outra matéria-prima · Cafeína$/,
    );
  });

  it("três 'L-TRIPTOFANO' se distinguem pelo que a consulta mostra: pureza, função", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    await consultarSecao(user, "+ Adicionar matérias-primas", "MP-000049");
    await user.type(screen.getByRole("searchbox", { name: "Buscar itens" }), "triptofano");
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: /^Selecionar MP-000030 / })).toBeNull());
    await caixaAchada("MP-000051");

    const leituras = ["MP-000049", "MP-000050", "MP-000051"].map(leituraDaLinha);
    // Mesmo nome nas três…
    expect(leituras.every((leitura) => leitura.startsWith("L-TRIPTOFANO |"))).toBe(true);
    // …e nenhuma leitura igual à outra.
    expect(new Set(leituras).size).toBe(3);
    expect(leituras[0]).toContain("98%");
    expect(leituras[2]).toContain("90%");
    expect(leituras[1]).toContain("Outra matéria-prima · Cafeína");
  });

  it("marcar 2 cria uma linha por item: pureza do cadastro, fornecimento Veridi, mg da receita por dose — e a pendência aparece", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    await consultarSecao(user, "+ Adicionar matérias-primas", "MP-000049");

    await user.click(caixa("MP-000049"));
    await user.click(caixa("MP-000051"));
    await user.click(screen.getByRole("button", { name: "Adicionar 2 itens" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Consulta de itens" })).toBeNull());
    await waitFor(() =>
      expect(itensNaReceita()).toEqual([
        "MP-000030 · L-metilfolato de cálcio",
        "MP-000049 · L-TRIPTOFANO",
        "MP-000051 · L-TRIPTOFANO",
      ]),
    );
    // Pureza: o snapshot do cadastro, editável na linha.
    expect(screen.getByRole("textbox", { name: "Pureza de MP-000049" })).toHaveValue("98");
    expect(screen.getByRole("textbox", { name: "Pureza de MP-000051" })).toHaveValue("90");
    // Base derivada: receita por dose (cápsula) ⇒ a linha de massa nasce em mg.
    expect(screen.getByRole("combobox", { name: "Unidade de MP-000049" })).toHaveValue("mg");
    expect(screen.getByRole("combobox", { name: "Unidade de MP-000051" })).toHaveValue("mg");
    // Fornecimento padrão do domínio.
    const linhaNova = screen.getByRole("textbox", { name: "Pureza de MP-000049" }).closest("tr")!;
    expect(within(linhaNova).getByRole("combobox", { name: "Responsabilidade de fornecimento" })).toHaveValue(
      "VERIDI",
    );
    // Quantidade fica para a pessoa: nada inventado.
    expect(screen.getByRole("textbox", { name: "Quantidade de MP-000049" })).toHaveValue("");

    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    expect(vi.mocked(getFormulationVersion)).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("url")).toHaveTextContent(ROTA_FORMULACAO);
    // O foco volta à ação da seção.
    expect(screen.getByRole("button", { name: "+ Adicionar matérias-primas" })).toHaveFocus();
  });

  it("o que a receita já tem aparece travado, com o motivo — nunca duplicata", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    await consultarSecao(user, "+ Adicionar matérias-primas", "MP-000030");

    expect(caixa("MP-000030")).toBeDisabled();
    expect(caixa("MP-000030")).toHaveAccessibleDescription("Já adicionado nesta formulação.");
    expect(within(linhaDaConsulta("MP-000030")).getByText("Já adicionado nesta formulação.")).toBeInTheDocument();
  });

  it("Cancelar fecha sem mexer na receita", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    await consultarSecao(user, "+ Adicionar matérias-primas", "MP-000049");
    await user.click(caixa("MP-000049"));
    await user.click(caixa("MP-000051"));

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Consulta de itens" })).toBeNull());
    expect(itensNaReceita()).toEqual(["MP-000030 · L-metilfolato de cálcio"]);
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
  });

  it("a linha continua na seleção ÚNICA: Consultar itens no campo não traz caixa de marcar", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    const campo = document.querySelector<HTMLInputElement>("input[id^='componente-']")!;
    await user.click(campo);
    const listas = document.querySelectorAll("ul[role='listbox']");
    await user.click(within(listas[listas.length - 1] as HTMLElement).getByRole("option", { name: "Consultar itens" }));

    expect(await screen.findByRole("button", { name: /^Selecionar MP-000049/ })).toBeEnabled();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    // Colunas do tipo também na seleção única.
    expect(screen.getByRole("columnheader", { name: "Pureza cadastrada" })).toBeInTheDocument();
  });

  it.each([
    ["ADMIN", true],
    ["COMMERCIAL", false],
  ])("%s: sem + Novo na múltipla; a dica de cadastro só para quem cadastra (%s)", async (role, dica) => {
    sessao.role = role;
    const user = userEvent.setup();
    await abrirFormulacao();
    await consultarSecao(user, "+ Adicionar matérias-primas", "MP-000049");

    expect(screen.queryByRole("button", { name: /Novo item/ })).toBeNull();
    expect(screen.queryByText("Para cadastrar um novo item, use o cadastro individual.") !== null).toBe(dica);
  });
});

describe("Formulação — + Adicionar embalagens", () => {
  it("recorte de embalagem, Subtipo no lugar de Pureza, e as duas 'Tampa 38 mm' se distinguem", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    await consultarSecao(user, "+ Adicionar embalagens", "ME-000100");

    expect(screen.getByText("Tipo: Material de embalagem")).toBeInTheDocument();
    expect(consultasAoServidor()).toContainEqual({ type: "PACKAGING", active: true, page: 1, pageSize: 20 });
    const cabecalhos = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(cabecalhos).toEqual(["Marcar", "Código", "Nome", "Subtipo", "Unidade", "Situação", "Observação"]);
    expect(cabecalhos).not.toContain("Pureza cadastrada");
    expect(cabecalhos).not.toContain("Fonte / Função");

    expect(leituraDaLinha("ME-000100")).toBe("Tampa 38 mm | Tampa | un | Ativo | ");
    expect(leituraDaLinha("ME-000101")).toBe("Tampa 38 mm | Selo | un | Ativo | ");
    // Sem subtipo cadastrado não se inventa um a partir do nome.
    expect(leituraDaLinha("ME-000456")).toBe("Frasco genérico | Não informado | un | Ativo | ");
    const consulta = screen.getByRole("dialog", { name: "Consulta de itens" });
    expect(within(consulta).queryByText(/%/)).toBeNull();
    expect(within(consulta).queryByText(/Pureza/)).toBeNull();
  });

  it("marcar 2 cria duas linhas na Embalagem, sem pureza e com a unidade do item", async () => {
    const user = userEvent.setup();
    await abrirFormulacao();
    await consultarSecao(user, "+ Adicionar embalagens", "ME-000100");
    await user.click(caixa("ME-000100"));
    await user.click(caixa("ME-000101"));
    await user.click(screen.getByRole("button", { name: "Adicionar 2 itens" }));

    await waitFor(() =>
      expect(itensNaReceita()).toEqual([
        "MP-000030 · L-metilfolato de cálcio",
        "ME-000100 · Tampa 38 mm",
        "ME-000101 · Tampa 38 mm",
      ]),
    );
    expect(screen.queryByRole("textbox", { name: "Pureza de ME-000100" })).toBeNull();
    const linhaDaTampa = screen.getByRole("textbox", { name: "Quantidade de ME-000100" }).closest("tr")!;
    expect(within(linhaDaTampa).getByText("un")).toBeInTheDocument();
    expect(within(linhaDaTampa).getByRole("combobox", { name: "Responsabilidade de fornecimento" })).toHaveValue(
      "VERIDI",
    );
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ *
 * Modelo de formulação — a mesma bancada, o mesmo caminho.
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
        itemId: "item-499",
        itemCode: "MP-000499",
        itemName: "Proteína bovina",
        itemType: "RAW_MATERIAL",
        quantity: "10",
        unitCode: "kg",
        supplyResponsibility: "VERIDI",
        sequence: 1,
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

describe("Modelo de formulação — + Adicionar matérias-primas", () => {
  it("cria as linhas pelo mesmo caminho: sem duplicar o que o modelo tem, pureza do cadastro, kg da base fixa e pendência", async () => {
    vi.mocked(getFormulationTemplate).mockResolvedValue(modeloComRascunho());
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/producao/templates-formulacao/tpl-1"]}>
        <Routes>
          <Route path="/producao/templates-formulacao/:templateId" element={<FormulationTemplateDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(itensNaReceita()).toEqual(["MP-000499 · Proteína bovina"]));
    expect(screen.queryByText("Alterações não salvas")).toBeNull();

    await consultarSecao(user, "+ Adicionar matérias-primas", "MP-000499");
    expect(
      screen.getByText(/Modelo de formulação/, { selector: ".modal-fullscreen__crumb" }),
    ).toBeInTheDocument();
    expect(caixa("MP-000499")).toBeDisabled();
    expect(caixa("MP-000499")).toHaveAccessibleDescription("Já adicionado neste modelo.");
    expect(screen.getByRole("columnheader", { name: "Pureza cadastrada" })).toBeInTheDocument();

    await user.click(caixa("MP-000049"));
    await user.click(caixa("MP-000050"));
    await user.click(screen.getByRole("button", { name: "Adicionar 2 itens" }));

    await waitFor(() =>
      expect(itensNaReceita()).toEqual([
        "MP-000499 · Proteína bovina",
        "MP-000049 · L-TRIPTOFANO",
        "MP-000050 · L-TRIPTOFANO",
      ]),
    );
    expect(screen.getByRole("textbox", { name: "Pureza de MP-000049" })).toHaveValue("98");
    // Sem pureza cadastrada, o campo fica vazio — desconhecida, não zero.
    expect(screen.getByRole("textbox", { name: "Pureza de MP-000050" })).toHaveValue("");
    // Base derivada: modelo em base fixa ⇒ a linha nasce na unidade de estoque.
    expect(screen.getByRole("combobox", { name: "Unidade de MP-000049" })).toHaveValue("kg");
    const linhaNova = screen.getByRole("textbox", { name: "Pureza de MP-000049" }).closest("tr")!;
    expect(within(linhaNova).getByRole("combobox", { name: "Responsabilidade de fornecimento" })).toHaveValue(
      "VERIDI",
    );
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();
    expect(vi.mocked(getFormulationTemplate)).toHaveBeenCalledTimes(1);
  });
});
