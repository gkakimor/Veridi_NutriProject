import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { CustomerStatus, ProjectDTO, QuoteVersionDTO } from "@veridi/shared";

/**
 * Aviso de cliente bloqueado ou inativo no Orçamento e no Projeto —
 * CUSTOMER-STATUS-HARDENING-01, §95.
 *
 * O documento nasceu com o cliente ATIVO; depois o cliente mudou de situação.
 * O que estes casos fixam:
 *
 * 1. o documento que ainda pode avançar avisa, com a frase do caso e o caminho
 *    para a Visão do Cliente;
 * 2. cliente ativo, versão encerrada e projeto cancelado não avisam;
 * 3. o aviso é da leitura: a releitura seguinte à reativação já não o mostra;
 * 4. o aviso não desabilita nada — a guarda do servidor continua decidindo.
 */

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", name: "Comercial", role: "COMMERCIAL" } }),
}));
vi.mock("../../components/AttachmentsSection", () => ({ AttachmentsSection: () => null }));
vi.mock("../../lib/projects-api", () => ({
  getProject: vi.fn(),
  getQuoteVersion: vi.fn(),
  approveProject: vi.fn(),
  cancelProject: vi.fn(),
  changeProjectStatus: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  prepareTechnicalProduct: vi.fn(),
  createProjectProduct: vi.fn(),
  linkProjectProduct: vi.fn(),
  acceptQuoteVersion: vi.fn(),
  addQuoteLine: vi.fn(),
  adjustQuotePrice: vi.fn(),
  applyQuotePricing: vi.fn(),
  createOrderFromQuote: vi.fn(),
  createQuoteVersion: vi.fn(),
  duplicateQuoteVersion: vi.fn(),
  getQuotePricingOptions: vi.fn(() => Promise.resolve(null)),
  inheritQuotePrice: vi.fn(),
  previewQuotePaymentSchedule: vi.fn(),
  rejectQuoteVersion: vi.fn(),
  removeQuoteLine: vi.fn(),
  sendQuoteVersion: vi.fn(),
  updateQuoteLine: vi.fn(),
  updateQuoteVersion: vi.fn(),
  useManualQuotePrice: vi.fn(),
}));
vi.mock("../../lib/products-api", () => ({ listProducts: () => Promise.resolve({ products: [] }) }));
vi.mock("../../lib/customers-api", () => ({ listCustomers: () => Promise.resolve({ customers: [] }) }));
vi.mock("../../lib/samples-api", () => ({
  listSamples: vi.fn(() => Promise.resolve({ samples: [], total: 0 })),
  createSample: vi.fn(),
}));

import { changeProjectStatus, getProject, getQuoteVersion } from "../../lib/projects-api";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { QuoteVersionPage } from "./QuoteVersionPage";

const FRASE_BLOQUEADO_ORCAMENTO =
  "Este cliente está bloqueado. O orçamento pode ser consultado, mas não é possível enviar, registrar o aceite, gerar o pedido nem criar versão nova até a regularização.";
const FRASE_INATIVO_ORCAMENTO =
  "Este cliente está inativo. O orçamento permanece disponível para consulta, mas não pode avançar no fluxo comercial enquanto o cadastro não for reativado.";
const FRASE_BLOQUEADO_PROJETO =
  "Este cliente está bloqueado. O projeto pode ser consultado, mas não é possível criar orçamento nem versão nova até a regularização.";
const FRASE_INATIVO_PROJETO =
  "Este cliente está inativo. O projeto permanece disponível para consulta, mas não pode avançar no fluxo comercial enquanto o cadastro não for reativado.";

function versao(overrides: Partial<QuoteVersionDTO> = {}): QuoteVersionDTO {
  return {
    id: "q1",
    code: "ORC-000444",
    projectId: "prj-1",
    versionNumber: 1,
    versionLabel: "ORC-000444 · V1",
    externalCode: null,
    status: "DRAFT",
    source: "MANUAL",
    quoteDate: "2026-09-10T00:00:00.000Z",
    validUntil: "2099-12-31T00:00:00.000Z",
    expired: false,
    currencyCode: "BRL",
    lines: [
      {
        id: "ql-1",
        quoteVersionId: "q1",
        projectProductId: "pp-1",
        productId: "prod-1",
        productCode: "PROD-000001",
        productName: "Pré-Treino",
        sortOrder: 1,
        quotedQuantity: "1000.000000000000",
        uomCode: "un",
        unitPrice: "12.5000",
        total: "12500.00",
        priceSource: "MANUAL",
        priceOrigin: "MANUAL",
        inheritedFromQuoteLineId: null,
        adjustmentPercent: null,
        priceOriginReason: null,
        pricing: null,
      },
    ],
    total: "12500.00",
    subtotal: "12500.00",
    discountPercent: null,
    paymentMethod: "CASH",
    downPaymentPercent: null,
    installmentCount: null,
    installmentIntervalDays: null,
    monthlyInterestPercent: null,
    paymentSchedule: null,
    sourcedOrder: null,
    commercialNotes: null,
    paymentTerms: null,
    leadTimeDays: null,
    sentAt: null,
    sentByName: null,
    acceptedAt: null,
    acceptedByName: null,
    rejectedAt: null,
    rejectedByName: null,
    rejectionReason: null,
    customerCode: "CLI-000001",
    customerName: "Cliente Teste",
    customerTradeName: null,
    customerCnpj: null,
    customerZipCode: null,
    customerStreet: null,
    customerNumber: null,
    customerComplement: null,
    customerDistrict: null,
    customerCity: null,
    customerState: null,
    projectCode: "PROJ-000001",
    projectName: "Linha Performance",
    projectConcept: null,
    projectChannel: null,
    createdAt: "2026-09-10T00:00:00.000Z",
    createdByName: null,
    ...overrides,
  } as QuoteVersionDTO;
}

const PROJETO: ProjectDTO = {
  id: "prj-1",
  code: "PROJ-000001",
  externalCode: null,
  customerId: "cli-1",
  customerCode: "CLI-000001",
  customerName: "Cliente Teste",
  customerPhone: null,
  customerEmail: null,
  customerStatus: "ACTIVE",
  name: "Linha Performance",
  concept: null,
  channel: null,
  status: "WAITING",
  source: "MANUAL",
  responsibleUserId: null,
  responsibleUserName: null,
  entryDate: "2026-09-01T00:00:00.000Z",
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
  costing: null,
  productName: null,
  latestQuoteLabel: null,
  latestQuoteStatus: null,
  acceptedQuoteLabel: null,
  products: [],
  quoteVersions: [],
  statusHistory: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  createdByName: null,
  updatedAt: "2026-09-01T00:00:00.000Z",
};

/** O servidor de mentira: a situação do cliente muda entre leituras, como na vida real. */
let situacaoDoCliente: CustomerStatus;
let situacaoDoProjeto: ProjectDTO["status"];
let versoes: QuoteVersionDTO[];

function servir(
  cliente: CustomerStatus,
  lista: QuoteVersionDTO[] = [versao()],
  projeto: ProjectDTO["status"] = "WAITING",
) {
  situacaoDoCliente = cliente;
  situacaoDoProjeto = projeto;
  versoes = lista;
  vi.mocked(getProject).mockImplementation(async () =>
    copia({
      ...PROJETO,
      customerStatus: situacaoDoCliente,
      status: situacaoDoProjeto,
      quoteVersions: versoes,
    }),
  );
  vi.mocked(getQuoteVersion).mockImplementation(async (id: string) => {
    const achada = versoes.find((candidata) => candidata.id === id);
    if (!achada) throw new Error(`versão não prevista: ${id}`);
    return copia(achada);
  });
}

/** JSON novo a cada leitura, como a API entrega. */
function copia<T>(valor: T): T {
  return JSON.parse(JSON.stringify(valor)) as T;
}

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

function abrir(entrada: string) {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/comercial/projetos/:id" element={<ProjectDetailPage />} />
        <Route path="/comercial/orcamentos/:id" element={<QuoteVersionPage />} />
      </Route>,
    ),
    { initialEntries: [entrada] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const titulo = (nome: string | RegExp) => screen.findByRole("heading", { level: 1, name: nome });
const aviso = () => screen.queryByText(/^Cliente (bloqueado|inativo)$/)?.closest(".pendency-panel") ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});

describe("Orçamento — aviso da situação atual do cliente", () => {
  it("rascunho com cliente BLOQUEADO: avisa, diz o que fica indisponível e aponta a Visão do Cliente", async () => {
    servir("BLOCKED");
    abrir("/comercial/orcamentos/q1");
    await titulo("ORC-000444 · V1");

    const painel = aviso();
    expect(painel).not.toBeNull();
    expect(painel).toHaveAttribute("role", "status");
    expect(painel).toHaveTextContent("Cliente bloqueado");
    expect(painel).toHaveTextContent(FRASE_BLOQUEADO_ORCAMENTO);
    expect(screen.getByRole("link", { name: "Ver situação e histórico do cliente" })).toHaveAttribute(
      "href",
      "/consultas/clientes/cli-1/resumo",
    );
    // Aviso não é autoridade: o envio continua oferecido, e quem recusa é o servidor.
    expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeEnabled();
  });

  it("rascunho com cliente INATIVO: avisa com a frase do inativo", async () => {
    servir("INACTIVE");
    abrir("/comercial/orcamentos/q1");
    await titulo("ORC-000444 · V1");

    expect(aviso()).toHaveTextContent("Cliente inativo");
    expect(aviso()).toHaveTextContent(FRASE_INATIVO_ORCAMENTO);
    expect(screen.queryByText("Cliente bloqueado")).toBeNull();
  });

  it("rascunho com cliente ATIVO: nenhum aviso", async () => {
    servir("ACTIVE");
    abrir("/comercial/orcamentos/q1");
    await titulo("ORC-000444 · V1");

    expect(aviso()).toBeNull();
    expect(screen.queryByRole("link", { name: "Ver situação e histórico do cliente" })).toBeNull();
  });

  it.each([
    { caso: "enviada (aguarda o aceite)", status: "SENT", pedido: null, avisa: true },
    { caso: "aceita sem pedido (falta gerar)", status: "ACCEPTED", pedido: null, avisa: true },
    {
      caso: "aceita com pedido gerado",
      status: "ACCEPTED",
      pedido: { id: "co-1", code: "PED-000001", status: "DRAFT", createdAt: "2026-09-12T12:00:00.000Z" },
      avisa: false,
    },
    { caso: "recusada", status: "REJECTED", pedido: null, avisa: false },
    { caso: "substituída", status: "SUPERSEDED", pedido: null, avisa: false },
    { caso: "arquivada", status: "ARCHIVED", pedido: null, avisa: false },
  ] as const)("versão $caso, cliente BLOQUEADO: avisa = $avisa", async ({ caso, status, pedido, avisa }) => {
    servir("BLOCKED", [
      versao({
        status,
        sourcedOrder: pedido,
        sentAt: "2026-09-11T12:00:00.000Z",
        ...(status === "ACCEPTED" ? { acceptedAt: "2026-09-12T12:00:00.000Z" } : {}),
      }),
    ]);
    abrir("/comercial/orcamentos/q1");
    await titulo("ORC-000444 · V1");

    expect(aviso() !== null, caso).toBe(avisa);
  });

  it("projeto cancelado: a versão não avança, e não avisa", async () => {
    servir("BLOCKED", [versao()], "CANCELLED");
    abrir("/comercial/orcamentos/q1");
    await titulo("ORC-000444 · V1");

    expect(aviso()).toBeNull();
  });
});

describe("Projeto — aviso da situação atual do cliente", () => {
  it("projeto em andamento com cliente BLOQUEADO avisa; reativado, a releitura seguinte já não avisa", async () => {
    servir("BLOCKED");
    vi.mocked(changeProjectStatus).mockResolvedValue(copia(PROJETO));
    abrir("/comercial/projetos/prj-1");
    await titulo(/PROJ-000001/);

    expect(aviso()).toHaveTextContent("Cliente bloqueado");
    expect(aviso()).toHaveTextContent(FRASE_BLOQUEADO_PROJETO);
    expect(screen.getByRole("link", { name: "Ver situação e histórico do cliente" })).toHaveAttribute(
      "href",
      "/consultas/clientes/cli-1/resumo",
    );

    // O cadastro volta a ATIVO em outro lugar; a ação seguinte relê o Projeto.
    situacaoDoCliente = "ACTIVE";
    const leituras = vi.mocked(getProject).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Mudar para Amostra" }));

    await waitFor(() => expect(vi.mocked(getProject).mock.calls.length).toBeGreaterThan(leituras));
    await waitFor(() => expect(aviso()).toBeNull());
    // Nada foi gravado no documento para isso: a única escrita foi a da ação.
    expect(changeProjectStatus).toHaveBeenCalledTimes(1);
  });

  it("projeto APROVADO com cliente INATIVO avisa — aprovado ainda recebe negociação nova", async () => {
    servir("INACTIVE", [], "APPROVED");
    abrir("/comercial/projetos/prj-1");
    await titulo(/PROJ-000001/);

    expect(aviso()).toHaveTextContent("Cliente inativo");
    expect(aviso()).toHaveTextContent(FRASE_INATIVO_PROJETO);
  });

  it.each([
    { caso: "cancelado com cliente bloqueado", cliente: "BLOCKED", projeto: "CANCELLED" },
    { caso: "em andamento com cliente ativo", cliente: "ACTIVE", projeto: "WAITING" },
  ] as const)("projeto $caso: nenhum aviso", async ({ caso, cliente, projeto }) => {
    servir(cliente, [], projeto);
    abrir("/comercial/projetos/prj-1");
    await titulo(/PROJ-000001/);

    expect(aviso(), caso).toBeNull();
  });
});
