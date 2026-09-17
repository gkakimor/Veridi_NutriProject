import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type {
  CreateSupplierItemInput,
  ItemDTO,
  SupplierDTO,
  SupplierItemDTO,
  SupplierItemDetailDTO,
  UnitOfMeasureDTO,
} from "@veridi/shared";

/**
 * Fornecedores no cadastro do Item — ITEM-SUPPLIER-UX-01.
 *
 * A seção deixa de ser só leitura: Compras e Administrador adicionam fornecedor
 * com o Item fixo (a relação de Compras nasce Pendente) e definem o preferencial
 * na linha, com confirmação que diz quem sai; a Qualidade homologa e bloqueia no
 * detalhe aberto por cima do Item; Produção, Comercial e Consulta só consultam.
 * O servidor falso guarda estado e faz o que a API faz numa transação — a tela
 * precisa ler o preferencial da resposta, nunca encadear chamadas.
 */

const sessao = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../../app/AuthProvider", () => {
  const valor = () => ({ user: { id: "u-1", name: "Sessão de teste", role: sessao.role } });
  return { useAuth: valor, useOptionalAuth: valor };
});
vi.mock("../../lib/supplier-items-api", () => ({
  listSupplierItems: vi.fn(),
  getSupplierItem: vi.fn(),
  createSupplierItem: vi.fn(),
  updateSupplierItem: vi.fn(),
  changeSupplierItemQualification: vi.fn(),
  setSupplierItemPreferred: vi.fn(),
  createSupplierItemOffer: vi.fn(),
}));
vi.mock("../../lib/suppliers-api", async (original) => ({
  ...(await original<object>()),
  listSuppliers: vi.fn(),
}));
vi.mock("../../lib/items-api", async (original) => ({
  ...(await original<object>()),
  listItems: vi.fn(async () => ({ items: [], page: 1, pageSize: 50, total: 0 })),
  getItem: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({
  listUnits: vi.fn(async () => [
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ]),
}));

import {
  changeSupplierItemQualification,
  createSupplierItem,
  getSupplierItem,
  listSupplierItems,
  setSupplierItemPreferred,
  updateSupplierItem,
} from "../../lib/supplier-items-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { AlreadyExistsApiError } from "../../lib/api-errors";
import {
  PARAM_RETOMAR,
  finishContextualCreate,
  readContextualCreate,
  startContextualCreate,
} from "../../lib/contextual-create";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import { FornecedoresDoItemSection } from "./FornecedoresDoItem";

const TODOS = ["ADMIN", "PURCHASING", "QUALITY", "PRODUCTION", "COMMERCIAL", "VIEWER"];
const MANTEM = ["PURCHASING", "ADMIN"];
const DECIDEM = ["QUALITY", "ADMIN"];
const CONSULTAM = ["PRODUCTION", "COMMERCIAL", "VIEWER"];

const KG = { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" } as UnitOfMeasureDTO;

function item(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "item-1",
    code: "MP-000003",
    type: "RAW_MATERIAL",
    name: "Cafeína",
    unitCode: "kg",
    unit: KG,
    controlsLot: true,
    controlsExpiry: true,
    requiresQualityRelease: true,
    requiresCoa: false,
    sourceName: null,
    declaredNutrient: null,
    family: null,
    defaultPurityPercent: null,
    packagingSubtype: null,
    consumedInProduction: false,
    externalBarcode: null,
    externalCode: null,
    active: true,
    operationallyUsed: true,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

function fornecedor(id: string, code: string, legalName: string): SupplierDTO {
  return {
    id,
    code,
    legalName,
    tradeName: null,
    cnpj: null,
    email: null,
    phone: null,
    street: null,
    number: null,
    complement: null,
    district: null,
    zipCode: null,
    city: null,
    state: null,
    notes: null,
    active: true,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  };
}

const PURIFARMA = fornecedor("for-1", "FOR-000001", "PURIFARMA");
const SWEETMIX = fornecedor("for-2", "FOR-000002", "SWEETMIX");
const NUTRIFORT = fornecedor("for-3", "FOR-000003", "NUTRIFORT");
const CATALOGO = [PURIFARMA, SWEETMIX, NUTRIFORT];

function relacao(supplier: SupplierDTO, overrides: Partial<SupplierItemDTO> = {}): SupplierItemDTO {
  return {
    id: `si-${supplier.id}`,
    itemId: "item-1",
    itemCode: "MP-000003",
    itemName: "Cafeína",
    itemExternalCode: null,
    itemUnitCode: "kg",
    itemType: "RAW_MATERIAL",
    itemFamily: null,
    itemActive: true,
    supplierId: supplier.id,
    supplierCode: supplier.code,
    supplierName: supplier.legalName,
    supplierActive: true,
    supplierItemCode: null,
    qualificationStatus: "PENDING",
    preferred: false,
    active: true,
    commercialNotes: null,
    currentOffer: null,
    latestLegacyOffer: null,
    offerCount: 0,
    costSourceAmbiguous: false,
    createdAt: "2026-09-01T12:00:00.000Z",
    createdByName: "Compras",
    updatedAt: "2026-09-01T12:00:00.000Z",
    updatedByName: "Compras",
    ...overrides,
  };
}

function detalhe(dto: SupplierItemDTO): SupplierItemDetailDTO {
  return {
    ...dto,
    offers: [],
    qualificationHistory: [],
    costSourceToday: {
      source: "NO_COST",
      unitCost: null,
      unitCode: "kg",
      details: null,
      referenceDate: "2026-09-16T12:00:00.000Z",
    },
  };
}

/** O que a API guarda — lido e alterado pelas rotas falsas como a transação faria. */
const servidor = { relacoes: [] as SupplierItemDTO[] };

function alterar(id: string, mudanca: (atual: SupplierItemDTO) => SupplierItemDTO): SupplierItemDetailDTO {
  servidor.relacoes = servidor.relacoes.map((atual) => (atual.id === id ? mudanca(atual) : atual));
  return detalhe(servidor.relacoes.find((atual) => atual.id === id)!);
}

beforeEach(() => {
  sessionStorage.clear();
  sessao.role = "ADMIN";
  servidor.relacoes = [];

  vi.mocked(listSupplierItems)
    .mockReset()
    .mockImplementation(async (params = {}) => {
      const linhas = servidor.relacoes.filter(
        (atual) =>
          (!params.itemId || atual.itemId === params.itemId) &&
          (!params.supplierId || atual.supplierId === params.supplierId),
      );
      const pageSize = params.pageSize ?? 20;
      return { supplierItems: linhas.slice(0, pageSize), page: 1, pageSize, total: linhas.length };
    });
  vi.mocked(getSupplierItem)
    .mockReset()
    .mockImplementation(async (id) => detalhe(servidor.relacoes.find((atual) => atual.id === id)!));
  vi.mocked(setSupplierItemPreferred)
    .mockReset()
    .mockImplementation(async (id, preferred) => {
      const alvo = servidor.relacoes.find((atual) => atual.id === id)!;
      // A mesma transação da API: desmarca o anterior do item e marca este.
      servidor.relacoes = servidor.relacoes.map((atual) =>
        atual.itemId !== alvo.itemId
          ? atual
          : atual.id === id
            ? { ...atual, preferred }
            : preferred
              ? { ...atual, preferred: false }
              : atual,
      );
      return detalhe(servidor.relacoes.find((atual) => atual.id === id)!);
    });
  vi.mocked(changeSupplierItemQualification)
    .mockReset()
    .mockImplementation(async (id, input) =>
      alterar(id, (atual) => ({
        ...atual,
        qualificationStatus: input.status,
        preferred: input.status === "APPROVED" ? atual.preferred : false,
      })),
    );
  vi.mocked(updateSupplierItem)
    .mockReset()
    .mockImplementation(async (id, input) =>
      alterar(id, (atual) => ({
        ...atual,
        ...(input.active !== undefined ? { active: input.active } : {}),
        preferred: input.active === false ? false : atual.preferred,
      })),
    );
  vi.mocked(createSupplierItem)
    .mockReset()
    .mockImplementation(async (input: CreateSupplierItemInput) => {
      const escolhido = CATALOGO.find((atual) => atual.id === input.supplierId)!;
      const criada = relacao(escolhido, {
        id: "si-nova",
        itemId: input.itemId,
        qualificationStatus: input.qualificationStatus ?? "PENDING",
        preferred: input.preferred === true,
      });
      if (criada.preferred) {
        servidor.relacoes = servidor.relacoes.map((atual) => ({ ...atual, preferred: false }));
      }
      servidor.relacoes = [...servidor.relacoes, criada];
      return detalhe(criada);
    });
  vi.mocked(listSuppliers)
    .mockReset()
    .mockImplementation(async (params = {}) => {
      const termo = params.search?.toLowerCase() ?? "";
      const achados = CATALOGO.filter(
        (atual) => !termo || `${atual.code} ${atual.legalName}`.toLowerCase().includes(termo),
      );
      return { suppliers: achados, page: 1, pageSize: params.pageSize ?? 20, total: achados.length };
    });
});

async function abrirSecao(doItem: ItemDTO = item(), entrada = "/cadastros/itens") {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route
        element={
          <UnsavedChangesProvider>
            <Outlet />
          </UnsavedChangesProvider>
        }
      >
        <Route path="/cadastros/itens" element={<FornecedoresDoItemSection item={doItem} />} />
      </Route>,
    ),
    { initialEntries: [entrada] },
  );
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(listSupplierItems).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText("Carregando…")).toBeNull());
  return router;
}

/** A linha da relação, pelo nome do fornecedor. */
function linhaDe(nome: string): HTMLElement {
  const celula = screen.getByText((_texto, elemento) => elemento?.tagName === "TD" && elemento.textContent?.includes(nome) === true);
  return celula.closest("tr")!;
}

async function abrirFormulario(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: "Adicionar fornecedor" }));
  return screen.findByRole("dialog", { name: "Adicionar fornecedor ao item" });
}

/** Abre o seletor de fornecedor e escolhe pelo código, da primeira página. */
async function escolherFornecedor(dialogo: HTMLElement, codigo: string) {
  const campo = within(dialogo).getByPlaceholderText(/Digite código ou nome do fornecedor/);
  fireEvent.focus(campo);
  const opcao = await waitFor(() => {
    const listas = document.querySelectorAll<HTMLElement>("ul[role='listbox']");
    const lista = listas[listas.length - 1];
    const achada = lista
      ? Array.from(lista.querySelectorAll<HTMLElement>("[role='option']")).find(
          (li) => li.querySelector(".code")?.textContent === codigo,
        )
      : undefined;
    expect(achada).toBeTruthy();
    return achada!;
  });
  fireEvent.mouseDown(opcao);
  // Sem Escape para fechar a lista: escolher opção nova já fecha, e o Escape
  // chegaria ao modal, que pergunta se descarta a relação.
  await waitFor(() => expect(document.querySelector("ul[role='listbox']")).toBeNull());
}

describe("ITEM-SUPPLIER-UX-01 — lista de fornecedores do Item", () => {
  it("zero fornecedores: o vazio da seção, com a ação para quem adiciona e o caminho para quem não", async () => {
    await abrirSecao();
    expect(screen.getByText("Nenhum fornecedor cadastrado para este item.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar fornecedor" })).toBeInTheDocument();
  });

  it("zero fornecedores, perfil de consulta: diz a quem cabe adicionar", async () => {
    sessao.role = "VIEWER";
    await abrirSecao();
    expect(
      screen.getByText(
        "Nenhum fornecedor cadastrado para este item. Adicionar fornecedor é de Compras ou Administrador.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adicionar fornecedor" })).toBeNull();
  });

  it("um fornecedor: código, nome, código no fornecedor, homologação e a oferta de hoje com validade", async () => {
    servidor.relacoes = [
      relacao(PURIFARMA, {
        qualificationStatus: "APPROVED",
        supplierItemCode: "VC-ASC-001",
        currentOffer: {
          id: "of-1",
          supplierItemId: "si-for-1",
          unitPrice: "272",
          currencyCode: "BRL",
          priceUomCode: "kg",
          minimumOrderQuantity: null,
          minimumOrderUomCode: null,
          effectiveAt: "2026-09-01T12:00:00.000Z",
          validUntil: "2026-12-31T12:00:00.000Z",
          source: "MANUAL",
          notes: null,
          createdAt: "2026-09-01T12:00:00.000Z",
          createdByName: "Compras",
          isCurrent: true,
          eligibility: "ELIGIBLE",
        },
        offerCount: 1,
      }),
    ];
    await abrirSecao();

    const linha = linhaDe("PURIFARMA");
    expect(within(linha).getByText("FOR-000001")).toBeInTheDocument();
    expect(within(linha).getByText("Código no fornecedor: VC-ASC-001")).toBeInTheDocument();
    expect(within(linha).getByText("Homologado")).toBeInTheDocument();
    expect(linha).toHaveTextContent("272,00 BRL/kg");
    expect(within(linha).getByText("Válida até 31/12/2026")).toBeInTheDocument();
    expect(within(linha).queryByText("Preferencial")).toBeNull();
  });

  it("vários: preferencial primeiro, inativa no fim, e relação, fornecedor e homologação com marcas próprias", async () => {
    servidor.relacoes = [
      relacao(PURIFARMA, { qualificationStatus: "BLOCKED", active: false }),
      relacao(SWEETMIX, { qualificationStatus: "PENDING", supplierActive: false }),
      relacao(NUTRIFORT, { qualificationStatus: "APPROVED", preferred: true }),
    ];
    await abrirSecao();

    const linhas = screen.getAllByRole("row").slice(1);
    expect(linhas).toHaveLength(3);
    expect(linhas[0]).toHaveTextContent("NUTRIFORT");
    expect(within(linhas[0]!).getByText("Preferencial")).toBeInTheDocument();
    expect(within(linhas[0]!).getByText("Homologado")).toBeInTheDocument();

    expect(linhas[1]).toHaveTextContent("SWEETMIX");
    expect(within(linhas[1]!).getByText("Pendente")).toBeInTheDocument();
    expect(within(linhas[1]!).getByText("Fornecedor inativo")).toBeInTheDocument();
    expect(within(linhas[1]!).queryByText("Relação inativa")).toBeNull();

    // A relação inativa continua à vista: o histórico não some.
    expect(linhas[2]).toHaveTextContent("PURIFARMA");
    expect(within(linhas[2]!).getByText("Bloqueado")).toBeInTheDocument();
    expect(within(linhas[2]!).getByText("Relação inativa")).toBeInTheDocument();
    expect(within(linhas[2]!).queryByText("Fornecedor inativo")).toBeNull();

    expect(screen.getAllByText("Preferencial")).toHaveLength(1);
  });

  it("carregando e falha: a tabela não finge vazio", async () => {
    let falhar: (erro: Error) => void = () => {};
    vi.mocked(listSupplierItems).mockImplementationOnce(
      () =>
        new Promise((_resolver, rejeitar) => {
          falhar = rejeitar;
        }),
    );
    render(
      <RouterProvider
        router={createMemoryRouter(
          createRoutesFromElements(
            <Route
              element={
                <UnsavedChangesProvider>
                  <Outlet />
                </UnsavedChangesProvider>
              }
            >
              <Route path="/" element={<FornecedoresDoItemSection item={item()} />} />
            </Route>,
          ),
        )}
      />,
    );

    expect(await screen.findByText("Carregando…")).toBeInTheDocument();
    expect(screen.queryByText(/Nenhum fornecedor cadastrado/)).toBeNull();

    falhar(new Error("Não foi possível conectar ao sistema."));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível conectar ao sistema.");
    expect(screen.queryByText("Carregando…")).toBeNull();
    expect(screen.queryByText(/Nenhum fornecedor cadastrado/)).toBeNull();
  });

  it("em tela estreita a linha empilha: o nome do fornecedor não fica atrás das ações", async () => {
    servidor.relacoes = [relacao(PURIFARMA, { qualificationStatus: "APPROVED" })];
    sessao.role = "PURCHASING";
    await abrirSecao();
    expect(screen.getByRole("table").className).toContain("table--fornecedores-do-item");

    // Com a coluna de ações fixa, em 390px as duas ações cobriam o nome. jsdom
    // não faz layout: a medida é do smoke; aqui fica a regra.
    const css = readFileSync(join(process.cwd(), "src", "styles", "components.css"), "utf8").replace(/\r\n/g, "\n");
    const inicio = css.indexOf("@media (max-width: 640px) {\n  .table--fornecedores-do-item");
    expect(inicio).toBeGreaterThanOrEqual(0);
    const bloco = css.slice(inicio, css.indexOf("\n}\n", inicio));
    expect(bloco).toMatch(/\.table--fornecedores-do-item tr \{[^}]*display: grid;/);
    expect(bloco).toMatch(/\.table--fornecedores-do-item td:last-child \{[^}]*grid-column: 1 \/ -1;/);
    // A coluna de ações deixa de ser fixa, e a oferta pode quebrar linha.
    expect(bloco).toMatch(/td\.col-tight,\n\s*\.table--sticky-actions\.table--fornecedores-do-item td:last-child \{[^}]*position: static;[^}]*white-space: normal;/);
  });

  it("mostra a ambiguidade do custo onde a escolha se faz", async () => {
    servidor.relacoes = [
      relacao(PURIFARMA, { qualificationStatus: "APPROVED", costSourceAmbiguous: true }),
      relacao(SWEETMIX, { qualificationStatus: "APPROVED", costSourceAmbiguous: true }),
    ];
    await abrirSecao();
    expect(screen.getByText(/Defina o fornecedor preferencial para o sistema saber/)).toBeInTheDocument();
  });
});

describe("ITEM-SUPPLIER-UX-01 — quem faz o quê na seção e no detalhe aberto dela", () => {
  it.each(TODOS)(
    "%s: adicionar e definir preferencial só Compras e Administrador; homologar e bloquear só Qualidade e Administrador",
    async (role) => {
      sessao.role = role;
      servidor.relacoes = [
        relacao(PURIFARMA, { qualificationStatus: "APPROVED", preferred: true }),
        relacao(SWEETMIX, { qualificationStatus: "APPROVED" }),
      ];
      await abrirSecao();

      const mantem = MANTEM.includes(role);
      expect(Boolean(screen.queryByRole("button", { name: "Adicionar fornecedor" })), role).toBe(mantem);
      expect(screen.queryAllByRole("button", { name: "Definir como preferencial" }), role).toHaveLength(
        mantem ? 1 : 0,
      );
      // Abrir o detalhe é de todos.
      expect(screen.getAllByRole("button", { name: "Abrir" })).toHaveLength(2);

      fireEvent.click(within(linhaDe("SWEETMIX")).getByRole("button", { name: "Abrir" }));
      const dialogo = await screen.findByRole("dialog", { name: "Cafeína · SWEETMIX" });

      const decide = DECIDEM.includes(role);
      expect(Boolean(within(dialogo).queryByRole("button", { name: "Homologar" })), role).toBe(decide);
      expect(Boolean(within(dialogo).queryByRole("button", { name: "Bloquear" })), role).toBe(decide);
      expect(Boolean(within(dialogo).queryByRole("button", { name: "Marcar como preferencial" })), role).toBe(
        mantem,
      );
      expect(Boolean(within(dialogo).queryByRole("button", { name: "Registrar preço" })), role).toBe(mantem);
      expect(Boolean(within(dialogo).queryByRole("button", { name: "Inativar relação" })), role).toBe(mantem);
    },
  );

  it.each(CONSULTAM)("%s: consulta a seção e o detalhe sem nenhum botão que grave", async (role) => {
    sessao.role = role;
    servidor.relacoes = [relacao(PURIFARMA, { qualificationStatus: "PENDING" })];
    await abrirSecao();

    const secao = screen.getByRole("table");
    expect(within(secao).getAllByRole("button").map((botao) => botao.textContent)).toEqual(["Abrir"]);

    fireEvent.click(linhaDe("PURIFARMA"));
    const dialogo = await screen.findByRole("dialog", { name: "Cafeína · PURIFARMA" });
    // Só o ✕ do modal: nenhuma ação de gravação no detalhe.
    expect(within(dialogo).getAllByRole("button").map((botao) => botao.textContent?.trim())).toEqual([
      "✕ Fechar",
    ]);
  });

  it("Qualidade: não adiciona, e homologa pelo detalhe aberto da linha — a seção volta atualizada", async () => {
    sessao.role = "QUALITY";
    servidor.relacoes = [relacao(SWEETMIX, { qualificationStatus: "PENDING" })];
    await abrirSecao();
    expect(screen.queryByRole("button", { name: "Adicionar fornecedor" })).toBeNull();
    expect(within(linhaDe("SWEETMIX")).getByText("Pendente")).toBeInTheDocument();

    fireEvent.click(linhaDe("SWEETMIX"));
    const dialogo = await screen.findByRole("dialog", { name: "Cafeína · SWEETMIX" });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Homologar" }));
    await waitFor(() =>
      expect(changeSupplierItemQualification).toHaveBeenCalledWith("si-for-2", { status: "APPROVED" }),
    );
    await waitFor(() => expect(within(dialogo).getByRole("button", { name: "Homologar" })).toBeDisabled());

    fireEvent.click(within(dialogo).getByRole("button", { name: /Fechar/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(within(linhaDe("SWEETMIX")).getByText("Homologado")).toBeInTheDocument());
  });

  it("Qualidade: bloqueia pelo detalhe aberto da linha com o motivo obrigatório — o mesmo diálogo da tela geral (SUPPLIER-QUALITY-REJECTION-REASON-01)", async () => {
    sessao.role = "QUALITY";
    servidor.relacoes = [relacao(SWEETMIX, { qualificationStatus: "APPROVED" })];
    await abrirSecao();

    fireEvent.click(linhaDe("SWEETMIX"));
    const dialogo = await screen.findByRole("dialog", { name: "Cafeína · SWEETMIX" });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Bloquear" }));
    const confirmacao = await screen.findByRole("alertdialog", { name: "Bloquear fornecedor para este item" });
    const confirmar = within(confirmacao).getByRole("button", { name: "Bloquear" });
    expect(confirmar).toBeDisabled();
    expect(changeSupplierItemQualification).not.toHaveBeenCalled();

    fireEvent.change(within(confirmacao).getByLabelText(/^Motivo/), { target: { value: "Laudo reprovado" } });
    fireEvent.click(confirmar);
    await waitFor(() =>
      expect(changeSupplierItemQualification).toHaveBeenCalledWith("si-for-2", {
        status: "BLOCKED",
        note: "Laudo reprovado",
      }),
    );
    // Só a confirmação fecha: o detalhe continua aberto por cima do Item.
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("dialog", { name: "Cafeína · SWEETMIX" })).toBeInTheDocument();

    fireEvent.click(within(dialogo).getByRole("button", { name: /Fechar/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(within(linhaDe("SWEETMIX")).getByText("Bloqueado")).toBeInTheDocument());
  });

  it("Produto acabado: sem administração, com o porquê", async () => {
    await abrirSecao(item({ id: "item-pa", code: "PA-000001", type: "FINISHED_PRODUCT", name: "Cápsula" }));
    expect(screen.queryByRole("button", { name: "Adicionar fornecedor" })).toBeNull();
    expect(
      screen.getByText("Produto acabado é produzido, não comprado: não tem fornecedor cadastrado."),
    ).toBeInTheDocument();
  });

  it("Item inativo: Compras não recebe Adicionar fornecedor, e a tela diz o caminho", async () => {
    sessao.role = "PURCHASING";
    await abrirSecao(item({ active: false }));
    expect(screen.queryByRole("button", { name: "Adicionar fornecedor" })).toBeNull();
    expect(screen.getByText("Item inativo: para adicionar fornecedor, reative o item.")).toBeInTheDocument();
  });

  it("Material de embalagem administra como matéria-prima", async () => {
    sessao.role = "PURCHASING";
    await abrirSecao(item({ id: "item-me", code: "ME-000001", type: "PACKAGING", name: "Pote 60 cápsulas", unitCode: "un" }));
    expect(screen.getByRole("button", { name: "Adicionar fornecedor" })).toBeInTheDocument();
  });
});

describe("ITEM-SUPPLIER-UX-01 — adicionar fornecedor com o Item fixo", () => {
  it("Compras: o Item vem fixo e sem seletor, e a relação nasce Pendente para ESTE item", async () => {
    sessao.role = "PURCHASING";
    await abrirSecao();
    const dialogo = await abrirFormulario();

    // O Item é dito, não oferecido.
    expect(within(dialogo).queryByPlaceholderText(/Digite código ou nome do item/)).toBeNull();
    expect(dialogo.querySelector("#supplier-item-item")).toBeNull();
    const rotulo = within(dialogo).getByText("Item", { selector: "dt" });
    expect(rotulo.nextElementSibling).toHaveTextContent("MP-000003 Cafeína (kg)");
    expect(within(dialogo).getByText("Situação inicial").nextElementSibling).toHaveTextContent(/^Pendente$/);
    expect(within(dialogo).queryByLabelText(/^Situação$/)).toBeNull();
    // Só fornecedor ativo é oferecido: fornecedor inativo segue a recusa da API.
    await waitFor(() => expect(listSuppliers).toHaveBeenCalledWith(expect.objectContaining({ active: true })));

    await escolherFornecedor(dialogo, "FOR-000002");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Adicionar fornecedor" }));

    await waitFor(() => expect(createSupplierItem).toHaveBeenCalledTimes(1));
    const pedido = vi.mocked(createSupplierItem).mock.calls[0]![0];
    expect(pedido).toMatchObject({ itemId: "item-1", supplierId: "for-2" });
    expect(pedido).not.toHaveProperty("qualificationStatus");
    expect(pedido).not.toHaveProperty("preferred");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("SWEETMIX adicionado a este item — Pendente.")).toBeInTheDocument();
    expect(within(linhaDe("SWEETMIX")).getByText("Pendente")).toBeInTheDocument();
  });

  it("abrir e cancelar sem mexer não pergunta descarte — a unidade do Item é sugestão, não edição", async () => {
    sessao.role = "PURCHASING";
    await abrirSecao();
    const dialogo = await abrirFormulario();
    await waitFor(() => expect(within(dialogo).getByLabelText("Unidade do preço")).toHaveValue("kg"));

    fireEvent.click(within(dialogo).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(createSupplierItem).not.toHaveBeenCalled();
  });

  it("sem '+ Novo fornecedor': sair para cadastrar desmontaria o Item — a busca vazia diz onde cadastrar", async () => {
    sessao.role = "PURCHASING";
    await abrirSecao();
    const dialogo = await abrirFormulario();
    const campo = within(dialogo).getByPlaceholderText(/Digite código ou nome do fornecedor/);
    fireEvent.focus(campo);
    fireEvent.change(campo, { target: { value: "INEXISTENTE" } });

    expect(
      await screen.findByText(/Fornecedor novo se cadastra em Cadastros › Fornecedores\./, {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(document.querySelector(".entity-select__create")).toBeNull();
  });

  it("rascunho pendente de outro formulário da mesma rota não entra no Item fixo, nem é consumido", async () => {
    sessao.role = "PURCHASING";
    const token = startContextualCreate({
      originRoute: "/cadastros/itens",
      fieldKey: "supplierId",
      entityType: "supplier",
      draft: {
        itemId: "outro-item",
        supplierId: "for-3",
        supplierItemCode: "ALHEIO-1",
        commercialNotes: "rascunho de outra tela",
        qualificationStatus: "PENDING",
        qualificationNote: "",
        preferred: false,
        unitPrice: "",
        priceUomCode: "",
        minimumOrderQuantity: "",
        minimumOrderUomCode: "",
        effectiveAt: "2026-09-16",
        validUntil: "",
        offerNotes: "",
      },
    })!;
    finishContextualCreate(token, { entityType: "supplier", entityId: "for-3", label: "FOR-000003 · NUTRIFORT" });

    await abrirSecao(item(), `/cadastros/itens?${PARAM_RETOMAR}=${token}`);
    const dialogo = await abrirFormulario();

    expect(within(dialogo).getByLabelText("Código do item no fornecedor")).toHaveValue("");
    expect(within(dialogo).getByLabelText("Observações comerciais")).toHaveValue("");
    expect(within(dialogo).getByRole("button", { name: "Adicionar fornecedor" })).toBeDisabled();
    expect(readContextualCreate(token)).not.toBeNull();
  });

  it("Administrador: criar já preferencial pede confirmação dizendo quem sai, e manda o Item fixo", async () => {
    sessao.role = "ADMIN";
    servidor.relacoes = [relacao(PURIFARMA, { qualificationStatus: "APPROVED", preferred: true })];
    await abrirSecao();
    const dialogo = await abrirFormulario();

    await escolherFornecedor(dialogo, "FOR-000002");
    fireEvent.change(within(dialogo).getByLabelText(/^Situação$/), { target: { value: "APPROVED" } });
    fireEvent.click(within(dialogo).getByLabelText(/Fornecedor preferencial/));
    expect(within(dialogo).getByText("Um por item. Hoje é PURIFARMA, que deixa de ser.")).toBeInTheDocument();

    fireEvent.click(within(dialogo).getByRole("button", { name: "Adicionar fornecedor" }));
    const pergunta = await screen.findByRole("alertdialog", {
      name: "Definir SWEETMIX como fornecedor preferencial deste item?",
    });
    expect(pergunta).toHaveTextContent("SWEETMIX substituirá PURIFARMA como fornecedor preferencial.");
    expect(createSupplierItem).not.toHaveBeenCalled();

    fireEvent.click(within(pergunta).getByRole("button", { name: "Definir como preferencial" }));
    await waitFor(() => expect(createSupplierItem).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createSupplierItem).mock.calls[0]![0]).toMatchObject({
      itemId: "item-1",
      supplierId: "for-2",
      qualificationStatus: "APPROVED",
      preferred: true,
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getAllByText("Preferencial")).toHaveLength(1));
    expect(within(linhaDe("SWEETMIX")).getByText("Preferencial")).toBeInTheDocument();
  });
});

describe("ITEM-SUPPLIER-UX-01 — duplicidade leva à relação existente", () => {
  it("fornecedor que o item já tem: a frase de negócio, sem criar, e 'Abrir relação existente' abre o detalhe", async () => {
    sessao.role = "PURCHASING";
    servidor.relacoes = [relacao(PURIFARMA, { qualificationStatus: "APPROVED", active: false })];
    await abrirSecao();
    const dialogo = await abrirFormulario();

    await escolherFornecedor(dialogo, "FOR-000001");
    expect(
      within(dialogo).getByText(
        "PURIFARMA já está cadastrado para este item (relação inativa). Cada fornecedor tem uma relação só com o item.",
      ),
    ).toBeInTheDocument();
    expect(within(dialogo).getByRole("button", { name: "Adicionar fornecedor" })).toBeDisabled();

    // Só o fornecedor escolhido não é trabalho a perder: abre sem pergunta de descarte.
    fireEvent.click(within(dialogo).getByRole("button", { name: "Abrir relação existente" }));
    const existente = await screen.findByRole("dialog", { name: "Cafeína · PURIFARMA" });
    expect(screen.queryByRole("dialog", { name: "Adicionar fornecedor ao item" })).toBeNull();
    expect(getSupplierItem).toHaveBeenCalledWith("si-for-1");
    // A relação inativa se reativa no detalhe — Compras tem a ação.
    expect(within(existente).getByRole("button", { name: "Reativar relação" })).toBeInTheDocument();
    expect(createSupplierItem).not.toHaveBeenCalled();
  });

  it("com outro campo preenchido, abrir a existente pergunta antes de descartar", async () => {
    sessao.role = "PURCHASING";
    servidor.relacoes = [relacao(PURIFARMA, { qualificationStatus: "APPROVED" })];
    await abrirSecao();
    const dialogo = await abrirFormulario();

    fireEvent.change(within(dialogo).getByLabelText("Código do item no fornecedor"), {
      target: { value: "PF-99" },
    });
    await escolherFornecedor(dialogo, "FOR-000001");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Abrir relação existente" }));

    const pergunta = await screen.findByRole("alertdialog", { name: "Sair sem salvar?" });
    expect(screen.queryByRole("dialog", { name: "Cafeína · PURIFARMA" })).toBeNull();
    fireEvent.click(within(pergunta).getByRole("button", { name: "Sair sem salvar" }));
    expect(await screen.findByRole("dialog", { name: "Cafeína · PURIFARMA" })).toBeInTheDocument();
  });

  it("relação criada por outra pessoa depois da lista (409): a tela acha a relação e oferece abrir", async () => {
    sessao.role = "PURCHASING";
    await abrirSecao();
    const dialogo = await abrirFormulario();
    await escolherFornecedor(dialogo, "FOR-000002");

    // Enquanto o formulário estava aberto, a relação nasceu em outra tela.
    servidor.relacoes = [relacao(SWEETMIX, { id: "si-de-outra-tela", qualificationStatus: "PENDING" })];
    vi.mocked(createSupplierItem).mockRejectedValueOnce(
      new AlreadyExistsApiError("Este fornecedor já está cadastrado para o item."),
    );

    fireEvent.click(within(dialogo).getByRole("button", { name: "Adicionar fornecedor" }));
    expect(
      await within(dialogo).findByText(
        "SWEETMIX já está cadastrado para este item. Cada fornecedor tem uma relação só com o item.",
      ),
    ).toBeInTheDocument();
    expect(within(dialogo).queryByRole("alert")).toBeNull();
    expect(listSupplierItems).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "item-1", supplierId: "for-2" }),
    );

    fireEvent.click(within(dialogo).getByRole("button", { name: "Abrir relação existente" }));
    expect(await screen.findByRole("dialog", { name: "Cafeína · SWEETMIX" })).toBeInTheDocument();
    expect(getSupplierItem).toHaveBeenCalledWith("si-de-outra-tela");
  });
});

describe("ITEM-SUPPLIER-UX-01 — preferencial", () => {
  it("só relação ativa e homologada que ainda não é a preferencial recebe a ação", async () => {
    sessao.role = "PURCHASING";
    servidor.relacoes = [
      relacao(PURIFARMA, { qualificationStatus: "APPROVED", preferred: true }),
      relacao(SWEETMIX, { qualificationStatus: "APPROVED" }),
      relacao(NUTRIFORT, { qualificationStatus: "PENDING" }),
      relacao(fornecedor("for-4", "FOR-000004", "BLOQUEADA"), { qualificationStatus: "BLOCKED" }),
      relacao(fornecedor("for-5", "FOR-000005", "INATIVADA"), { qualificationStatus: "APPROVED", active: false }),
    ];
    await abrirSecao();

    const comAcao = screen
      .getAllByRole("button", { name: "Definir como preferencial" })
      .map((botao) => botao.closest("tr")!.textContent);
    expect(comAcao).toHaveLength(1);
    expect(comAcao[0]).toContain("SWEETMIX");
  });

  it("troca: confirma dizendo quem sai, UMA chamada à rota atômica, e a lista mostra um preferencial só", async () => {
    sessao.role = "PURCHASING";
    servidor.relacoes = [
      relacao(PURIFARMA, { qualificationStatus: "APPROVED", preferred: true }),
      relacao(SWEETMIX, { qualificationStatus: "APPROVED" }),
    ];
    await abrirSecao();
    const leiturasAntes = vi.mocked(listSupplierItems).mock.calls.length;

    fireEvent.click(within(linhaDe("SWEETMIX")).getByRole("button", { name: "Definir como preferencial" }));
    const pergunta = await screen.findByRole("alertdialog", {
      name: "Definir SWEETMIX como fornecedor preferencial deste item?",
    });
    expect(pergunta).toHaveTextContent("SWEETMIX substituirá PURIFARMA como fornecedor preferencial.");
    expect(setSupplierItemPreferred).not.toHaveBeenCalled();

    fireEvent.click(within(pergunta).getByRole("button", { name: "Definir como preferencial" }));

    await waitFor(() => expect(setSupplierItemPreferred).toHaveBeenCalledTimes(1));
    expect(setSupplierItemPreferred).toHaveBeenCalledWith("si-for-2", true);
    // Nada de "desmarcar PURIFARMA" pelo navegador: a troca é da API.
    expect(updateSupplierItem).not.toHaveBeenCalled();

    await waitFor(() => expect(vi.mocked(listSupplierItems).mock.calls.length).toBeGreaterThan(leiturasAntes));
    await waitFor(() => expect(within(linhaDe("SWEETMIX")).getByText("Preferencial")).toBeInTheDocument());
    expect(screen.getAllByText("Preferencial")).toHaveLength(1);
    expect(within(linhaDe("PURIFARMA")).queryByText("Preferencial")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("SWEETMIX é o fornecedor preferencial deste item.");
  });

  it("sem preferencial hoje, a confirmação diz isso; cancelar não chama nada", async () => {
    sessao.role = "ADMIN";
    servidor.relacoes = [relacao(SWEETMIX, { qualificationStatus: "APPROVED" })];
    await abrirSecao();

    fireEvent.click(within(linhaDe("SWEETMIX")).getByRole("button", { name: "Definir como preferencial" }));
    const pergunta = await screen.findByRole("alertdialog");
    expect(pergunta).toHaveTextContent("Hoje este item não tem fornecedor preferencial.");
    expect(pergunta).not.toHaveTextContent("substituirá");

    fireEvent.click(within(pergunta).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(setSupplierItemPreferred).not.toHaveBeenCalled();
    expect(within(linhaDe("SWEETMIX")).queryByText("Preferencial")).toBeNull();
  });

  it("recusa da API aparece com as palavras dela, e a lista volta do servidor", async () => {
    sessao.role = "PURCHASING";
    servidor.relacoes = [relacao(SWEETMIX, { qualificationStatus: "APPROVED" })];
    await abrirSecao();
    const leiturasAntes = vi.mocked(listSupplierItems).mock.calls.length;
    vi.mocked(setSupplierItemPreferred).mockRejectedValueOnce(
      new Error("Só um fornecedor homologado e ativo pode ser o preferencial do item."),
    );

    fireEvent.click(within(linhaDe("SWEETMIX")).getByRole("button", { name: "Definir como preferencial" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Definir como preferencial" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Só um fornecedor homologado e ativo pode ser o preferencial do item.",
    );
    await waitFor(() => expect(vi.mocked(listSupplierItems).mock.calls.length).toBeGreaterThan(leiturasAntes));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("no detalhe aberto do Item, marcar confirma quem sai; remover segue direto; e a frase acompanha o que foi gravado", async () => {
    sessao.role = "ADMIN";
    servidor.relacoes = [
      relacao(PURIFARMA, { qualificationStatus: "APPROVED", preferred: true }),
      relacao(SWEETMIX, { qualificationStatus: "APPROVED" }),
    ];
    await abrirSecao();

    fireEvent.click(linhaDe("SWEETMIX"));
    const dialogo = await screen.findByRole("dialog", { name: "Cafeína · SWEETMIX" });

    fireEvent.click(within(dialogo).getByRole("button", { name: "Marcar como preferencial" }));
    let pergunta = await screen.findByRole("alertdialog");
    expect(pergunta).toHaveTextContent("SWEETMIX substituirá PURIFARMA como fornecedor preferencial.");
    fireEvent.click(within(pergunta).getByRole("button", { name: "Definir como preferencial" }));
    await within(dialogo).findByRole("button", { name: "Remover preferencial" });
    expect(setSupplierItemPreferred).toHaveBeenCalledWith("si-for-2", true);

    fireEvent.click(within(dialogo).getByRole("button", { name: "Remover preferencial" }));
    await within(dialogo).findByRole("button", { name: "Marcar como preferencial" });
    expect(setSupplierItemPreferred).toHaveBeenLastCalledWith("si-for-2", false);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    // PURIFARMA saiu na troca e SWEETMIX foi removido: o item não tem preferencial.
    fireEvent.click(within(dialogo).getByRole("button", { name: "Marcar como preferencial" }));
    pergunta = await screen.findByRole("alertdialog");
    expect(pergunta).toHaveTextContent("Hoje este item não tem fornecedor preferencial.");
  });
});
