import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CustomerDTO, FormulationTemplateDTO, ItemDTO, ProjectDTO } from "@veridi/shared";

/**
 * Criação no contexto e prévia da aprovação.
 *
 * As duas nascem do mesmo princípio: o sistema já sabe alguma coisa e não
 * pode obrigar a pessoa a descobrir sozinha — nem abandonar o formulário para
 * cadastrar o que falta, nem aprovar um projeto sem ver o que fica de fora.
 */

vi.mock("../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../lib/items-api", () => ({ listItems: vi.fn() }));
vi.mock("../lib/units-api", () => ({ listUnits: vi.fn() }));
vi.mock("../lib/receiving-api", () => ({ createCustomerSuppliedReceipt: vi.fn() }));
vi.mock("../lib/formulation-templates-api", () => ({
  getFormulationTemplate: vi.fn(),
  updateFormulationTemplate: vi.fn(),
  updateFormulationTemplateVersion: vi.fn(),
  activateFormulationTemplateVersion: vi.fn(),
  createTemplateVersionFrom: vi.fn(),
  setFormulationTemplateArchived: vi.fn(),
  compareTemplateVersions: vi.fn(),
}));
vi.mock("../app/AuthProvider", () => ({ useAuth: vi.fn() }));

/*
 * Cliente e Item já têm suíte própria (CNPJ, CEP, unidade, controle de
 * lote). O que estes testes cobrem é a INTEGRAÇÃO: o modal oficial é
 * reusado, o registro criado volta selecionado PELO ID, e o rascunho de
 * quem estava preenchendo sobrevive.
 */
vi.mock("../pages/customers/CustomerFormModal", () => ({
  CustomerFormModal: ({
    onClose,
    onSaved,
  }: {
    onClose: () => void;
    onSaved: (created?: CustomerDTO) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSaved(CLIENTE_NOVO)}>
        salvar-cliente
      </button>
      <button type="button" onClick={onClose}>
        fechar-cliente-sem-salvar
      </button>
    </div>
  ),
}));
vi.mock("../pages/items/ItemFormModal", () => ({
  ItemFormModal: ({
    onClose,
    onSaved,
  }: {
    onClose: () => void;
    onSaved: (created?: ItemDTO) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSaved(ITEM_NOVO)}>
        salvar-item
      </button>
      <button type="button" onClick={onClose}>
        fechar-item-sem-salvar
      </button>
    </div>
  ),
}));

import { SearchableEntitySelect } from "./SearchableEntitySelect";
import { ApprovalPreviewDialog } from "../pages/projects/ApprovalPreviewDialog";
import { FormulationTemplateDetailPage } from "../pages/formulation-templates/FormulationTemplateDetailPage";
import { listItems } from "../lib/items-api";
import { listUnits } from "../lib/units-api";
import { getFormulationTemplate } from "../lib/formulation-templates-api";
import { useAuth } from "../app/AuthProvider";

const OPTIONS = [
  { id: "cli-1", code: "CLI-000001", name: "Vida Saudável" },
  { id: "cli-2", code: "CLI-000002", name: "Bem Estar" },
];

/** Opções da lista aberta — o `listbox` sai por portal. */
function opcoes(): HTMLElement[] {
  const lista = screen.getAllByRole("listbox").at(-1)!;
  return within(lista).getAllByRole("option");
}

describe("Criação no contexto — o seletor", () => {
  function montar(props: Partial<Parameters<typeof SearchableEntitySelect>[0]> = {}) {
    return render(
      <SearchableEntitySelect
        id="cliente"
        value=""
        onChange={() => {}}
        options={OPTIONS}
        canCreate
        createLabel="Novo cliente"
        onCreateNew={() => {}}
        {...props}
      />,
    );
  }

  it("encabeça a lista cheia", () => {
    // Morava no fim: com 539 itens no catálogo, cadastrar o que ainda não
    // existe exigia rolar até o fundo — a ação sumia justamente quando a
    // lista era grande, que é quando ela mais faz falta.
    montar();
    fireEvent.focus(screen.getByRole("combobox"));

    const lista = opcoes();
    expect(lista).toHaveLength(3);
    expect(lista[0]!.textContent).toContain("Novo cliente");
    expect(lista[1]!.textContent).toContain("Vida Saudável");
  });

  it("encabeça a lista quando não há catálogo nenhum", () => {
    // Catálogo vazio é o caso em que criar é a ÚNICA saída.
    montar({ options: [] });
    fireEvent.focus(screen.getByRole("combobox"));

    const lista = opcoes();
    expect(lista).toHaveLength(1);
    expect(lista[0]!.textContent).toContain("Novo cliente");
    expect(screen.queryByText("Nada disponível para escolher.")).toBeNull();
  });

  it("encabeça a lista quando a busca não encontra nada", () => {
    const onCreateNew = vi.fn();
    montar({ onCreateNew });
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Nova Nutrição" } });

    const lista = opcoes();
    expect(lista).toHaveLength(1);
    // O texto digitado vai junto: quem procurou já disse o nome.
    expect(lista[0]!.textContent).toContain("Nova Nutrição");

    fireEvent.mouseDown(lista[0]!);
    expect(onCreateNew).toHaveBeenCalledWith("Nova Nutrição");
  });

  it("encabeça a lista mesmo quando a busca casa", () => {
    // Nome parecido com um que já existe não prova que é o mesmo registro:
    // quem procura "Vida" e precisa cadastrar outra "Vida" tem de ver a
    // ação sem rolar.
    montar();
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Vida" } });

    const lista = opcoes();
    expect(lista).toHaveLength(2);
    expect(lista[0]!.textContent).toContain("Novo cliente");
    expect(lista[1]!.textContent).toContain("Vida Saudável");
  });

  it("seta para cima a partir do primeiro resultado alcança a ação", () => {
    const onCreateNew = vi.fn();
    const onChange = vi.fn();
    montar({ onCreateNew, onChange });
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Vida" } });

    // Filtrar deixa o índice ativo no primeiro RESULTADO.
    expect(input.getAttribute("aria-activedescendant")).toBe(opcoes()[1]!.getAttribute("id"));

    fireEvent.keyDown(input, { key: "ArrowUp" });

    const acao = opcoes()[0]!;
    // Quem navega por leitor de tela precisa ouvir onde está.
    expect(input.getAttribute("aria-activedescendant")).toBe(acao.getAttribute("id"));
    expect(acao.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreateNew).toHaveBeenCalledWith("Vida");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Enter sem navegar escolhe o primeiro resultado, nunca cria", () => {
    // A proteção contra o duplicado mudou de lugar em vez de sumir: a ação
    // está à vista, mas o Enter direto continua sendo escolha.
    const onCreateNew = vi.fn();
    const onChange = vi.fn();
    montar({ onCreateNew, onChange });
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Vida" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("cli-1");
    expect(onCreateNew).not.toHaveBeenCalled();
  });

  it("não anuncia aviso nem ação como resultado da busca", () => {
    // `listbox` com filho que não é `option` faz o leitor de tela contar
    // "3 resultados" onde existem 2.
    montar();
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "zzz sem resultado" } });

    const list = document.querySelector(".entity-select__list") as HTMLElement;
    for (const child of Array.from(list.children)) {
      expect(["option", "presentation"]).toContain(child.getAttribute("role"));
    }
  });

  /**
   * O registro que a pessoa digitou vem ANTES do convite a criar outro
   * igual.
   *
   * Digitando o nome exato de um cliente que já existe, a primeira linha da
   * lista era "+ Novo cliente: …" e o cadastro existente vinha embaixo — a
   * lista oferecia a duplicata antes do original.
   */
  it("põe o registro exato antes da opção de criar", () => {
    montar();
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Vida Saudável" } });

    const lista = opcoes();
    expect(lista).toHaveLength(2);
    expect(lista[0]!.textContent).toContain("Vida Saudável");
    expect(lista[1]!.textContent).toContain("Novo cliente");
  });

  it("reconhece o registro exato sem acento e pelo código", () => {
    montar();
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);

    // Quem digita rápido não acentua.
    fireEvent.change(input, { target: { value: "vida saudavel" } });
    expect(opcoes()[0]!.textContent).toContain("Vida Saudável");

    fireEvent.change(input, { target: { value: "CLI-000001" } });
    const porCodigo = opcoes();
    expect(porCodigo[0]!.textContent).toContain("CLI-000001");
    expect(porCodigo[1]!.textContent).toContain("Novo cliente");
  });

  it("nome apenas parecido não desce a ação de cadastrar", () => {
    // "Vida" não é "Vida Saudável": quem procura um nome parecido pode
    // precisar cadastrar outro registro, e a ação continua à vista.
    montar();
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Vida" } });

    expect(opcoes()[0]!.textContent).toContain("Novo cliente");
  });

  it("com o registro exato na lista, Enter escolhe e a seta ainda alcança o cadastro", () => {
    const onCreateNew = vi.fn();
    const onChange = vi.fn();
    montar({ onCreateNew, onChange });
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Vida Saudável" } });

    // O índice ativo continua nascendo no resultado, agora no topo da lista.
    expect(input.getAttribute("aria-activedescendant")).toBe(opcoes()[0]!.getAttribute("id"));

    // Primeira seta só confirma o item ativo; a segunda anda até o cadastro,
    // que agora fica ABAIXO do resultado.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const acao = opcoes()[1]!;
    expect(input.getAttribute("aria-activedescendant")).toBe(acao.getAttribute("id"));

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreateNew).toHaveBeenCalledWith("Vida Saudável");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("não oferece cadastrar onde o gate é real dos dois lados", () => {
    // Recurso industrial exige ADMIN no front E na API. CTA que termina em
    // 403 é pior que CTA nenhum.
    montar({ canCreate: false });
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.queryByRole("option", { name: /Novo/ })).toBeNull();
  });
});

const CLIENTE_NOVO = {
  id: "cli-novo",
  code: "CLI-000042",
  legalName: "Nutrição Viva Indústria Ltda",
  tradeName: "Nutri Viva",
  active: true,
} as unknown as CustomerDTO;

const ITEM_NOVO = {
  id: "item-novo",
  code: "MP-000777",
  name: "Creatina monoidratada",
  type: "RAW_MATERIAL",
  unitCode: "kg",
  active: true,
} as unknown as ItemDTO;

const ITEM_EXISTENTE = {
  id: "item-1",
  code: "MP-000001",
  name: "Maltodextrina",
  type: "RAW_MATERIAL",
  unitCode: "kg",
  active: true,
} as unknown as ItemDTO;

/*
 * Os campos são buscados pelo `id` que a tela dá a eles.
 *
 * `getByLabelText` não serve aqui: os rótulos hospedam o ⓘ de ajuda, que é
 * um `button` dentro do `<label>` — a consulta acha dois elementos e falha
 * por ambiguidade, sem que nada esteja errado na tela.
 */
function templateComRascunho(): FormulationTemplateDTO {
  const versao = {
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
        itemId: "item-1",
        itemCode: "MP-000001",
        itemName: "Maltodextrina",
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
  };
  return {
    id: "tpl-1",
    code: "TPL-000001",
    name: "Base proteica",
    description: null,
    archived: false,
    archivedAt: null,
    activeVersion: null,
    draftVersion: versao,
    versions: [versao],
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as FormulationTemplateDTO;
}

/** Os seletores de item do rascunho, em ordem de linha. */
function camposDeItem(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[id^="template-item-"]'));
}

describe("Criação no contexto — coluna de tabela (Template de formulação)", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ user: { role: "ADMIN" } } as never);
    vi.mocked(getFormulationTemplate).mockResolvedValue(templateComRascunho());
    vi.mocked(listItems).mockResolvedValue({ items: [ITEM_EXISTENTE] } as never);
    vi.mocked(listUnits).mockResolvedValue([] as never);
  });

  function abrir() {
    render(
      <MemoryRouter initialEntries={["/producao/templates/tpl-1"]}>
        <Routes>
          <Route
            path="/producao/templates/:templateId"
            element={<FormulationTemplateDetailPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("o campo do item respeita quem não pode editar, como os vizinhos", () => {
    // Era o único campo do rascunho sem `disabled`: quem não é ADMIN nem
    // PRODUCTION trocava o item na tela e só descobria a recusa ao salvar.
    vi.mocked(useAuth).mockReturnValue({ user: { role: "COMMERCIAL" } } as never);
    abrir();

    return waitFor(() => {
      const campos = camposDeItem();
      expect(campos).toHaveLength(2);
      expect(campos[0]!.disabled).toBe(true);
      // Campo que não se pode alterar não oferece cadastrar.
      fireEvent.focus(campos[0]!);
      expect(screen.queryByRole("option", { name: /Novo item/ })).toBeNull();
    });
  });
});

function buildProject(overrides: Partial<ProjectDTO> = {}): ProjectDTO {
  return {
    id: "prj-1",
    code: "PROJ-000001",
    externalCode: null,
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "Vida Saudável",
    name: "Linha Performance",
    concept: null,
    channel: null,
    status: "SAMPLE",
    source: "MANUAL",
    responsibleUserId: null,
    responsibleUserName: null,
    entryDate: "2026-01-01T00:00:00.000Z",
    notes: null,
    cancelReason: null,
    cancelReasonDetails: null,
    cancelledAt: null,
    approvedAt: null,
    dosageForm: null,
    presentationType: null,
    doseAmount: null,
    doseUomCode: null,
    dosesPerPackage: null,
    targetAgeGroup: null,
    minimumBatchQuantity: null,
    shelfLifeMonths: null,
    productId: null,
    productCode: null,
    productName: null,
    costing: null,
    products: [],
    latestQuoteLabel: null,
    latestQuoteStatus: null,
    acceptedQuoteLabel: null,
    quoteVersions: [],
    statusHistory: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByName: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as ProjectDTO;
}

function projectProduct(id: string, code: string, name: string, status = "ACTIVE") {
  return {
    id,
    projectId: "prj-1",
    productId: `prod-${id}`,
    productCode: code,
    productName: name,
    productLifecycle: "DEVELOPMENT",
    productActive: true,
    sequence: 1,
    status,
    costing: null,
    latestSampleCode: null,
    latestSampleLabel: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByName: null,
  } as ProjectDTO["products"][number];
}

describe("Prévia da aprovação", () => {
  it("mostra o que será aprovado e o que fica fora do escopo", () => {
    // Três sabores desenvolvidos, dois vendidos: quem aprova precisa ver a
    // divisão antes, não descobrir que o terceiro não entra em pedido.
    const project = buildProject({
      products: [
        projectProduct("pp-a", "PROD-000001", "Sabor A"),
        projectProduct("pp-b", "PROD-000002", "Sabor B"),
        projectProduct("pp-c", "PROD-000003", "Sabor C"),
      ],
      quoteVersions: [
        {
          id: "q1",
          code: "ORC-000001",
          projectId: "prj-1",
          versionNumber: 1,
          versionLabel: "ORC-000001 · V1",
          externalCode: null,
          status: "ACCEPTED",
          source: "MANUAL",
          quoteDate: "2026-01-02T00:00:00.000Z",
          validUntil: null,
          currencyCode: "BRL",
          lines: [
            { productId: "prod-pp-a" },
            { productId: "prod-pp-b" },
          ],
          total: "100.00",
        },
      ] as unknown as ProjectDTO["quoteVersions"],
    });

    render(
      <MemoryRouter>
        <ApprovalPreviewDialog project={project} onCancel={() => {}} onConfirm={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/contém 2 de 3/)).toBeTruthy();
    expect(screen.getByText("Sabor A")).toBeTruthy();
    expect(screen.getByText("Sabor B")).toBeTruthy();
    expect(screen.getByText(/Ficarão fora do escopo comercial/)).toBeTruthy();
    expect(screen.getByText("Sabor C")).toBeTruthy();
  });

  it("sem proposta aceita, explica o que falta em vez de deixar aprovar às cegas", () => {
    render(
      <MemoryRouter>
        <ApprovalPreviewDialog project={buildProject()} onCancel={() => {}} onConfirm={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/ainda não tem uma proposta aceita/)).toBeTruthy();
  });
});
