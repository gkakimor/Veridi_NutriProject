import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type {
  CustomerDTO,
  FormulationTemplateDTO,
  ItemDTO,
  ProductDTO,
  SupplierDTO,
} from "@veridi/shared";

/**
 * Criação no contexto quando o campo NAVEGA.
 *
 * O modal aninhado saiu: "+ Novo X" leva à tela oficial de cadastro, com
 * URL própria, e o rascunho de quem estava preenchendo viaja por fora da
 * árvore de componentes. O que estes testes protegem é o contrato dos três
 * formatos de origem:
 *
 * - **campo simples** (Cliente proprietário, no material do cliente);
 * - **coluna de tabela** (Item, na matriz de formulação), onde é preciso
 *   lembrar QUAL linha pediu;
 * - **hospedeiro que é modal** (Item × Fornecedor), onde sair DESMONTA o
 *   formulário e alguém precisa reabri-lo na volta.
 *
 * Os três casos têm a mesma prova em três tempos: sair guarda o rascunho e
 * navega; voltar COM resultado restaura e seleciona pelo id; voltar SEM
 * resultado restaura e não seleciona nada.
 */

vi.mock("../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../lib/items-api", () => ({ listItems: vi.fn(), getItem: vi.fn() }));
vi.mock("../lib/units-api", () => ({ listUnits: vi.fn() }));
vi.mock("../lib/suppliers-api", () => ({ listSuppliers: vi.fn() }));
vi.mock("../lib/receiving-api", () => ({ createCustomerSuppliedReceipt: vi.fn() }));
vi.mock("../lib/products-api", () => ({ listProducts: vi.fn(), getProduct: vi.fn() }));
vi.mock("../lib/shipments-api", () => ({
  createShipmentDraft: vi.fn(),
  getReservationStatus: vi.fn(),
  reallocateReservationLine: vi.fn(),
  reserveAvailable: vi.fn(),
}));
vi.mock("../lib/customer-orders-api", () => ({
  applyFulfillmentPlan: vi.fn(),
  cancelCustomerOrder: vi.fn(),
  confirmCustomerOrder: vi.fn(),
  createCustomerOrder: vi.fn(),
  createRemainderProductionOrder: vi.fn(),
  generatePurchaseDrafts: vi.fn(),
  getCustomerOrder: vi.fn(),
  getFulfillmentPlan: vi.fn(),
  getPlanPurchaseSourcing: vi.fn(),
  getPurchaseSuggestion: vi.fn(),
  updateCustomerOrder: vi.fn(),
}));
vi.mock("../lib/formulation-templates-api", () => ({
  getFormulationTemplate: vi.fn(),
  updateFormulationTemplate: vi.fn(),
  updateFormulationTemplateVersion: vi.fn(),
  activateFormulationTemplateVersion: vi.fn(),
  createTemplateVersionFrom: vi.fn(),
  setFormulationTemplateArchived: vi.fn(),
  compareTemplateVersions: vi.fn(),
}));
vi.mock("../lib/supplier-items-api", () => ({
  listSupplierItems: vi.fn(),
  getSupplierItem: vi.fn(),
  createSupplierItem: vi.fn(),
  updateSupplierItem: vi.fn(),
  changeSupplierItemQualification: vi.fn(),
  setSupplierItemPreferred: vi.fn(),
  createSupplierItemOffer: vi.fn(),
}));
vi.mock("../app/AuthProvider", () => ({ useAuth: vi.fn() }));

import { listCustomers } from "../lib/customers-api";
import { getProduct, listProducts } from "../lib/products-api";
import { getItem, listItems } from "../lib/items-api";
import { listUnits } from "../lib/units-api";
import { listSuppliers } from "../lib/suppliers-api";
import { getFormulationTemplate } from "../lib/formulation-templates-api";
import { listSupplierItems } from "../lib/supplier-items-api";
import { useAuth } from "../app/AuthProvider";
import {
  PARAM_ORIGEM,
  PARAM_RETOMAR,
  finishContextualCreate,
  readContextualCreate,
  startContextualCreate,
} from "../lib/contextual-create";
import { CustomerOrderPage } from "./customer-orders/CustomerOrderPage";
import { ReceiveCustomerMaterialPage } from "./receiving/ReceiveCustomerMaterialPage";
import { FormulationTemplateDetailPage } from "./formulation-templates/FormulationTemplateDetailPage";
import { SupplierItemsPage } from "./supplier-items/SupplierItemsPage";

const CLIENTE_EXISTENTE = {
  id: "cli-1",
  code: "CLI-000001",
  legalName: "Vida Saudável Ltda",
  tradeName: "Vida Saudável",
  active: true,
} as unknown as CustomerDTO;

const CLIENTE_NOVO = {
  id: "cli-novo",
  code: "CLI-000042",
  legalName: "Nutrição Viva Indústria Ltda",
  tradeName: "Nutri Viva",
  active: true,
} as unknown as CustomerDTO;

const ITEM_EXISTENTE = {
  id: "item-1",
  code: "MP-000001",
  name: "Maltodextrina",
  type: "RAW_MATERIAL",
  unitCode: "kg",
  active: true,
  controlsLot: true,
  unit: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
} as unknown as ItemDTO;

const ITEM_NOVO = {
  id: "item-novo",
  code: "MP-000777",
  name: "Creatina monoidratada",
  type: "RAW_MATERIAL",
  unitCode: "kg",
  active: true,
  controlsLot: true,
  unit: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
} as unknown as ItemDTO;

const PRODUTO_EXISTENTE = {
  id: "prod-1",
  code: "PROD-000001",
  name: "Whey Protein 900g",
  customerId: CLIENTE_EXISTENTE.id,
  active: true,
  lifecycle: "APPROVED",
  finishedProductItem: { id: "fpi-1", code: "PA-000001", unitCode: "un" },
} as unknown as ProductDTO;

const PRODUTO_NOVO = {
  id: "prod-novo",
  code: "PROD-000042",
  name: "Coenzima Q10 60 cápsulas",
  customerId: CLIENTE_EXISTENTE.id,
  active: true,
  lifecycle: "APPROVED",
  finishedProductItem: { id: "fpi-2", code: "PA-000042", unitCode: "un" },
} as unknown as ProductDTO;

const FORNECEDOR = {
  id: "for-1",
  code: "FOR-000003",
  legalName: "SweetMix Indústria Ltda",
  tradeName: "SweetMix",
  active: true,
} as unknown as SupplierDTO;

/** A URL corrente, para provar navegação em vez de camada por cima. */
function Localizacao() {
  const location = useLocation();
  return <span data-testid="url">{`${location.pathname}${location.search}`}</span>;
}

function urlAtual(): string {
  return screen.getByTestId("url").textContent ?? "";
}

/**
 * Os campos são buscados pelo `id` que a tela dá a eles.
 *
 * `getByLabelText` não serve: os rótulos hospedam o ⓘ de ajuda, que é um
 * `button` dentro do `<label>` — a consulta acha dois elementos e falha por
 * ambiguidade sem que nada esteja errado na tela.
 */
function campo(id: string): HTMLInputElement {
  const elemento = document.getElementById(id);
  if (!elemento) throw new Error(`Campo #${id} não está na tela.`);
  return elemento as HTMLInputElement;
}

/** Opções da lista aberta — o `listbox` sai por portal. */
function opcoes(): HTMLElement[] {
  const lista = screen.getAllByRole("listbox").at(-1)!;
  return within(lista).getAllByRole("option");
}

/** Digita no campo e aciona o "+ Novo …", que encabeça a lista. */
async function acionarCadastro(
  user: ReturnType<typeof userEvent.setup>,
  alvo: HTMLElement,
  termo: string,
) {
  await user.type(alvo, termo);
  await user.click(opcoes()[0]!);
}

/** O token que a tela de cadastro recebeu na URL. */
function tokenDaUrl(): string {
  const busca = urlAtual().split("?")[1] ?? "";
  const token = new URLSearchParams(busca).get(PARAM_ORIGEM);
  if (!token) throw new Error(`A URL ${urlAtual()} não leva token de origem.`);
  return token;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  // Metade destes casos afirma que algo NÃO aconteceu: rascunho e chamada de
  // API não podem vazar de um teste para o seguinte.
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "u1", name: "Admin", email: "a@b.c", role: "ADMIN" },
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(listUnits).mockResolvedValue([
    { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  ] as never);
  vi.mocked(listCustomers).mockResolvedValue({ customers: [CLIENTE_EXISTENTE] } as never);
  // Matéria-prima e embalagem são duas chamadas na mesma tela: devolver o
  // mesmo item nas duas duplicaria a opção na lista.
  vi.mocked(listItems).mockImplementation((params) =>
    Promise.resolve({
      items: params?.type === "PACKAGING" ? [] : [ITEM_EXISTENTE],
    } as never),
  );
  vi.mocked(listSuppliers).mockResolvedValue({ suppliers: [FORNECEDOR] } as never);
  vi.mocked(listProducts).mockResolvedValue({ products: [PRODUTO_EXISTENTE] } as never);
  vi.mocked(getProduct).mockResolvedValue(PRODUTO_NOVO);
  vi.mocked(getItem).mockResolvedValue(ITEM_NOVO);
});

/* ------------------------------------------------------------------ *
 * Coluna de tabela num documento com trinta `useState` — Pedido.
 * ------------------------------------------------------------------ */

const ROTA_PEDIDO = "/comercial/pedidos/novo";

/** Os seletores de produto das linhas, em ordem. */
function camposDeProduto(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[id^="pedido-produto-"]'));
}

describe("Coluna que navega — Produto (pedido de venda)", () => {
  function renderPage(entrada = ROTA_PEDIDO) {
    render(
      <MemoryRouter initialEntries={[entrada]}>
        <Routes>
          <Route path={ROTA_PEDIDO} element={<CustomerOrderPage />} />
          <Route path="/cadastros/produtos/novo" element={<p>cadastro de produto</p>} />
          <Route path="/cadastros/clientes/novo" element={<p>cadastro de cliente</p>} />
        </Routes>
        <Localizacao />
      </MemoryRouter>,
    );
  }

  /** O pedido como quem estava digitando deixou. */
  function rascunhoDoPedido() {
    return {
      customerId: CLIENTE_EXISTENTE.id,
      requestedDeliveryDate: "2026-10-15",
      notes: "entregar na filial",
      lines: [
        {
          key: "row-1",
          productId: PRODUTO_EXISTENTE.id,
          productCode: "PROD-000001",
          productName: "Whey Protein 900g",
          unitCode: "un",
          orderedQuantity: "40",
        },
        {
          key: "row-2",
          productId: "",
          productCode: "",
          productName: "",
          unitCode: "",
          orderedQuantity: "12",
        },
      ],
    };
  }

  it("o rascunho são QUATRO campos, não os trinta da tela", async () => {
    const user = userEvent.setup();
    renderPage();

    // Cliente escolhido: o produto que nasce do pedido é DELE. O índice 0 é
    // o "+ Novo cliente", que encabeça a lista sempre.
    await user.type(await screen.findByLabelText(/Cliente/), "Vida");
    await user.click(opcoes()[1]!);

    await user.click(screen.getByRole("button", { name: /Adicionar produto/ }));
    await user.click(screen.getByRole("button", { name: /Adicionar produto/ }));
    await waitFor(() => expect(camposDeProduto()).toHaveLength(2));

    // A SEGUNDA linha é quem pede; a chave dela é lida antes da navegação,
    // que desmonta a tela.
    const segundaLinha = camposDeProduto()[1]!;
    const chaveEsperada = segundaLinha.id.replace("pedido-produto-", "");
    await acionarCadastro(user, segundaLinha, "produto que ainda nao existe");

    expect(await screen.findByText("cadastro de produto")).toBeInTheDocument();
    const registro = readContextualCreate(tokenDaUrl());
    expect(registro?.entityType).toBe("product");
    expect(registro?.fieldKey).toBe("productId");
    expect(registro?.originRoute).toBe(ROTA_PEDIDO);

    // O rascunho é o documento em edição e nada mais: plano, sourcing,
    // sugestão de compra, reserva e diálogos são derivados do servidor e
    // voltam de lá.
    expect(Object.keys(registro?.draft ?? {}).sort()).toEqual([
      "customerId",
      "lines",
      "notes",
      "requestedDeliveryDate",
    ]);

    // A linha que pediu, e o cliente do pedido — que a tela oficial usa
    // para não oferecer o produto de um cliente dentro do documento de
    // outro.
    expect(registro?.context).toMatchObject({
      customerId: CLIENTE_EXISTENTE.id,
      customerLabel: "Vida Saudável",
    });
    expect((registro?.context as { rowKey: string }).rowKey).toBe(chaveEsperada);
  });

  it("voltar COM resultado põe o produto na LINHA que pediu, pelo id", async () => {
    const token = startContextualCreate({
      originRoute: ROTA_PEDIDO,
      fieldKey: "productId",
      entityType: "product",
      draft: rascunhoDoPedido(),
      context: { rowKey: "row-2", customerId: CLIENTE_EXISTENTE.id },
    })!;
    finishContextualCreate(token, {
      entityType: "product",
      entityId: "prod-novo",
      label: "Coenzima Q10 60 cápsulas",
    });
    /*
     * A tela recarrega o catálogo na volta, e o produto novo estará nele —
     * mas aqui ele NÃO está: é a busca pelo id que tem de pôr a opção no
     * seletor, e é isso que este caso prova.
     */

    renderPage(`${ROTA_PEDIDO}?${PARAM_RETOMAR}=${token}`);

    await waitFor(() => expect(camposDeProduto()).toHaveLength(2));
    await waitFor(() =>
      expect(camposDeProduto()[1]!.value).toBe("PROD-000042 · Coenzima Q10 60 cápsulas"),
    );
    // Linha 1 e o resto do pedido, intocados.
    expect(camposDeProduto()[0]!.value).toBe("PROD-000001 · Whey Protein 900g");
    expect(vi.mocked(getProduct)).toHaveBeenCalledWith("prod-novo");
    expect(screen.getByDisplayValue("entregar na filial")).toBeInTheDocument();
    expect(screen.getByDisplayValue("12")).toBeInTheDocument();
    await waitFor(() => expect(urlAtual()).toBe(ROTA_PEDIDO));
  });

  it("voltar SEM resultado restaura o pedido e não escolhe produto nenhum", async () => {
    const token = startContextualCreate({
      originRoute: ROTA_PEDIDO,
      fieldKey: "productId",
      entityType: "product",
      draft: rascunhoDoPedido(),
      context: { rowKey: "row-2" },
    })!;

    renderPage(`${ROTA_PEDIDO}?${PARAM_RETOMAR}=${token}`);

    await waitFor(() => expect(camposDeProduto()).toHaveLength(2));
    expect(screen.getByDisplayValue("entregar na filial")).toBeInTheDocument();
    expect(camposDeProduto()[0]!.value).toBe("PROD-000001 · Whey Protein 900g");
    // A linha que pediu continua vazia, e nada foi buscado.
    expect(camposDeProduto()[1]!.value).toBe("");
    expect(vi.mocked(getProduct)).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * Campo simples — Cliente proprietário, no material do cliente.
 * ------------------------------------------------------------------ */

const ROTA_RECEBIMENTO = "/compras/recebimentos/material-do-cliente";

describe("Campo que navega — Cliente proprietário (material do cliente)", () => {
  function renderPage(entrada = ROTA_RECEBIMENTO) {
    render(
      <MemoryRouter initialEntries={[entrada]}>
        <Routes>
          <Route path={ROTA_RECEBIMENTO} element={<ReceiveCustomerMaterialPage />} />
          <Route path="/cadastros/clientes/novo" element={<p>cadastro de cliente</p>} />
        </Routes>
        <Localizacao />
      </MemoryRouter>,
    );
  }

  /** O recebimento como quem estava na doca deixou. */
  function rascunhoDoRecebimento() {
    return {
      customerId: "",
      receivedAt: "2026-09-01",
      documentReference: "REM-2026-0031",
      invoiceNumber: "",
      notes: "conferido na doca",
      lines: [
        {
          key: "linha-1",
          itemId: ITEM_EXISTENTE.id,
          receivedQuantity: "120",
          supplierLot: "L-9911",
          expiryDate: "",
          location: "",
        },
      ],
    };
  }

  it("sair para cadastrar guarda o rascunho e NAVEGA", async () => {
    const user = userEvent.setup();
    renderPage();

    const documento = await screen.findByLabelText(/Documento de remessa/);
    await user.type(documento, "REM-2026-0031");
    await user.type(screen.getByLabelText("Quantidade recebida"), "120");

    // O termo digitado não é o nome de ninguém: é isso que separa
    // "selecionou pelo id" de "ecoou o texto digitado".
    await acionarCadastro(user, campo("customer-receipt-customer"), "cliente que ainda nao existe");

    // Navegou de verdade: a tela de cliente é outra ROTA, não uma camada por
    // cima do recebimento.
    expect(await screen.findByText("cadastro de cliente")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Documento de remessa/)).not.toBeInTheDocument();
    expect(urlAtual().startsWith(`/cadastros/clientes/novo?${PARAM_ORIGEM}=`)).toBe(true);

    const registro = readContextualCreate(tokenDaUrl());
    expect(registro?.fieldKey).toBe("customerId");
    expect(registro?.entityType).toBe("customer");
    expect(registro?.originRoute).toBe(ROTA_RECEBIMENTO);
    expect(registro?.draft).toMatchObject({
      documentReference: "REM-2026-0031",
      lines: [expect.objectContaining({ receivedQuantity: "120" })],
    });
    // Só o formulário: catálogo carregado do servidor não é rascunho.
    expect(registro?.draft).not.toHaveProperty("customers");
    expect(registro?.draft).not.toHaveProperty("items");
  });

  it("voltar COM resultado restaura o rascunho e seleciona pelo id", async () => {
    const token = startContextualCreate({
      originRoute: ROTA_RECEBIMENTO,
      fieldKey: "customerId",
      entityType: "customer",
      draft: rascunhoDoRecebimento(),
    })!;
    // Foi o que a tela oficial de Cliente registrou ao salvar.
    finishContextualCreate(token, {
      entityType: "customer",
      entityId: CLIENTE_NOVO.id,
      label: CLIENTE_NOVO.legalName,
    });
    // Na volta a tela recarrega o catálogo, e o cliente novo está nele.
    vi.mocked(listCustomers).mockResolvedValue({
      customers: [CLIENTE_EXISTENTE, CLIENTE_NOVO],
    } as never);

    renderPage(`${ROTA_RECEBIMENTO}?${PARAM_RETOMAR}=${token}`);

    expect(await screen.findByDisplayValue("REM-2026-0031")).toBeInTheDocument();
    expect(screen.getByDisplayValue("conferido na doca")).toBeInTheDocument();
    expect(screen.getByLabelText("Quantidade recebida")).toHaveValue("120");
    expect(screen.getByLabelText("Lote do fabricante")).toHaveValue("L-9911");

    // Pelo id: o campo mostra o registro criado, não o texto digitado.
    await waitFor(() =>
      expect(campo("customer-receipt-customer")).toHaveValue(
        "CLI-000042 · Nutrição Viva Indústria Ltda",
      ),
    );

    // O `?retomar=` some da URL: um F5 não pode retomar o mesmo contexto.
    await waitFor(() => expect(urlAtual()).toBe(ROTA_RECEBIMENTO));
    expect(readContextualCreate(token)).toBeNull();
  });

  it("voltar SEM resultado restaura o rascunho e não seleciona ninguém", async () => {
    const token = startContextualCreate({
      originRoute: ROTA_RECEBIMENTO,
      fieldKey: "customerId",
      entityType: "customer",
      draft: rascunhoDoRecebimento(),
    })!;

    renderPage(`${ROTA_RECEBIMENTO}?${PARAM_RETOMAR}=${token}`);

    expect(await screen.findByDisplayValue("REM-2026-0031")).toBeInTheDocument();
    expect(screen.getByLabelText("Quantidade recebida")).toHaveValue("120");
    /*
     * Nada escolhido, e o campo continua VAZIO. A prova é dupla: o
     * "Limpar seleção" só existe com opção escolhida, e o recebimento segue
     * sem poder ser confirmado, o que só acontece com `customerId` vazio.
     */
    expect(campo("customer-receipt-customer")).toHaveValue("");
    expect(screen.queryByLabelText("Limpar seleção")).toBeNull();
    expect(screen.getByRole("button", { name: /Confirmar recebimento/ })).toBeDisabled();
  });
});

/* ------------------------------------------------------------------ *
 * Coluna de tabela — Item, na matriz de formulação.
 * ------------------------------------------------------------------ */

const ROTA_TEMPLATE = "/producao/templates-formulacao/tpl-1";
/** Chave da segunda linha: `${id do componente}-${índice}`. */
const LINHA_2 = "comp-2-1";

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
        itemId: ITEM_EXISTENTE.id,
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

describe("Coluna que navega — Item (template de formulação)", () => {
  beforeEach(() => {
    vi.mocked(getFormulationTemplate).mockResolvedValue(templateComRascunho());
  });

  function renderPage(entrada = ROTA_TEMPLATE) {
    render(
      <MemoryRouter initialEntries={[entrada]}>
        <Routes>
          <Route
            path="/producao/templates-formulacao/:templateId"
            element={<FormulationTemplateDetailPage />}
          />
          <Route path="/cadastros/itens/novo" element={<p>cadastro de item</p>} />
        </Routes>
        <Localizacao />
      </MemoryRouter>,
    );
  }

  /** A matriz como quem estava montando deixou, com a base já mexida. */
  function rascunhoDaMatriz() {
    return {
      nome: "Base proteica",
      descricao: "",
      base: "25",
      unidade: "kg",
      linhas: [
        { chave: "comp-1-0", itemId: ITEM_EXISTENTE.id, quantity: "10", unitCode: "kg" },
        { chave: LINHA_2, itemId: "", quantity: "3", unitCode: "" },
      ],
    };
  }

  it("sair para cadastrar guarda a linha que pediu, junto do rascunho", async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(camposDeItem()).toHaveLength(2));

    const base = campo("template-base");
    await user.clear(base);
    await user.type(base, "25");

    // A SEGUNDA linha é quem pede: sem guardar qual, o item voltaria para a
    // primeira — que já está resolvida.
    await acionarCadastro(user, camposDeItem()[1]!, "creatina que ainda nao existe");

    expect(await screen.findByText("cadastro de item")).toBeInTheDocument();
    const registro = readContextualCreate(tokenDaUrl());
    expect(registro?.entityType).toBe("item");
    expect(registro?.fieldKey).toBe("itemId");
    expect(registro?.originRoute).toBe(ROTA_TEMPLATE);
    expect(registro?.context).toEqual({ rowKey: LINHA_2 });
    expect(registro?.draft).toMatchObject({ base: "25" });
    // Só o rascunho: o catálogo de itens volta do servidor.
    expect(registro?.draft).not.toHaveProperty("items");
  });

  it("voltar COM resultado põe o item na LINHA que pediu, pelo id", async () => {
    const token = startContextualCreate({
      originRoute: ROTA_TEMPLATE,
      fieldKey: "itemId",
      entityType: "item",
      draft: rascunhoDaMatriz(),
      context: { rowKey: LINHA_2 },
    })!;
    finishContextualCreate(token, {
      entityType: "item",
      entityId: ITEM_NOVO.id,
      label: ITEM_NOVO.name,
    });

    renderPage(`${ROTA_TEMPLATE}?${PARAM_RETOMAR}=${token}`);

    await waitFor(() => expect(camposDeItem()).toHaveLength(2));
    // O item novo foi para a linha 2, resolvido PELO ID — não pelo texto.
    await waitFor(() =>
      expect(camposDeItem()[1]!.value).toBe("MP-000777 · Creatina monoidratada"),
    );
    // Linha 1 intocada.
    expect(camposDeItem()[0]!.value).toBe("MP-000001 · Maltodextrina");
    /*
     * A base digitada sobreviveu — e isto prova mais que a restauração: a
     * carga do template chega junto, trazendo "1" do servidor, e o rascunho
     * é quem ganha nesta primeira carga.
     */
    expect(campo("template-base")).toHaveValue("25");
    await waitFor(() => expect(urlAtual()).toBe(ROTA_TEMPLATE));
  });

  it("voltar SEM resultado restaura o rascunho e não escolhe item nenhum", async () => {
    const token = startContextualCreate({
      originRoute: ROTA_TEMPLATE,
      fieldKey: "itemId",
      entityType: "item",
      draft: rascunhoDaMatriz(),
      context: { rowKey: LINHA_2 },
    })!;

    renderPage(`${ROTA_TEMPLATE}?${PARAM_RETOMAR}=${token}`);

    await waitFor(() => expect(camposDeItem()).toHaveLength(2));
    expect(campo("template-base")).toHaveValue("25");
    expect(camposDeItem()[0]!.value).toBe("MP-000001 · Maltodextrina");
    // A linha que pediu continua vazia: cancelar não escolhe nada.
    expect(camposDeItem()[1]!.value).toBe("");
    expect(vi.mocked(getItem)).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * Hospedeiro que é modal — Item × Fornecedor.
 * ------------------------------------------------------------------ */

const ROTA_RELACAO = "/compras/item-fornecedor";

describe("Origem que é modal — Item × Fornecedor", () => {
  beforeEach(() => {
    vi.mocked(listSupplierItems).mockResolvedValue({
      supplierItems: [],
      total: 0,
      page: 1,
      pageSize: 20,
    } as never);
  });

  function renderPage(entrada = ROTA_RELACAO) {
    render(
      <MemoryRouter initialEntries={[entrada]}>
        <Routes>
          <Route path={ROTA_RELACAO} element={<SupplierItemsPage />} />
          <Route path="/cadastros/itens/novo" element={<p>cadastro de item</p>} />
        </Routes>
        <Localizacao />
      </MemoryRouter>,
    );
  }

  function rascunhoDaRelacao() {
    return {
      itemId: "",
      supplierId: FORNECEDOR.id,
      supplierItemCode: "VC-ASC-001",
      commercialNotes: "",
      qualificationStatus: "PENDING" as const,
      qualificationNote: "",
      preferred: false,
      unitPrice: "",
      priceUomCode: "",
      minimumOrderQuantity: "",
      minimumOrderUomCode: "",
      effectiveAt: "",
      validUntil: "",
      offerNotes: "",
    };
  }

  it("a relação aberta mora na URL, e sair para cadastrar guarda o rascunho", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Nova relação" }));
    // O formulário é modal: quem o reabre na volta é a URL da listagem.
    expect(urlAtual()).toBe(`${ROTA_RELACAO}?nova=1`);

    await user.type(campo("supplier-item-code"), "VC-ASC-001");
    await acionarCadastro(user, campo("supplier-item-item"), "item que ainda nao existe");

    expect(await screen.findByText("cadastro de item")).toBeInTheDocument();
    const registro = readContextualCreate(tokenDaUrl());
    expect(registro?.entityType).toBe("item");
    expect(registro?.fieldKey).toBe("itemId");
    // Com `?nova=1`: é a rota de volta que faz o modal existir de novo.
    expect(registro?.originRoute).toBe(`${ROTA_RELACAO}?nova=1`);
    expect(registro?.draft).toMatchObject({ supplierItemCode: "VC-ASC-001" });
  });

  it("voltar COM resultado reabre o formulário, restaura e seleciona pelo id", async () => {
    const token = startContextualCreate({
      originRoute: `${ROTA_RELACAO}?nova=1`,
      fieldKey: "itemId",
      entityType: "item",
      draft: rascunhoDaRelacao(),
    })!;
    finishContextualCreate(token, {
      entityType: "item",
      entityId: ITEM_NOVO.id,
      label: ITEM_NOVO.name,
    });
    // A listagem remonta e recarrega o catálogo — o item novo está nele.
    vi.mocked(listItems).mockResolvedValue({ items: [ITEM_EXISTENTE, ITEM_NOVO] } as never);

    renderPage(`${ROTA_RELACAO}?nova=1&${PARAM_RETOMAR}=${token}`);

    // O modal voltou a existir sozinho: é o `?nova=1` que o reabre.
    expect(
      await screen.findByRole("heading", { name: /Nova relação item × fornecedor/ }),
    ).toBeInTheDocument();
    expect(campo("supplier-item-code")).toHaveValue("VC-ASC-001");

    await waitFor(() =>
      expect(campo("supplier-item-item")).toHaveValue("MP-000777 · Creatina monoidratada"),
    );
    // O fornecedor que já estava escolhido continua escolhido.
    await waitFor(() =>
      expect(campo("supplier-item-supplier")).toHaveValue(
        "FOR-000003 · SweetMix Indústria Ltda",
      ),
    );

    // `?retomar=` some; `?nova=1` fica, porque o modal continua aberto.
    await waitFor(() => expect(urlAtual()).toBe(`${ROTA_RELACAO}?nova=1`));
    expect(readContextualCreate(token)).toBeNull();
  });

  it("voltar SEM resultado reabre o formulário sem escolher item nenhum", async () => {
    const token = startContextualCreate({
      originRoute: `${ROTA_RELACAO}?nova=1`,
      fieldKey: "itemId",
      entityType: "item",
      draft: rascunhoDaRelacao(),
    })!;

    renderPage(`${ROTA_RELACAO}?nova=1&${PARAM_RETOMAR}=${token}`);

    expect(
      await screen.findByRole("heading", { name: /Nova relação item × fornecedor/ }),
    ).toBeInTheDocument();
    expect(campo("supplier-item-code")).toHaveValue("VC-ASC-001");
    expect(campo("supplier-item-item")).toHaveValue("");
    // Sem item não há relação para criar.
    expect(screen.getByRole("button", { name: /Criar relação/ })).toBeDisabled();
  });
});
