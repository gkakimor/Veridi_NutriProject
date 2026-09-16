import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type {
  FormulationComponentIssueDTO,
  FormulationTemplateComponentDTO,
  FormulationTemplateDTO,
  FormulationTemplateDiffDTO,
  FormulationTemplateVersionDTO,
  FormulationVersionDTO,
} from "@veridi/shared";

/**
 * FORMULATION-TEMPLATE-WORKBENCH-01 (fatia 3) — as BORDAS do Modelo na tela.
 *
 * - a interface diz MODELO: nenhuma superfície tocada mostra "template";
 * - o diálogo de aplicar avisa ANTES, nomeando cada item, e ainda deixa gerar
 *   o rascunho (decisão D-6);
 * - o rascunho do Modelo diz o que barra a ativação; a ativa, sem rascunho,
 *   avisa quem vai aplicá-la;
 * - o seletor não oferece o que a API recusaria, e o item histórico inativo
 *   continua à vista, marcado;
 * - a comparação explica as premissas com rótulos da tela;
 * - com rascunho aberto, a bancada é do rascunho e a ativa continua existindo;
 * - a barra fixa do Modelo continua a da fatia 2.
 */

const listFormulationTemplates = vi.fn();
const getFormulationTemplate = vi.fn();
const activateFormulationTemplateVersion = vi.fn();
const compareTemplateVersions = vi.fn();
const getTemplateUpdateAvailable = vi.fn();
const compareFormulationWithTemplate = vi.fn();

vi.mock("../../lib/formulation-templates-api", () => ({
  listFormulationTemplates: (...a: unknown[]) => listFormulationTemplates(...a),
  getFormulationTemplate: (...a: unknown[]) => getFormulationTemplate(...a),
  createFormulationTemplate: vi.fn(),
  activateFormulationTemplateVersion: (...a: unknown[]) => activateFormulationTemplateVersion(...a),
  createTemplateVersionFrom: vi.fn(),
  updateFormulationTemplateVersion: vi.fn(),
  updateFormulationTemplate: vi.fn(),
  setFormulationTemplateArchived: vi.fn(),
  compareTemplateVersions: (...a: unknown[]) => compareTemplateVersions(...a),
  applyTemplateToProduct: vi.fn(),
  compareFormulationWithTemplate: (...a: unknown[]) => compareFormulationWithTemplate(...a),
  createTemplateFromFormulation: vi.fn(),
  getTemplateUpdateAvailable: (...a: unknown[]) => getTemplateUpdateAvailable(...a),
}));

/*
 * O catálogo devolve, na busca de matéria-prima, o que o servidor NÃO deveria
 * mandar: um item inativo e um produto acabado. É a prova de que a bancada
 * confere por conta própria — um item cadastrado no meio do caminho entra no
 * catálogo sem passar pelo filtro do servidor.
 */
function itemDoCatalogo(
  id: string,
  code: string,
  name: string,
  type: "RAW_MATERIAL" | "PACKAGING" | "FINISHED_PRODUCT",
  active = true,
) {
  const contagem = type === "RAW_MATERIAL" ? false : true;
  return {
    id,
    code,
    name,
    type,
    unitCode: contagem ? "un" : "kg",
    unit: { code: contagem ? "un" : "kg", dimension: contagem ? "COUNT" : "MASS" },
    defaultPurityPercent: null,
    active,
    sourceName: null,
    declaredNutrient: null,
    family: null,
    packagingSubtype: null,
    externalCode: null,
  };
}

vi.mock("../../lib/items-api", () => ({
  listItems: (params: { type?: string }) =>
    Promise.resolve({
      items:
        params.type === "PACKAGING"
          ? [itemDoCatalogo("i2", "EM-000001", "Pote 300 g", "PACKAGING")]
          : [
              itemDoCatalogo("i1", "MP-000001", "Biotina", "RAW_MATERIAL"),
              itemDoCatalogo("i5", "MP-000002", "Colágeno", "RAW_MATERIAL"),
              itemDoCatalogo("i3", "MP-000009", "Colina antiga", "RAW_MATERIAL", false),
              itemDoCatalogo("i4", "PA-000001", "Biotina acabada", "FINISHED_PRODUCT"),
            ],
    }),
  getItem: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({
  listUnits: () =>
    Promise.resolve([
      { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
      { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
      { code: "g", label: "Grama", dimension: "MASS", toBaseFactor: "1" },
      { code: "mg", label: "Miligrama", dimension: "MASS", toBaseFactor: "0.001" },
    ]),
}));
vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Admin", role: "ADMIN" } }),
}));

import { FormulationTemplateDetailPage } from "./FormulationTemplateDetailPage";
import { FormulationTemplatesPage } from "./FormulationTemplatesPage";
import { FormulationTemplateOrigin } from "./FormulationTemplateOrigin";
import { UseTemplateDialog } from "./UseTemplateDialog";

function componente(
  overrides: Partial<FormulationTemplateComponentDTO> = {},
): FormulationTemplateComponentDTO {
  return {
    id: "c1",
    itemId: "i1",
    itemCode: "MP-000001",
    itemName: "Biotina",
    itemType: "RAW_MATERIAL",
    itemActive: true,
    stockUnitCode: "kg",
    itemSourceName: null,
    itemDeclaredNutrient: null,
    itemFamily: null,
    itemPackagingSubtype: null,
    itemDefaultPurityPercent: null,
    itemExternalCode: null,
    quantity: "500",
    unitCode: "mg",
    basis: "PER_DOSE",
    supplyResponsibility: "VERIDI",
    purityPercentApplied: "98",
    overagePercent: "10",
    quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
    applyPurityAdjustment: true,
    applyOverageAdjustment: false,
    notes: null,
    position: 0,
    ...overrides,
  };
}

const colinaInativa = () =>
  componente({
    id: "c9",
    itemId: "i3",
    itemCode: "MP-000009",
    itemName: "Colina antiga",
    itemActive: false,
    position: 1,
  });

const pendenciaDaColina: FormulationComponentIssueDTO = {
  itemId: "i3",
  itemCode: "MP-000009",
  itemName: "Colina antiga",
  code: "ITEM_INACTIVE",
  description: "MP-000009 foi inativado no cadastro de itens.",
};

function versao(overrides: Partial<FormulationTemplateVersionDTO> = {}): FormulationTemplateVersionDTO {
  return {
    id: "ftv-4",
    formulationTemplateId: "ft-1",
    templateCode: "FT-000008",
    templateName: "Biotina — Cápsulas Base",
    versionNumber: 4,
    versionLabel: "V4",
    status: "DRAFT",
    basisQuantity: "1",
    calculationMode: "PER_DOSE",
    dosesPerPackage: 60,
    dosageForm: "CAPSULE",
    presentationType: "POT",
    capsulesPerDose: 2,
    capsulesPerPackage: 120,
    doseAmount: null,
    doseUomCode: null,
    packageContentAmount: null,
    packageContentUomCode: null,
    expectedLossPercent: "3",
    outputUnitCode: "un",
    notes: null,
    components: [componente()],
    createdAt: "2026-08-20T00:00:00.000Z",
    createdBy: "Admin",
    activatedAt: null,
    activatedBy: null,
    archivedAt: null,
    sourceVersionId: null,
    sourceVersionNumber: null,
    usageCount: 0,
    componentIssues: [],
    ...overrides,
  };
}

function modelo(
  rascunho: FormulationTemplateVersionDTO | null,
  ativa: FormulationTemplateVersionDTO | null = null,
): FormulationTemplateDTO {
  return {
    id: "ft-1",
    code: "FT-000008",
    name: "Biotina — Cápsulas Base",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: ativa,
    draftVersion: rascunho,
    versions: [ativa, rascunho].filter((v): v is FormulationTemplateVersionDTO => v !== null),
    createdAt: "2026-08-20T00:00:00.000Z",
    createdBy: "Admin",
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
}

async function abrirDetalhe(dto: FormulationTemplateDTO) {
  getFormulationTemplate.mockResolvedValue(dto);
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route path="/producao/templates-formulacao/:templateId" element={<FormulationTemplateDetailPage />} />,
    ),
    { initialEntries: ["/producao/templates-formulacao/ft-1"] },
  );
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByRole("heading", { name: /Identificação/ })).toBeInTheDocument());
}

/** Nenhum texto que a pessoa lê diz "template" — nem nos atributos lidos em voz alta. */
function semTemplateVisivel() {
  expect(document.body.textContent ?? "").not.toMatch(/template/i);
  for (const elemento of document.body.querySelectorAll("*")) {
    for (const atributo of ["aria-label", "placeholder", "title", "alt"]) {
      const valor = elemento.getAttribute(atributo);
      if (valor) expect(valor, `${atributo} de <${elemento.tagName}>`).not.toMatch(/template/i);
    }
  }
}

const composicao = () => {
  const cabecalho = screen.getByRole("heading", { name: /^Composição/ });
  return (cabecalho.closest("section") ?? cabecalho.parentElement?.parentElement) as HTMLElement;
};

/**
 * Abre o seletor de uma linha e devolve o que a lista oferece — depois de o
 * catálogo chegar (o MP-000002 elegível é a prova de que ele chegou).
 */
async function opcoesDoSeletor(combobox: HTMLElement) {
  fireEvent.focus(combobox);
  const lista = await screen.findByRole("listbox");
  await within(lista).findByText("MP-000002");
  return within(lista)
    .queryAllByRole("option")
    .map((opcao) => opcao.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  listFormulationTemplates.mockResolvedValue({
    templates: [
      {
        id: "ft-1",
        code: "FT-000008",
        name: "Biotina — Cápsulas Base",
        description: null,
        archived: false,
        activeVersionId: "ftv-3",
        activeVersionNumber: 3,
        basisQuantity: "1",
        outputUnitCode: "un",
        calculationMode: "PER_DOSE",
        componentCount: 2,
        componentItemCodes: ["MP-000001", "MP-000009"],
        hasDraft: false,
        updatedAt: "2026-08-20T00:00:00.000Z",
      },
    ],
    page: 1,
    pageSize: 20,
    total: 1,
  });
  getTemplateUpdateAvailable.mockResolvedValue(null);
});

describe("Nomenclatura — a tela diz Modelo", () => {
  it("biblioteca, detalhe e diálogo de aplicar não mostram \"template\"", async () => {
    const { unmount } = render(
      <MemoryRouter>
        <FormulationTemplatesPage />
      </MemoryRouter>,
    );
    await screen.findByText("FT-000008");
    fireEvent.click(screen.getByRole("button", { name: "Novo modelo" }));
    expect(screen.getByLabelText("Nome do modelo")).toBeInTheDocument();
    semTemplateVisivel();
    unmount();

    const ativa = versao({ id: "ftv-3", versionNumber: 3, versionLabel: "V3", status: "ACTIVE", usageCount: 2 });
    const rascunho = versao({ sourceVersionId: "ftv-3", sourceVersionNumber: 3 });
    await abrirDetalhe(modelo(rascunho, ativa));
    await screen.findByRole("textbox", { name: "Quantidade de MP-000001" });
    semTemplateVisivel();
  });

  it("o diálogo de aplicar, da lista à revisão, diz modelo", async () => {
    getFormulationTemplate.mockResolvedValue(
      modelo(null, versao({ id: "ftv-3", status: "ACTIVE", versionLabel: "V3" })),
    );
    render(
      <MemoryRouter>
        <UseTemplateDialog onCancel={vi.fn()} onApply={vi.fn()} saving={false} />
      </MemoryRouter>,
    );
    await screen.findByText("FT-000008");
    expect(screen.getByRole("heading", { name: "Usar modelo da biblioteca" })).toBeInTheDocument();
    semTemplateVisivel();

    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    await screen.findByRole("button", { name: "Usar este modelo" });
    semTemplateVisivel();
  });

  it("a proveniência da Formulação oferece salvar como modelo, e o formulário diz modelo", async () => {
    getTemplateUpdateAvailable.mockResolvedValue({
      templateId: "ft-1",
      templateCode: "FT-000008",
      templateName: "Biotina — Cápsulas Base",
      originVersionId: "ftv-3",
      originVersionNumber: 3,
      latestVersionId: "ftv-4",
      latestVersionNumber: 4,
    });
    const formulacao = {
      id: "fv-1",
      productId: "p-1",
      originTemplateVersionId: "ftv-3",
      originTemplateCode: "FT-000008",
      originTemplateVersionNumber: 3,
      originTemplateName: "Biotina — Cápsulas Base",
    } as FormulationVersionDTO;
    render(
      <MemoryRouter>
        <FormulationTemplateOrigin
          version={formulacao}
          canEdit
          onChanged={vi.fn()}
          salvandoComoTemplate
          onSalvandoComoTemplateChange={vi.fn()}
        />
      </MemoryRouter>,
    );
    await screen.findByText(/Existe uma versão mais recente do modelo de origem/);
    expect(screen.getByLabelText("Nome do modelo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Criar modelo" })).toBeInTheDocument();
    semTemplateVisivel();
  });
});

describe("Pré-checagem ao aplicar — decisão D-6", () => {
  it("avisa antes, nomeando o item, e ainda deixa gerar o rascunho", async () => {
    const aplicar = vi.fn();
    getFormulationTemplate.mockResolvedValue(
      modelo(
        null,
        versao({
          id: "ftv-3",
          status: "ACTIVE",
          versionLabel: "V3",
          components: [componente(), colinaInativa()],
          componentIssues: [pendenciaDaColina],
        }),
      ),
    );
    render(
      <MemoryRouter>
        <UseTemplateDialog onCancel={vi.fn()} onApply={aplicar} saving={false} />
      </MemoryRouter>,
    );
    await screen.findByText("FT-000008");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));

    const aviso = await screen.findByRole("alert");
    expect(within(aviso).getByText("1 item deste modelo precisa de revisão")).toBeInTheDocument();
    expect(
      within(aviso).getByText("MP-000009 foi inativado no cadastro de itens. (Colina antiga)"),
    ).toBeInTheDocument();
    expect(within(aviso).getByText(/só poderá ser ativada depois/)).toBeInTheDocument();

    // A linha do item também diz o motivo, na revisão da composição.
    const linha = screen.getByText("MP-000009 — Colina antiga").closest("tr") as HTMLElement;
    expect(within(linha).getByText("Inativo")).toBeInTheDocument();

    // O aviso vem ANTES do botão, e o botão diz o que faz.
    const botao = screen.getByRole("button", { name: "Usar mesmo assim" });
    expect(botao).toHaveAttribute("aria-describedby", aviso.id);
    expect(aviso.compareDocumentPosition(botao) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Usar este modelo" })).toBeNull();
    fireEvent.click(botao);
    expect(aplicar).toHaveBeenCalledWith("ftv-3");
  });

  it("sem pendência não há aviso, e a revisão mostra as premissas que viajam", async () => {
    getFormulationTemplate.mockResolvedValue(
      modelo(null, versao({ id: "ftv-3", status: "ACTIVE", versionLabel: "V3" })),
    );
    render(
      <MemoryRouter>
        <UseTemplateDialog onCancel={vi.fn()} onApply={vi.fn()} saving={false} />
      </MemoryRouter>,
    );
    await screen.findByText("FT-000008");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    await screen.findByRole("button", { name: "Usar este modelo" });

    expect(screen.queryByRole("alert")).toBeNull();
    const ficha = document.querySelector(".definition-list") as HTMLElement;
    expect(within(ficha).getByText("Cápsula")).toBeInTheDocument();
    expect(within(ficha).getByText("Pote")).toBeInTheDocument();
    expect(within(ficha).getByText("Perda prevista de produção")).toBeInTheDocument();
    expect(within(ficha).getByText("3%")).toBeInTheDocument();
    // Pureza e reserva da linha aparecem antes de copiar.
    const linha = screen.getByText("MP-000001 — Biotina").closest("tr") as HTMLElement;
    expect(within(linha).getByText("98%")).toBeInTheDocument();
    expect(within(linha).getByText("10%")).toBeInTheDocument();
  });
});

describe("Pendências na página do Modelo", () => {
  it("o rascunho diz o que barra a ativação, com o item nomeado e o caminho para ele", async () => {
    await abrirDetalhe(
      modelo(versao({ components: [componente(), colinaInativa()], componentIssues: [pendenciaDaColina] })),
    );

    const painel = screen.getByRole("region", { name: "Componentes que precisam de revisão" });
    expect(
      within(painel).getByText("1 componente impede ativar esta versão do modelo"),
    ).toBeInTheDocument();
    expect(
      within(painel).getByText("MP-000009 foi inativado no cadastro de itens. (Colina antiga)"),
    ).toBeInTheDocument();
    expect(within(painel).getByRole("link", { name: "Abrir o item" })).toHaveAttribute(
      "href",
      expect.stringContaining("i3"),
    );
  });

  it("sem rascunho, a versão ativa avisa quem vai aplicá-la", async () => {
    await abrirDetalhe(
      modelo(
        null,
        versao({
          id: "ftv-3",
          status: "ACTIVE",
          versionLabel: "V3",
          components: [componente(), colinaInativa()],
          componentIssues: [pendenciaDaColina],
        }),
      ),
    );

    const painel = screen.getByRole("region", { name: "Componentes que precisam de revisão" });
    expect(
      within(painel).getByText("1 componente da versão ativa precisa de revisão"),
    ).toBeInTheDocument();
    expect(within(painel).getByText(/crie uma nova versão/)).toBeInTheDocument();
  });

  it("sem pendência, nenhum painel", async () => {
    await abrirDetalhe(modelo(versao()));
    expect(screen.queryByRole("region", { name: "Componentes que precisam de revisão" })).toBeNull();
  });

  it("ativação recusada: a frase nomeada aparece e o painel é relido", async () => {
    activateFormulationTemplateVersion.mockRejectedValue(
      new Error(
        "Não é possível ativar esta versão do modelo: componentes precisam de revisão — MP-000009 (inativo).",
      ),
    );
    const antes = modelo(versao({ components: [componente(), colinaInativa()] }));
    const depois = modelo(
      versao({ components: [componente(), colinaInativa()], componentIssues: [pendenciaDaColina] }),
    );
    getFormulationTemplate.mockResolvedValueOnce(antes).mockResolvedValue(depois);
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route path="/producao/templates-formulacao/:templateId" element={<FormulationTemplateDetailPage />} />,
      ),
      { initialEntries: ["/producao/templates-formulacao/ft-1"] },
    );
    render(<RouterProvider router={router} />);
    await screen.findByRole("textbox", { name: "Quantidade de MP-000009" });
    expect(screen.queryByRole("region", { name: "Componentes que precisam de revisão" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Ativar versão" }));

    expect(await screen.findByText(/MP-000009 \(inativo\)/)).toHaveAttribute("role", "alert");
    expect(
      await screen.findByRole("region", { name: "Componentes que precisam de revisão" }),
    ).toBeInTheDocument();
    expect(getFormulationTemplate).toHaveBeenCalledTimes(2);
  });
});

describe("Seletor de item do Modelo", () => {
  it("linha nova não oferece produto acabado nem item inativo", async () => {
    await abrirDetalhe(modelo(versao()));
    await screen.findByRole("textbox", { name: "Quantidade de MP-000001" });

    fireEvent.click(within(composicao()).getByRole("button", { name: "+ Adicionar matéria-prima" }));
    // O seletor de ITEM da linha — os <select> de unidade e fornecimento também
    // são combobox, e não interessam aqui.
    const seletores = composicao().querySelectorAll<HTMLElement>('input[id^="componente-"]');
    const novo = seletores[seletores.length - 1] as HTMLElement;
    const opcoes = await opcoesDoSeletor(novo);
    expect(opcoes.some((texto) => texto.includes("MP-000002"))).toBe(true);
    expect(opcoes.some((texto) => texto.includes("PA-000001"))).toBe(false);
    expect(opcoes.some((texto) => texto.includes("MP-000009"))).toBe(false);
    // O item da outra linha também não se repete.
    expect(opcoes.some((texto) => texto.includes("MP-000001"))).toBe(false);
  });

  it("item histórico inativo continua na linha, marcado como Inativo", async () => {
    await abrirDetalhe(modelo(versao({ components: [componente(), colinaInativa()] })));
    const campo = await screen.findByRole("textbox", { name: "Quantidade de MP-000009" });
    const linha = campo.closest("tr") as HTMLElement;

    expect(within(linha).getByText("Inativo")).toHaveClass("badge");
    expect(within(linha).getByText(/mantido pelo histórico/)).toBeInTheDocument();

    const seletor = linha.querySelector<HTMLElement>('input[id^="componente-"]') as HTMLElement;
    expect(seletor).toHaveValue("MP-000009 · Colina antiga");
    const opcoes = await opcoesDoSeletor(seletor);
    const propria = opcoes.find((texto) => texto.includes("MP-000009"));
    expect(propria).toContain("Inativo");
    expect(opcoes.some((texto) => texto.includes("PA-000001"))).toBe(false);
  });
});

describe("Comparação de versões explica as premissas", () => {
  it("rótulos da tela, nunca nome interno", async () => {
    const diff: FormulationTemplateDiffDTO = {
      fromLabel: "FT-000008 · V3",
      toLabel: "FT-000008 · V4",
      entries: [
        { kind: "DOSAGE_FORM", label: "Forma do produto", field: null, from: "Cápsula", to: "Pó" },
        { kind: "CAPSULES_PER_DOSE", label: "Cápsulas por dose", field: null, from: "2", to: "Não informada" },
        { kind: "DOSE", label: "Dose", field: null, from: "Não informada", to: "5 g" },
        { kind: "EXPECTED_LOSS", label: "Perda prevista de produção (%)", field: null, from: "3", to: "5" },
        {
          kind: "COMPONENT_CHANGED",
          label: "Biotina (MP-000001)",
          field: "Posição na composição",
          from: "1ª linha",
          to: "2ª linha",
        },
      ],
    };
    compareTemplateVersions.mockResolvedValue(diff);
    const ativa = versao({ id: "ftv-3", versionNumber: 3, versionLabel: "V3", status: "ACTIVE" });
    await abrirDetalhe(modelo(versao({ sourceVersionId: "ftv-3", sourceVersionNumber: 3 }), ativa));

    fireEvent.click(screen.getByRole("button", { name: "Comparar versões" }));
    const tabela = (await screen.findByText(/Comparando FT-000008 · V3 → FT-000008 · V4/)).closest(
      ".template-diff",
    ) as HTMLElement;
    expect(compareTemplateVersions).toHaveBeenCalledWith("ftv-3", "ftv-4");

    const linhaDaForma = within(tabela).getByText("Forma do produto").closest("tr") as HTMLElement;
    expect(within(linhaDaForma).getByText("Premissa alterada")).toBeInTheDocument();
    expect(within(linhaDaForma).getByText("Cápsula")).toBeInTheDocument();
    expect(within(linhaDaForma).getByText("Pó")).toBeInTheDocument();
    expect(within(tabela).getAllByText("Premissa alterada")).toHaveLength(4);
    expect(within(tabela).getByText("Posição na composição")).toBeInTheDocument();
    for (const interno of ["DOSAGE_FORM", "CAPSULES_PER_DOSE", "DOSE", "EXPECTED_LOSS", "COMPONENT_CHANGED"]) {
      expect(tabela.textContent).not.toContain(interno);
    }
  });
});

describe("Rascunho × ativa", () => {
  it("a bancada mostra o rascunho; a ativa continua à vista, sem segunda receita", async () => {
    const ativa = versao({
      id: "ftv-3",
      versionNumber: 3,
      versionLabel: "V3",
      status: "ACTIVE",
      usageCount: 2,
      components: [componente()],
    });
    const rascunho = versao({
      sourceVersionId: "ftv-3",
      sourceVersionNumber: 3,
      components: [
        componente({ id: "c5", itemId: "i5", itemCode: "MP-000002", itemName: "Colágeno" }),
      ],
    });
    await abrirDetalhe(modelo(rascunho, ativa));
    await screen.findByRole("textbox", { name: "Quantidade de MP-000002" });

    // Uma receita só na página: a do rascunho.
    expect(screen.queryByRole("textbox", { name: "Quantidade de MP-000001" })).toBeNull();
    expect(screen.queryByText("MP-000001")).toBeNull();
    expect(document.querySelectorAll("table.table--formulacao-composicao")).toHaveLength(1);

    // A ativa não some: seção própria, frase de onde está a receita dela.
    expect(screen.getByRole("heading", { name: "Versão ativa — V3" })).toBeInTheDocument();
    expect(screen.getByText(/A receita abaixo é a do rascunho V4/)).toBeInTheDocument();
    expect(screen.getByText(/2 formulações de produto nasceram desta versão/)).toBeInTheDocument();

    // O histórico lista as duas, e a comparação parte do rascunho.
    const historico = screen.getByRole("heading", { name: "Histórico de versões" });
    const blocoDoHistorico = (historico.closest("section") ?? historico.parentElement?.parentElement) as HTMLElement;
    expect(within(blocoDoHistorico).getByText("V3")).toBeInTheDocument();
    expect(within(blocoDoHistorico).getByText("V4")).toBeInTheDocument();
    expect(within(blocoDoHistorico).getByRole("button", { name: "Comparar versões" })).toBeInTheDocument();
  });
});

describe("Barra fixa do Modelo — a da fatia 2", () => {
  it("voltar no início, gravar e ativar no fim, sem cópia em outro lugar", async () => {
    await abrirDetalhe(modelo(versao()));
    await screen.findByRole("textbox", { name: "Quantidade de MP-000001" });

    const barra = screen.getByRole("group", { name: "Ações do modelo de formulação" });
    const inicio = barra.querySelector(".sticky-action-bar__inicio") as HTMLElement;
    const fim = barra.querySelector(".sticky-action-bar__fim") as HTMLElement;
    expect(within(inicio).getByRole("button", { name: "← Voltar" })).toBeInTheDocument();
    expect(within(fim).getByRole("button", { name: "Salvar rascunho" })).toBeInTheDocument();
    expect(within(fim).getByRole("button", { name: "Ativar versão" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Ativar versão" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Salvar rascunho" })).toHaveLength(1);
    // A barra é o último bloco da página: nada do documento fica embaixo dela.
    expect(barra.nextElementSibling).toBeNull();
  });
});
