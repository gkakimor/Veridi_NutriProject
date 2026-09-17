import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { ProjectDTO, ProjectProductDTO, QuoteLineDTO, QuoteVersionDTO } from "@veridi/shared";

/**
 * Produto inativo no Orçamento e no Projeto — PRODUCT-INACTIVE-COMMERCIAL-GATE-01, §108.
 *
 * O que estes casos fixam na tela:
 *
 * 1. a linha que já estava na proposta continua, marcada "Inativo", e o aviso diz
 *    qual passo a guarda vai recusar — sem desabilitar nada;
 * 2. o fluxo novo não oferece produto inativo: linha nova e amostra nova;
 * 3. a marca vem da leitura (`productActive === false`), nunca da ausência numa
 *    lista;
 * 4. a aprovação avisa antes, e a recusa do servidor não fica escondida atrás do
 *    diálogo.
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

import { approveProject, getProject, getQuoteVersion } from "../../lib/projects-api";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { QuoteVersionPage } from "./QuoteVersionPage";

function linha(overrides: Partial<QuoteLineDTO> = {}): QuoteLineDTO {
  return {
    id: "ql-1",
    quoteVersionId: "q1",
    projectProductId: "pp-1",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Pré-Treino",
    productActive: true,
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
    ...overrides,
  };
}

function versao(overrides: Partial<QuoteVersionDTO> = {}): QuoteVersionDTO {
  return {
    id: "q1",
    code: "ORC-000555",
    projectId: "prj-1",
    versionNumber: 1,
    versionLabel: "ORC-000555 · V1",
    externalCode: null,
    status: "DRAFT",
    source: "MANUAL",
    quoteDate: "2026-09-10T00:00:00.000Z",
    validUntil: "2099-12-31T00:00:00.000Z",
    expired: false,
    currencyCode: "BRL",
    lines: [linha()],
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

function vinculo(numero: number, overrides: Partial<ProjectProductDTO> = {}): ProjectProductDTO {
  return {
    id: `pp-${numero}`,
    projectId: "prj-1",
    productId: `prod-${numero}`,
    productCode: `PROD-00000${numero}`,
    productName: numero === 1 ? "Pré-Treino" : `Produto ${numero}`,
    productLifecycle: "DEVELOPMENT",
    productActive: true,
    sequence: numero,
    status: "ACTIVE",
    costing: null,
    latestSampleCode: null,
    latestSampleLabel: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    createdByName: null,
    ...overrides,
  };
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
  products: [vinculo(1)],
  quoteVersions: [],
  statusHistory: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  createdByName: null,
  updatedAt: "2026-09-01T00:00:00.000Z",
};

/** JSON novo a cada leitura, como a API entrega. */
function copia<T>(valor: T): T {
  return JSON.parse(JSON.stringify(valor)) as T;
}

function servir(projeto: Partial<ProjectDTO>, versoes: QuoteVersionDTO[] = []) {
  vi.mocked(getProject).mockImplementation(async () =>
    copia({ ...PROJETO, ...projeto, quoteVersions: versoes }),
  );
  vi.mocked(getQuoteVersion).mockImplementation(async (id: string) => {
    const achada = versoes.find((candidata) => candidata.id === id);
    if (!achada) throw new Error(`versão não prevista: ${id}`);
    return copia(achada);
  });
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
}

const titulo = (nome: string | RegExp) => screen.findByRole("heading", { level: 1, name: nome });
const aviso = () =>
  screen.queryByText(/^(Produto inativo|Produtos inativos)$/)?.closest(".pendency-panel") ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});

describe("Orçamento — produto inativado depois que a linha entrou", () => {
  it("rascunho: a linha segue marcada Inativo, o aviso diz que o envio é recusado, e nada é desabilitado", async () => {
    servir({ products: [vinculo(1, { productActive: false })] }, [
      versao({ lines: [linha({ productActive: false })] }),
    ]);
    abrir("/comercial/orcamentos/q1");
    await titulo("ORC-000555 · V1");

    const painel = aviso();
    expect(painel).not.toBeNull();
    expect(painel).toHaveAttribute("role", "status");
    expect(painel).toHaveTextContent(
      "o documento continua disponível, mas não é possível enviar a proposta enquanto o produto estiver inativo.",
    );
    expect(within(painel as HTMLElement).getByRole("link", { name: "PROD-000001 Pré-Treino" })).toBeInTheDocument();

    const linhaDaTabela = document.getElementById("quote-line-ql-1")!;
    expect(within(linhaDaTabela).getByText("Inativo")).toHaveClass("badge", "badge--inactive");
    // Aviso não é autoridade: enviar continua oferecido, e quem recusa é o servidor.
    expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeEnabled();
  });

  it("linha nova não oferece produto inativo do projeto, e a dica diz qual ficou de fora", async () => {
    servir({ products: [vinculo(1), vinculo(2), vinculo(3, { productActive: false })] }, [versao()]);
    abrir("/comercial/orcamentos/q1");
    await titulo("ORC-000555 · V1");

    const seletor = screen.getByLabelText("Adicionar produto à proposta") as HTMLSelectElement;
    const oferecidos = [...seletor.options].map((opcao) => opcao.textContent);
    expect(oferecidos).toContain("PROD-000002 · Produto 2");
    expect(oferecidos.some((texto) => texto?.startsWith("PROD-000003"))).toBe(false);
    expect(
      screen.getByText("Produto inativo não entra na proposta: PROD-000003. Reative o produto para incluí-lo."),
    ).toBeInTheDocument();
    // Com o produto ativo na linha, nenhum aviso nem marca.
    expect(aviso()).toBeNull();
    expect(within(document.getElementById("quote-line-ql-1")!).queryByText("Inativo")).toBeNull();
  });

  it.each([
    { caso: "enviada", status: "SENT", projeto: "WAITING", pedido: null, passo: "registrar o aceite" },
    {
      caso: "aceita sem pedido, projeto não aprovado",
      status: "ACCEPTED",
      projeto: "WAITING",
      pedido: null,
      passo: "aprovar o projeto nem gerar o pedido",
    },
    { caso: "aceita sem pedido, projeto aprovado", status: "ACCEPTED", projeto: "APPROVED", pedido: null, passo: "gerar o pedido" },
    {
      caso: "aceita com pedido gerado",
      status: "ACCEPTED",
      projeto: "APPROVED",
      pedido: { id: "co-1", code: "PED-000001", status: "DRAFT", createdAt: "2026-09-12T12:00:00.000Z" },
      passo: null,
    },
    { caso: "recusada", status: "REJECTED", projeto: "WAITING", pedido: null, passo: null },
  ] as const)("versão $caso com produto inativo: passo recusado = $passo", async ({ caso, status, projeto, pedido, passo }) => {
    servir({ status: projeto, products: [vinculo(1, { productActive: false })] }, [
      versao({
        status,
        sourcedOrder: pedido,
        sentAt: "2026-09-11T12:00:00.000Z",
        lines: [linha({ productActive: false })],
      }),
    ]);
    abrir("/comercial/orcamentos/q1");
    await titulo("ORC-000555 · V1");

    if (passo === null) {
      expect(aviso(), caso).toBeNull();
    } else {
      expect(aviso(), caso).toHaveTextContent(`não é possível ${passo} enquanto o produto estiver inativo.`);
    }
    // A marca é da linha, em qualquer status: é a situação real do cadastro.
    expect(within(document.getElementById("quote-line-ql-1")!).getByText("Inativo")).toBeInTheDocument();
  });
});

describe("Projeto — produto inativo fora da escolha nova", () => {
  it("amostra: o produto inativo não é oferecido, e a dica diz qual", async () => {
    servir({ products: [vinculo(1), vinculo(2, { productActive: false })] });
    abrir("/comercial/projetos/prj-1");
    await titulo(/PROJ-000001/);

    const seletor = screen.getByLabelText("Produto testado") as HTMLSelectElement;
    const oferecidos = [...seletor.options].map((opcao) => opcao.textContent);
    expect(oferecidos).toEqual(["Selecione…", "PROD-000001 · Pré-Treino"]);
    expect(
      screen.getByText("Produto inativo não recebe amostra nova: PROD-000002. Reative o produto para criar a amostra."),
    ).toBeInTheDocument();
  });

  it("aprovação: o diálogo marca o produto aceito inativo e avisa; a recusa fecha o diálogo e aparece na página", async () => {
    const aceita = versao({
      status: "ACCEPTED",
      sentAt: "2026-09-11T12:00:00.000Z",
      acceptedAt: "2026-09-12T12:00:00.000Z",
      lines: [linha({ productActive: false })],
    });
    servir({ products: [vinculo(1, { productActive: false })] }, [aceita]);
    const recusa = "Produto PROD-000001 está inativo. Reative o produto para aprovar o projeto.";
    vi.mocked(approveProject).mockRejectedValue(new Error(recusa));
    abrir("/comercial/projetos/prj-1");
    await titulo(/PROJ-000001/);

    fireEvent.click(screen.getByRole("button", { name: "Aprovar projeto" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText("Inativo")).toHaveClass("badge--inactive");
    expect(dialogo).toHaveTextContent(
      "A aprovação é recusada enquanto o produto aceito estiver inativo — reative o cadastro do produto antes de aprovar.",
    );

    fireEvent.click(within(dialogo).getByRole("button", { name: "Aprovar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(approveProject).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(recusa)).toHaveAttribute("role", "alert");
  });
});
