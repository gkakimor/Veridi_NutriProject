import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, useNavigate } from "react-router-dom";
import type {
  BillingDTO,
  CustomerConsultationSummaryDTO,
  CustomerDTO,
  CustomerMaterialRowDTO,
  CustomerOrderDTO,
  ProductDTO,
  ProjectDTO,
} from "@veridi/shared";

/**
 * Consulta do Cliente — navegação.
 *
 * O que estes testes protegem não é o layout: é a REGRA. Dentro da Consulta o
 * cliente é a raiz, então abrir um projeto, voltar pela trilha e abrir outro
 * projeto não pode em momento nenhum apagar o cabeçalho do cliente. É
 * exatamente isso que se perde hoje ao clicar em "Ver relacionados", e é
 * exatamente o tipo de regressão que passa despercebida numa revisão visual.
 *
 * A árvore de rotas vem de `routes.tsx` — a MESMA que o `App` monta. Uma
 * cópia local envelheceria sozinha e passaria a provar a navegação de ontem.
 */

vi.mock("../../lib/customer-consultation-api", () => ({
  getConsultationSummary: vi.fn(),
  getConsultationProject: vi.fn(),
  getConsultationOrder: vi.fn(),
  getConsultationBilling: vi.fn(),
  getConsultationProduct: vi.fn(),
  listConsultationFinishedGoods: vi.fn(),
}));
vi.mock("../../lib/products-api", () => ({ listProducts: vi.fn() }));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/projects-api", () => ({ listProjects: vi.fn() }));
vi.mock("../../lib/customer-orders-api", () => ({ listCustomerOrders: vi.fn() }));
vi.mock("../../lib/billings-api", () => ({ listBillings: vi.fn() }));
vi.mock("../../lib/customer-materials-api", () => ({ listCustomerMaterials: vi.fn() }));

import {
  getConsultationBilling,
  getConsultationOrder,
  getConsultationProduct,
  getConsultationProject,
  getConsultationSummary,
  listConsultationFinishedGoods,
} from "../../lib/customer-consultation-api";
import { listProducts } from "../../lib/products-api";
import { listCustomers } from "../../lib/customers-api";
import { listProjects } from "../../lib/projects-api";
import { listCustomerOrders } from "../../lib/customer-orders-api";
import { listBillings } from "../../lib/billings-api";
import { listCustomerMaterials } from "../../lib/customer-materials-api";
import { NotFoundApiError } from "../../lib/api-errors";
import { consultationRoutes } from "./routes";

const CUSTOMER_ID = "cli-a";

const customer: CustomerDTO = {
  id: CUSTOMER_ID,
  code: "CLI-000001",
  legalName: "Vida Saudável Alimentos LTDA",
  tradeName: "Vida Saudável",
  cnpj: "11222333000181",
  email: "contato@vidasaudavel.com.br",
  phone: "11999998888",
  street: "Rua das Acácias",
  number: "158",
  complement: null,
  district: "Cupecê",
  zipCode: "04816100",
  city: "São Paulo",
  state: "SP",
  notes: null,
  businessLotSuffix: null,
  active: true,
  createdAt: "2026-08-31T17:32:00.000Z",
  createdByName: "João Silva",
  updatedAt: "2026-08-31T19:14:00.000Z",
  updatedByName: "Maria Souza",
};

const summary: CustomerConsultationSummaryDTO = {
  customer,
  counts: { products: 3, projects: 2, orders: 1, openOrders: 1, billings: 1, materialLots: 1 },
};

/*
 * Os DTOs do domínio têm dezenas de campos que estas telas não leem. Escrever
 * todos aqui esconderia, no meio do ruído, os poucos que o teste realmente
 * verifica — então cada fixture declara só o que a tela usa.
 */
function project(id: string, code: string, name: string): ProjectDTO {
  return {
    id,
    code,
    name,
    customerId: CUSTOMER_ID,
    status: "IN_PROGRESS",
    entryDate: "2026-07-01T00:00:00.000Z",
    approvedAt: null,
    concept: "Detox",
    channel: "Distribuidora",
    responsibleUserName: "Ana",
    productName: "Blend Verde",
    acceptedQuoteLabel: null,
    latestQuoteLabel: "ORC-000010 · V1",
    products: [],
    quoteVersions: [],
  } as unknown as ProjectDTO;
}

const PROJECT_1 = project("proj-1", "PROJ-000001", "Linha Detox");
const PROJECT_2 = project("proj-2", "PROJ-000002", "Linha Proteica");

const order = {
  id: "ped-1",
  code: "PED-000001",
  customerId: CUSTOMER_ID,
  status: "CONFIRMED",
  orderDate: "2026-07-10T00:00:00.000Z",
  requestedDeliveryDate: null,
  commercialOrigin: {
    quoteVersionId: "qv-1",
    quoteCode: "ORC-000010",
    quoteVersionNumber: 1,
    projectId: "proj-1",
    projectCode: "PROJ-000001",
    subtotalAmount: "1000.00",
    discountPercent: null,
    totalAmount: "1000.00",
    paymentSchedule: null,
  },
  lines: [
    {
      id: "linha-1",
      productCode: "PRD-000001",
      productName: "Blend Verde",
      orderedQuantity: "10",
      unitCode: "kg",
      shippedQuantity: "0",
      outstandingQuantity: "10",
      billedQuantity: "0",
      agreedPrice: { unitPrice: "100.00", lineTotal: "1000.00" },
    },
  ],
  generatedProductionOrders: [],
  shipments: [],
  billings: [{ id: "fat-1", code: "FAT-000001", totalQuantity: "10", totalAmount: "1000.00", issuedAt: null }],
} as unknown as CustomerOrderDTO;

const billing = {
  id: "fat-1",
  code: "FAT-000001",
  customerId: CUSTOMER_ID,
  customerOrderId: "ped-1",
  customerOrderCode: "PED-000001",
  shipmentCode: "EXP-000001",
  shipmentDate: "2026-07-20T00:00:00.000Z",
  status: "ISSUED",
  externalReference: null,
  issuedAt: "2026-07-21T00:00:00.000Z",
  totalQuantity: "10",
  totalAmount: "1000.00",
  hasCompletePricing: true,
  lines: [
    {
      id: "fl-1",
      productCode: "PRD-000001",
      productName: "Blend Verde",
      lotCode: "LT-0001",
      quantity: "10",
      unitCode: "kg",
      agreedUnitPrice: "100.00",
      unitPrice: "100.00",
      lineTotal: "1000.00",
      priceOverridden: false,
    },
  ],
} as unknown as BillingDTO;

const PRODUTO = {
  id: "prod-1",
  code: "PROD-000007",
  name: "Coenzima Q10 60 cápsulas",
  customerId: CUSTOMER_ID,
  lifecycle: "APPROVED",
  active: true,
  presentationType: "POT",
  dosageForm: "CAPSULE",
  dosesPerPackage: 60,
  externalCode: null,
  finishedProductItem: { id: "item-1", code: "PA-000008", name: "Coenzima Q10 60 cápsulas" },
} as unknown as ProductDTO;

/* Item próprio: PA é 1:1 com o Produto, dois produtos nunca dividem o mesmo. */
const PRODUTO_2 = {
  ...PRODUTO,
  id: "prod-2",
  code: "PROD-000009",
  name: "Biotina 30 cápsulas",
  finishedProductItem: { id: "item-2", code: "PA-000009", name: "Biotina 30 cápsulas" },
} as unknown as ProductDTO;

const ACABADO = {
  productId: "prod-1",
  productCode: "PROD-000007",
  productName: "Coenzima Q10 60 cápsulas",
  itemId: "item-1",
  itemCode: "PA-000008",
  itemName: "Coenzima Q10 60 cápsulas",
  unitCode: "un",
  onHand: "500",
  reserved: "120",
  available: "380",
  lotCount: 3,
  awaitingQualityLots: 1,
};

const material = {
  lotId: "lot-a",
  lotCode: "LT-CLIENTE-A",
  customerId: CUSTOMER_ID,
  itemCode: "MP-0001",
  itemName: "Proteína Isolada",
  onHand: "40",
  reserved: "0",
  available: "40",
  unitCode: "kg",
  expiryDate: null,
  isExpired: false,
  status: "AVAILABLE",
  coaStatus: "APPROVED",
} as unknown as CustomerMaterialRowDTO;

/**
 * Botão de teste que dispara `navigate(-1)` — o MESMO caminho que o Voltar do
 * navegador percorre no React Router. O router de dados (`createMemoryRouter`)
 * não serve aqui: ele monta um `Request` real, e o `AbortSignal` do undici não
 * é o do jsdom.
 */
function BackButton() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      voltar-navegador
    </button>
  );
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <BackButton />
      <Routes>{consultationRoutes}</Routes>
    </MemoryRouter>,
  );
}

/** O cabeçalho do cliente continua na tela — a promessa central da Consulta. */
async function expectCustomerHeader() {
  expect(
    await screen.findByRole("heading", { level: 1, name: /Vida Saudável Alimentos LTDA/ }),
  ).toBeInTheDocument();
}

beforeEach(() => {
  vi.mocked(getConsultationSummary).mockResolvedValue(summary);
  vi.mocked(getConsultationProject).mockImplementation(async (_customerId, projectId) =>
    projectId === "proj-2" ? PROJECT_2 : PROJECT_1,
  );
  vi.mocked(getConsultationOrder).mockResolvedValue(order);
  vi.mocked(getConsultationBilling).mockResolvedValue(billing);
  vi.mocked(listCustomers).mockResolvedValue({
    customers: [customer],
    page: 1,
    pageSize: 20,
    total: 1,
  });
  vi.mocked(listProjects).mockResolvedValue({
    projects: [PROJECT_1, PROJECT_2],
    page: 1,
    pageSize: 20,
    total: 2,
  });
  vi.mocked(listCustomerOrders).mockResolvedValue({
    customerOrders: [order],
    page: 1,
    pageSize: 20,
    total: 1,
  });
  vi.mocked(listBillings).mockResolvedValue({
    billings: [billing],
    page: 1,
    pageSize: 20,
    total: 1,
  });
  vi.mocked(listProducts).mockResolvedValue({
    products: [PRODUTO, PRODUTO_2],
    page: 1,
    pageSize: 20,
    total: 2,
  });
  vi.mocked(getConsultationProduct).mockImplementation(async (_c, id) =>
    id === "prod-2" ? PRODUTO_2 : PRODUTO,
  );
  vi.mocked(listConsultationFinishedGoods).mockResolvedValue({
    rows: [ACABADO],
    page: 1,
    pageSize: 20,
    total: 1,
  });
  vi.mocked(listCustomerMaterials).mockResolvedValue({
    rows: [material],
    page: 1,
    pageSize: 20,
    total: 1,
  });
});

describe("Consulta do Cliente — entrada", () => {
  it("busca reusa o cadastro e a seleção abre o cliente", async () => {
    const user = userEvent.setup();
    renderAt("/consultas/clientes");

    await user.type(await screen.findByLabelText("Buscar clientes"), "Vida");

    // Mesmo endpoint do cadastro: nada de um segundo motor de busca.
    await waitFor(() => {
      expect(vi.mocked(listCustomers)).toHaveBeenCalledWith(
        expect.objectContaining({ search: "Vida" }),
      );
    });

    await user.click(await screen.findByRole("link", { name: "Consultar" }));
    await expectCustomerHeader();
  });
});

describe("Consulta do Cliente — shell", () => {
  it("mostra identidade e contato, e as abas são links de rota", async () => {
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/resumo`);

    await expectCustomerHeader();

    // O nome fantasia aparece duas vezes na tela — no cabeçalho e como raiz
    // da trilha —, então a asserção é feita dentro do cabeçalho.
    const head = screen
      .getByRole("heading", { level: 1, name: /Vida Saudável Alimentos LTDA/ })
      .closest(".consult-head") as HTMLElement;
    expect(within(head).getByText("CLI-000001")).toBeInTheDocument();
    expect(within(head).getByText("Vida Saudável")).toBeInTheDocument();
    expect(within(head).getByText("CNPJ 11.222.333/0001-81")).toBeInTheDocument();

    const tabs = screen.getByRole("navigation", { name: "Seções da consulta" });
    for (const label of ["Resumo", "Produtos", "Projetos", "Pedidos", "Estoque", "Faturamentos"]) {
      expect(within(tabs).getByRole("link", { name: label })).toBeInTheDocument();
    }
    // Estado ativo identificável por quem não enxerga a cor.
    expect(within(tabs).getByRole("link", { name: "Resumo" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("resumo mostra os contadores e cada um leva à sua aba", async () => {
    const user = userEvent.setup();
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/resumo`);

    const projetos = await screen.findByRole("link", { name: "Projetos: 2" });
    await user.click(projetos);

    expect(await screen.findByText("PROJ-000001")).toBeInTheDocument();
    await expectCustomerHeader();
  });

  it("trocar cliente volta para a busca", async () => {
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/resumo`);
    expect(await screen.findByRole("link", { name: "Trocar cliente" })).toHaveAttribute(
      "href",
      "/consultas/clientes",
    );
  });

  it("cliente inexistente não vira erro genérico", async () => {
    vi.mocked(getConsultationSummary).mockRejectedValue(
      new NotFoundApiError("Registro não encontrado."),
    );
    renderAt("/consultas/clientes/cli-fantasma/resumo");

    expect(
      await screen.findByRole("heading", { name: "Cliente não encontrado" }),
    ).toBeInTheDocument();
  });
});

describe("Consulta do Cliente — navegação sob o cliente", () => {
  it("lista só os projetos daquele cliente", async () => {
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/projetos`);

    expect(await screen.findByText("PROJ-000001")).toBeInTheDocument();
    // O recorte é feito no servidor: a tela nunca pede "todos os projetos".
    await waitFor(() => {
      expect(vi.mocked(listProjects)).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: CUSTOMER_ID }),
      );
    });
  });

  /*
   * O caso de uso central do handoff: PROJ-001 → trilha "Projetos" →
   * PROJ-002, sem perder Vida Saudável em nenhum passo.
   */
  it("troca de projeto pela trilha sem perder o cliente", async () => {
    const user = userEvent.setup();
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/projetos`);

    await user.click(await screen.findByText("PROJ-000001"));
    expect(
      await screen.findByRole("heading", { level: 1, name: /PROJ-000001 · Linha Detox/ }),
    ).toBeInTheDocument();
    await expectCustomerHeader();

    const trail = screen.getByRole("navigation", { name: "Trilha da consulta" });
    await user.click(within(trail).getByRole("link", { name: "Projetos" }));

    // Voltou para os projetos DESTE cliente, não para a lista global.
    expect(await screen.findByText("PROJ-000002")).toBeInTheDocument();
    await expectCustomerHeader();

    await user.click(screen.getByText("PROJ-000002"));
    expect(
      await screen.findByRole("heading", { level: 1, name: /PROJ-000002 · Linha Proteica/ }),
    ).toBeInTheDocument();
    await expectCustomerHeader();
  });

  it("o Voltar do navegador mantém o contexto", async () => {
    const user = userEvent.setup();
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/projetos`);

    await user.click(await screen.findByText("PROJ-000001"));
    expect(
      await screen.findByRole("heading", { level: 1, name: /PROJ-000001/ }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "voltar-navegador" }));

    expect(await screen.findByText("PROJ-000002")).toBeInTheDocument();
    await expectCustomerHeader();
  });

  it("deep link direto no detalhe abre com o shell montado", async () => {
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/projetos/proj-2`);

    expect(
      await screen.findByRole("heading", { level: 1, name: /PROJ-000002/ }),
    ).toBeInTheDocument();
    await expectCustomerHeader();
  });

  it("entidade de outro cliente não aparece sob este cabeçalho", async () => {
    vi.mocked(getConsultationProject).mockRejectedValue(
      new NotFoundApiError("Registro não encontrado."),
    );
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/projetos/proj-de-outro-cliente`);

    expect(
      await screen.findByRole("heading", { name: "Projeto não encontrado neste cliente" }),
    ).toBeInTheDocument();
    // O cliente continua: o erro acontece DENTRO da consulta dele.
    await expectCustomerHeader();
  });
});

describe("Consulta do Cliente — pedidos, materiais e faturamentos", () => {
  it("abre o pedido consultivo com origem, saldo e faturamentos", async () => {
    const user = userEvent.setup();
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/pedidos`);

    await user.click(await screen.findByText("PED-000001"));

    expect(await screen.findByRole("heading", { level: 1, name: "PED-000001" })).toBeInTheDocument();
    await expectCustomerHeader();
    // Origem comercial e faturamento seguem DENTRO da consulta.
    expect(screen.getByRole("link", { name: "PROJ-000001" })).toHaveAttribute(
      "href",
      `/consultas/clientes/${CUSTOMER_ID}/projetos/proj-1`,
    );
    expect(screen.getByRole("link", { name: "FAT-000001" })).toHaveAttribute(
      "href",
      `/consultas/clientes/${CUSTOMER_ID}/faturamentos/fat-1`,
    );
  });

  it("materiais pedem apenas os lotes daquele dono", async () => {
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/estoque/materiais`);

    expect(await screen.findByText("LT-CLIENTE-A")).toBeInTheDocument();
    // O escopo de dono é do read model existente, não um filtro paralelo.
    await waitFor(() => {
      expect(vi.mocked(listCustomerMaterials)).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: CUSTOMER_ID }),
      );
    });
  });

  it("lista vazia explica o que aconteceu", async () => {
    vi.mocked(listCustomerMaterials).mockResolvedValue({
      rows: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/estoque/materiais`);

    expect(
      await screen.findByText("Nenhum material deste cliente em estoque."),
    ).toBeInTheDocument();
  });

  it('só "Abrir faturamento completo" sai da consulta para o módulo', async () => {
    const user = userEvent.setup();
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/faturamentos`);

    await user.click(await screen.findByText("FAT-000001"));

    expect(await screen.findByRole("heading", { level: 1, name: "FAT-000001" })).toBeInTheDocument();
    await expectCustomerHeader();

    // Clique comum continua no cliente; a saída é esta, e só ela.
    expect(screen.getByRole("link", { name: /Abrir faturamento completo/ })).toHaveAttribute(
      "href",
      "/comercial/faturamento/fat-1",
    );
    // O pedido de origem, esse, continua dentro da consulta.
    expect(screen.getByRole("link", { name: "PED-000001" })).toHaveAttribute(
      "href",
      `/consultas/clientes/${CUSTOMER_ID}/pedidos/ped-1`,
    );
  });
});

describe("Consulta do Cliente — produtos", () => {
  it("lista só os produtos daquele cliente", async () => {
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/produtos`);

    expect(await screen.findByText("PROD-000007")).toBeInTheDocument();
    expect(screen.getByText("PA-000008")).toBeInTheDocument();
    await waitFor(() => {
      expect(vi.mocked(listProducts)).toHaveBeenCalledWith(
        expect.objectContaining({ customerId: CUSTOMER_ID }),
      );
    });
  });

  it("abre o detalhe sem perder o cliente e oferece a saída para o módulo", async () => {
    const user = userEvent.setup();
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/produtos`);

    await user.click(await screen.findByText("PROD-000007"));

    expect(
      await screen.findByRole("heading", { level: 1, name: /PROD-000007/ }),
    ).toBeInTheDocument();
    await expectCustomerHeader();
    expect(screen.getByRole("link", { name: /Abrir produto completo/ })).toHaveAttribute(
      "href",
      "/cadastros/produtos?productId=prod-1",
    );
  });

  it("produto de outro cliente não aparece sob este cabeçalho", async () => {
    vi.mocked(getConsultationProduct).mockRejectedValue(
      new NotFoundApiError("Registro não encontrado."),
    );
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/produtos/prod-de-outro`);

    expect(
      await screen.findByRole("heading", { name: "Produto não encontrado neste cliente" }),
    ).toBeInTheDocument();
    await expectCustomerHeader();
  });
});

describe("Consulta do Cliente — estoque", () => {
  it("separa produto acabado de material do cliente em duas visões", async () => {
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/estoque/acabados`);

    const subnav = await screen.findByRole("navigation", { name: "Seções do estoque" });
    expect(within(subnav).getByRole("link", { name: "Produtos acabados" })).toBeInTheDocument();
    expect(
      within(subnav).getByRole("link", { name: "Materiais do cliente" }),
    ).toBeInTheDocument();
  });

  it("produtos acabados mostram físico, reservado e disponível", async () => {
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/estoque/acabados`);

    expect(await screen.findByText("PA-000008")).toBeInTheDocument();
    expect(screen.getByText("500 un")).toBeInTheDocument();
    expect(screen.getByText("120 un")).toBeInTheDocument();
    expect(screen.getByText("380 un")).toBeInTheDocument();
    // Lote sem liberação da Qualidade é fato operacional, não detalhe.
    expect(screen.getByText(/aguardando liberação/)).toBeInTheDocument();
  });

  it("o endereço antigo de materiais continua funcionando", async () => {
    renderAt(`/consultas/clientes/${CUSTOMER_ID}/materiais`);
    expect(await screen.findByText("LT-CLIENTE-A")).toBeInTheDocument();
  });
});
