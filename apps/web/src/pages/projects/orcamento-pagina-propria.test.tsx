import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Outlet,
  Route,
  RouterProvider,
  Routes,
  createMemoryRouter,
  createRoutesFromElements,
  useLocation,
} from "react-router-dom";
import type {
  IndustrialCostQuality,
  ProjectDTO,
  QuoteLineDTO,
  QuotePricingProvenanceDTO,
  QuoteVersionDTO,
} from "@veridi/shared";

/**
 * QUOTE-WORKSPACE-NAVIGATION-01 — o Orçamento é documento com página própria.
 *
 * Antes, a seção Orçamentos do Projeto listava as versões e abria a escolhida
 * logo abaixo: clicar em "ORC-000444 · V1" trocava um bloco fora da vista e
 * parecia que nada tinha acontecido. Agora:
 *
 * 1. a ficha do Projeto só LISTA; clicar (ou "Abrir") NAVEGA para
 *    `/comercial/orcamentos/:id`, com a volta ao Projeto na URL;
 * 2. a página é endereçável: abre por link direto, recarrega, e distingue
 *    versão inexistente (404) de leitura que falhou;
 * 3. rascunho se edita — com o envio, a confirmação de custo pela qualidade que
 *   formou o preço e a guarda de saída de sempre —; histórico se LÊ;
 * 4. PDF, duplicação, aceite, recusa e Pedido continuam onde a versão está;
 * 5. o endereço antigo (`?quoteVersionId=` no Projeto) e a volta do CMV chegam
 *    à página, na linha de onde se saiu.
 *
 * As telas são as reais, sob o router de dados e a guarda do app; só a API é
 * de mentira, com memória: cada leitura devolve JSON novo.
 */

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", name: "Admin", role: "ADMIN" } }),
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
// A tela do PDF só importa aqui pelo "Voltar": o destino que ela recebe.
vi.mock("../../pdf/PdfScreen", async () => {
  const { createElement } = await import("react");
  return {
    PdfScreen: ({ backTo }: { backTo: unknown }) =>
      createElement(
        "output",
        { "data-testid": "volta-do-pdf" },
        typeof backTo === "string" ? backTo : "(calculada depois da carga)",
      ),
  };
});

import {
  acceptQuoteVersion,
  createOrderFromQuote,
  createQuoteVersion,
  duplicateQuoteVersion,
  getProject,
  getQuoteVersion,
  rejectQuoteVersion,
  sendQuoteVersion,
} from "../../lib/projects-api";
import { NotFoundApiError } from "../../lib/api-errors";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import { QuotePrintPage } from "../print/PrintPages";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { QuoteVersionPage } from "./QuoteVersionPage";

/** A ficha do Projeto — de onde a página da versão é aberta na maior parte das vezes. */
const VOLTAR = "/comercial/projetos/prj-1";
const COM_VOLTA = `?voltar=${encodeURIComponent(VOLTAR)}`;
const VOLTAR_AO_PROJETO = "← Voltar ao Projeto PROJ-000001";

function linha(overrides: Partial<QuoteLineDTO> = {}): QuoteLineDTO {
  return {
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
    ...overrides,
  };
}

function versao(overrides: Partial<QuoteVersionDTO> = {}): QuoteVersionDTO {
  return {
    id: "q1",
    code: "ORC-000444",
    projectId: "prj-1",
    versionNumber: 1,
    versionLabel: "ORC-000444 · V1",
    externalCode: null,
    status: "SENT",
    source: "MANUAL",
    quoteDate: "2022-09-05T00:00:00.000Z",
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
    commercialNotes: "Frete por conta do cliente",
    paymentTerms: null,
    leadTimeDays: 15,
    sentAt: "2022-09-06T13:00:00.000Z",
    sentByName: "Comercial",
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
    createdAt: "2022-09-05T00:00:00.000Z",
    createdByName: null,
    ...overrides,
  } as QuoteVersionDTO;
}

/** A V1 enviada — histórico. */
const V1 = versao();
/** A V2 em rascunho — onde o trabalho está. */
const V2 = versao({
  id: "q2",
  code: "ORC-000445",
  versionNumber: 2,
  versionLabel: "ORC-000445 · V2",
  status: "DRAFT",
  quoteDate: "2026-09-10T00:00:00.000Z",
  sentAt: null,
  sentByName: null,
  lines: [linha({ id: "ql-2", quoteVersionId: "q2" })],
});
/** A versão que nasce durante o teste — por "Novo orçamento" ou por duplicação. */
const V3 = versao({
  id: "q3",
  code: "ORC-000446",
  versionNumber: 3,
  versionLabel: "ORC-000446 · V3",
  status: "DRAFT",
  quoteDate: "2026-09-14T00:00:00.000Z",
  sentAt: null,
  sentByName: null,
  lines: [],
  total: null,
  subtotal: null,
});

const PROJETO: ProjectDTO = {
  id: "prj-1",
  code: "PROJ-000001",
  externalCode: null,
  customerId: "cli-1",
  customerCode: "CLI-000001",
  customerName: "Cliente Teste",
  customerPhone: null,
  customerEmail: null,
  name: "Linha Performance",
  concept: null,
  channel: null,
  status: "WAITING",
  source: "MANUAL",
  responsibleUserId: null,
  responsibleUserName: null,
  entryDate: "2022-09-01T00:00:00.000Z",
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
  createdAt: "2022-09-01T00:00:00.000Z",
  createdByName: null,
  updatedAt: "2022-09-01T00:00:00.000Z",
};

/** O que o servidor de mentira tem agora. */
let versoes: QuoteVersionDTO[];
let situacaoDoProjeto: ProjectDTO["status"];

/** Serve estas versões — por id, e dentro do Projeto — como JSON novo a cada leitura. */
function servir(lista: QuoteVersionDTO[], status: ProjectDTO["status"] = "WAITING") {
  versoes = lista;
  situacaoDoProjeto = status;
  vi.mocked(getProject).mockImplementation(
    async () =>
      JSON.parse(
        JSON.stringify({ ...PROJETO, status: situacaoDoProjeto, quoteVersions: versoes }),
      ) as ProjectDTO,
  );
  vi.mocked(getQuoteVersion).mockImplementation(async (id: string) => {
    const achada = versoes.find((candidata) => candidata.id === id);
    if (!achada) throw new NotFoundApiError("Registro não encontrado.");
    return JSON.parse(JSON.stringify(achada)) as QuoteVersionDTO;
  });
}

/** Proveniência viva da faixa, como a API serve no rascunho. */
function proveniencia(
  costQuality: IndustrialCostQuality,
  pricingCostQuality?: IndustrialCostQuality,
): QuotePricingProvenanceDTO {
  return {
    pricingVersionId: "prec-1",
    pricingCode: "PREC-000001",
    pricingVersionNumber: 1,
    pricingTierId: "t-1000",
    tierQuantity: "1000.000000000000",
    tierUomCode: "un",
    selectedUnitPrice: "12.50000000",
    calculationCode: "CALC-000001",
    costReferenceDate: "2026-09-01T00:00:00.000Z",
    costStructureLabel: "EC-000001 · V1",
    formulationVersionNumber: 1,
    industrialCostPerUnit: null,
    costQuality,
    // Ausente quando o argumento não vem: faixa ativada antes do campo.
    ...(pricingCostQuality !== undefined ? { pricingCostQuality } : {}),
    commissionPercent: "5.0000",
    contributionPerUnit: null,
    contributionMarginPercent: null,
    markupPercent: null,
    warnings: [],
    frozen: false,
  };
}

/** Onde a navegação deixou a pessoa. */
function Onde() {
  const location = useLocation();
  return <output data-testid="rota">{`${location.pathname}${location.search}`}</output>;
}

const rota = () => screen.getByTestId("rota").textContent;

/** A raiz do app: a guarda de alterações não salvas, uma vez só. */
function Raiz() {
  return (
    <UnsavedChangesProvider>
      <Onde />
      <Outlet />
    </UnsavedChangesProvider>
  );
}

/** As telas desta capability sob o router de dados — rotas reais, API de mentira. */
function abrirApp(entrada: string) {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route path="/comercial/projetos/:id" element={<ProjectDetailPage />} />
        <Route path="/comercial/orcamentos/:id" element={<QuoteVersionPage />} />
        <Route path="/comercial/pedidos/:id" element={<h1>Pedido aberto</h1>} />
        <Route path="/produtos/:productId/cmv" element={<h1>CMV aberto</h1>} />
      </Route>,
    ),
    { initialEntries: [entrada] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** O valor que a página escreve ao lado de um rótulo (`dt` → `dd`). */
function lido(rotulo: string): string | null {
  const termo = [...document.querySelectorAll("dt")].find((dt) => dt.textContent === rotulo);
  return termo?.nextElementSibling?.textContent ?? null;
}

const titulo = (nome: string) => screen.findByRole("heading", { level: 1, name: nome });

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});

describe("Projeto — a seção Orçamentos só lista", () => {
  it("nenhuma proposta aberta embaixo da lista; cada versão tem o seu Abrir, com a volta ao Projeto", async () => {
    servir([V1, V2]);
    abrirApp(VOLTAR);

    expect(await screen.findByText("ORC-000444 · V1")).toBeInTheDocument();
    expect(document.querySelector(".quote-workspace")).toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar ao cliente" })).toBeNull();
    expect(screen.queryByLabelText("Validade da proposta")).toBeNull();
    expect(screen.getByRole("link", { name: "Abrir ORC-000444 · V1" })).toHaveAttribute(
      "href",
      `/comercial/orcamentos/q1${COM_VOLTA}`,
    );
    expect(screen.getByRole("link", { name: "Abrir ORC-000445 · V2" })).toHaveAttribute(
      "href",
      `/comercial/orcamentos/q2${COM_VOLTA}`,
    );
  });

  it("clicar na V1 histórica NAVEGA para a página dela, que se lê — sem formulário", async () => {
    servir([V1, V2]);
    abrirApp(VOLTAR);

    fireEvent.click(await screen.findByText("ORC-000444 · V1"));

    expect(await titulo("ORC-000444 · V1")).toBeInTheDocument();
    expect(rota()).toBe(`/comercial/orcamentos/q1${COM_VOLTA}`);

    // Histórico se lê: nenhum campo na proposta, nem desabilitado.
    const proposta = document.querySelector(".quote-workspace") as HTMLElement;
    expect(proposta.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(within(proposta).getByText(/Proposta apresentada é histórico/)).toBeInTheDocument();

    // O documento: código, versão, situação, data, cliente, projeto, totais.
    expect(lido("Código")).toBe("ORC-000444");
    expect(lido("Versão")).toBe("V1");
    expect(lido("Status")).toBe("Enviado");
    expect(lido("Data")).toBe("05/09/2022");
    expect(lido("Cliente")).toBe("CLI-000001 Cliente Teste");
    expect(lido("Projeto")).toBe("PROJ-000001 Linha Performance");
    expect(lido("Total da proposta")).toContain("12.500,00");
    // As condições gravadas, escritas como o documento as escreve.
    expect(lido("Prazo de entrega")).toBe("15 dias");
    expect(lido("Forma de pagamento")).toBe("À vista");
    expect(lido("Observações comerciais")).toBe("Frete por conta do cliente");

    expect(screen.getByRole("button", { name: "PDF" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: VOLTAR_AO_PROJETO })).toHaveAttribute("href", VOLTAR);
    // Com a V2 em rascunho, duplicar a V1 espera — e diz por quê.
    expect(screen.getByRole("button", { name: "Duplicar como nova versão" })).toBeDisabled();
    expect(screen.getByText(/Já existe a V2 em rascunho/)).toBeInTheDocument();
  });

  it("Enter na linha do rascunho abre a página dele, editável", async () => {
    servir([V1, V2]);
    abrirApp(VOLTAR);

    const linhaDoRascunho = (await screen.findByText("ORC-000445 · V2")).closest("tr") as HTMLElement;
    fireEvent.keyDown(linhaDoRascunho, { key: "Enter" });

    expect(await titulo("ORC-000445 · V2")).toBeInTheDocument();
    expect(rota()).toBe(`/comercial/orcamentos/q2${COM_VOLTA}`);
    expect(screen.getByLabelText("Validade da proposta")).toBeInTheDocument();
    expect(screen.getByLabelText("Quantidade de PROD-000001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar ao cliente" })).toBeInTheDocument();
    expect(lido("Total salvo")).toContain("12.500,00");
  });

  it("projeto sem orçamento explica e oferece a ação", async () => {
    servir([]);
    abrirApp(VOLTAR);

    expect(
      await screen.findByText(
        "Nenhum orçamento neste projeto — use “Criar nova versão” para montar a primeira proposta.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Criar nova versão" })).toBeInTheDocument();
  });

  it("projeto cancelado sem orçamento: a frase não promete ação que não existe", async () => {
    servir([], "CANCELLED");
    abrirApp(VOLTAR);

    expect(await screen.findByText("Nenhum orçamento neste projeto.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Criar nova versão|Novo orçamento/ })).toBeNull();
  });
});

describe("Novo orçamento — do Projeto para a página da versão", () => {
  it("sem rascunho: cria UMA vez e abre a página da versão nova, editável", async () => {
    servir([V1], "APPROVED");
    vi.mocked(createQuoteVersion).mockImplementation(async () => {
      versoes = [...versoes, V3];
      return V3;
    });
    abrirApp(VOLTAR);

    fireEvent.click(await screen.findByRole("button", { name: "Novo orçamento" }));

    expect(await titulo("ORC-000446 · V3")).toBeInTheDocument();
    expect(createQuoteVersion).toHaveBeenCalledTimes(1);
    expect(createQuoteVersion).toHaveBeenCalledWith("prj-1");
    expect(rota()).toBe(`/comercial/orcamentos/q3${COM_VOLTA}`);
    expect(screen.getByLabelText("Validade da proposta")).toBeInTheDocument();
  });

  it("com rascunho aberto: “Abrir rascunho” abre O rascunho que o servidor devolve — nenhuma versão a mais", async () => {
    servir([V1, V2]);
    // A regra de sempre: com rascunho aberto o servidor devolve o próprio rascunho.
    vi.mocked(createQuoteVersion).mockResolvedValue(V2);
    abrirApp(VOLTAR);

    fireEvent.click(await screen.findByRole("button", { name: "Abrir rascunho" }));

    expect(await titulo("ORC-000445 · V2")).toBeInTheDocument();
    expect(createQuoteVersion).toHaveBeenCalledTimes(1);
    const navegacao = screen.getByRole("navigation", { name: "Versões deste projeto" });
    expect(within(navegacao).getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("Página do Orçamento — rascunho", () => {
  it.each([
    [
      "cálculo parcial com base do preço completa: envia sem perguntar por custo",
      "PARTIAL",
      "COMPLETE_REAL_REFERENCE",
      "Enviar esta proposta ao cliente?",
      {},
    ],
    [
      "base do preço parcial: pede confirmação e envia confirmando",
      "COMPLETE_REAL_REFERENCE",
      "PARTIAL",
      "Enviar com custo incompleto?",
      { confirmIncompleteCost: true },
    ],
    [
      "faixa sem o campo: vale a qualidade do cálculo",
      "NO_COST",
      undefined,
      "Enviar com custo incompleto?",
      { confirmIncompleteCost: true },
    ],
  ] as const)("envio pela página — %s", async (_caso, doCalculo, doPreco, pergunta, corpo) => {
    const rascunho = versao({
      ...V2,
      lines: [
        linha({
          id: "ql-2",
          quoteVersionId: "q2",
          priceSource: "PRICING_TIER",
          pricing: proveniencia(doCalculo, doPreco),
        }),
      ],
    });
    servir([V1, rascunho]);
    vi.mocked(sendQuoteVersion).mockImplementation(async () => {
      versoes = versoes.map((candidata) =>
        candidata.id === "q2"
          ? { ...candidata, status: "SENT", sentAt: "2026-09-14T12:00:00.000Z", sentByName: "Admin" }
          : candidata,
      );
      return versoes[1]!;
    });
    abrirApp(`/comercial/orcamentos/q2${COM_VOLTA}`);

    fireEvent.click(await screen.findByRole("button", { name: "Enviar ao cliente" }));
    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText(pergunta)).toBeInTheDocument();
    fireEvent.click(
      within(dialogo).getByRole("button", { name: /^(Enviar ao cliente|Enviar mesmo assim)$/ }),
    );

    await waitFor(() => expect(sendQuoteVersion).toHaveBeenCalledWith("q2", corpo));
    // Enviada, a MESMA página relê e passa a ser leitura — sem voltar ao Projeto.
    await waitFor(() => expect(lido("Status")).toBe("Enviado"));
    expect(screen.queryByRole("button", { name: "Enviar ao cliente" })).toBeNull();
    expect(screen.queryByLabelText("Validade da proposta")).toBeNull();
    expect(rota()).toBe(`/comercial/orcamentos/q2${COM_VOLTA}`);
  });

  it("condição alterada: voltar ao Projeto passa pela guarda, e continuar editando mantém o digitado", async () => {
    const user = userEvent.setup();
    servir([V1, V2]);
    abrirApp(`/comercial/orcamentos/q2${COM_VOLTA}`);

    fireEvent.change(await screen.findByLabelText("Desconto (%)"), { target: { value: "5" } });
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: VOLTAR_AO_PROJETO }));

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(rota()).toBe(`/comercial/orcamentos/q2${COM_VOLTA}`);

    await user.click(screen.getByRole("button", { name: "Continuar editando" }));
    expect(screen.getByLabelText("Desconto (%)")).toHaveValue("5");
    expect(rota()).toBe(`/comercial/orcamentos/q2${COM_VOLTA}`);
  });

  it("sem alteração, voltar ao Projeto sai direto para a ficha", async () => {
    const user = userEvent.setup();
    servir([V1, V2]);
    abrirApp(`/comercial/orcamentos/q2${COM_VOLTA}`);

    await user.click(await screen.findByRole("link", { name: VOLTAR_AO_PROJETO }));

    expect(
      await screen.findByRole("heading", { name: "PROJ-000001 · Linha Performance" }),
    ).toBeInTheDocument();
    expect(rota()).toBe(VOLTAR);
    expect(screen.queryByText("Sair sem salvar?")).toBeNull();
  });
});

describe("Página do Orçamento — histórico", () => {
  it("PDF abre o documento DESTA versão", async () => {
    const abrirJanela = vi.spyOn(window, "open").mockImplementation(() => null);
    servir([V1]);
    abrirApp(`/comercial/orcamentos/q1${COM_VOLTA}`);

    fireEvent.click(await screen.findByRole("button", { name: "PDF" }));

    expect(abrirJanela).toHaveBeenCalledWith("/comercial/orcamentos/q1/imprimir", "_blank");
    abrirJanela.mockRestore();
  });

  it("o Voltar do PDF leva à página da própria versão, não à ficha do Projeto", () => {
    render(
      <MemoryRouter initialEntries={["/comercial/orcamentos/q1/imprimir"]}>
        <Routes>
          <Route path="/comercial/orcamentos/:id/imprimir" element={<QuotePrintPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("volta-do-pdf").textContent).toBe("/comercial/orcamentos/q1");
  });

  it("duplicar abre a página da versão nova, com a mesma volta", async () => {
    servir([V1]);
    vi.mocked(duplicateQuoteVersion).mockImplementation(async () => {
      versoes = [...versoes, V3];
      return V3;
    });
    abrirApp(`/comercial/orcamentos/q1${COM_VOLTA}`);

    fireEvent.click(await screen.findByRole("button", { name: "Duplicar como nova versão" }));
    const dialogo = screen.getByRole("alertdialog", { name: "Duplicar como nova versão" });
    fireEvent.click(within(dialogo).getByRole("radio", { name: /Revisar os preços/ }));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Criar nova versão" }));

    expect(await titulo("ORC-000446 · V3")).toBeInTheDocument();
    expect(duplicateQuoteVersion).toHaveBeenCalledWith("q1", "REVIEW_PRICES");
    expect(rota()).toBe(`/comercial/orcamentos/q3${COM_VOLTA}`);
  });

  it("registrar aceite grava e a página relê a versão aceita", async () => {
    servir([V1]);
    vi.mocked(acceptQuoteVersion).mockImplementation(async () => {
      versoes = [
        { ...V1, status: "ACCEPTED", acceptedAt: "2026-09-14T12:00:00.000Z", acceptedByName: "Admin" },
      ];
      return versoes[0]!;
    });
    abrirApp(`/comercial/orcamentos/q1${COM_VOLTA}`);

    fireEvent.click(await screen.findByRole("button", { name: "Registrar aceite" }));

    await waitFor(() => expect(lido("Status")).toBe("Aceito"));
    expect(acceptQuoteVersion).toHaveBeenCalledWith("q1");
    expect(lido("Aceito em")).toContain("Admin");
    expect(screen.queryByRole("button", { name: "Registrar aceite" })).toBeNull();
  });

  it("registrar recusa grava e a página relê a versão recusada", async () => {
    servir([V1]);
    vi.mocked(rejectQuoteVersion).mockImplementation(async () => {
      versoes = [
        { ...V1, status: "REJECTED", rejectedAt: "2026-09-14T12:00:00.000Z", rejectedByName: "Admin" },
      ];
      return versoes[0]!;
    });
    abrirApp(`/comercial/orcamentos/q1${COM_VOLTA}`);

    fireEvent.click(await screen.findByRole("button", { name: "Registrar recusa" }));

    await waitFor(() => expect(lido("Status")).toBe("Recusado"));
    expect(rejectQuoteVersion).toHaveBeenCalledWith("q1", {});
  });

  it("aceita, com o projeto aprovado: gerar o Pedido leva ao Pedido", async () => {
    servir([{ ...V1, status: "ACCEPTED", acceptedAt: "2026-09-14T12:00:00.000Z" }], "APPROVED");
    vi.mocked(createOrderFromQuote).mockResolvedValue({ id: "co-9", code: "PED-000009" } as never);
    abrirApp(`/comercial/orcamentos/q1${COM_VOLTA}`);

    fireEvent.click(
      await screen.findByRole("button", { name: "Gerar pedido a partir do orçamento aceito" }),
    );

    expect(await screen.findByRole("heading", { name: "Pedido aberto" })).toBeInTheDocument();
    expect(createOrderFromQuote).toHaveBeenCalledWith("q1");
    expect(rota()).toBe("/comercial/pedidos/co-9");
  });
});

describe("Página do Orçamento — endereço", () => {
  it("link direto, sem origem: abre sem botão de volta, com a trilha até o Projeto; recarregar abre igual", async () => {
    servir([V1, V2]);
    abrirApp("/comercial/orcamentos/q1");

    expect(await titulo("ORC-000444 · V1")).toBeInTheDocument();
    expect(getQuoteVersion).toHaveBeenCalledWith("q1");
    expect(getProject).toHaveBeenCalledWith("prj-1");
    expect(screen.queryByRole("link", { name: /^← Voltar/ })).toBeNull();
    const trilha = screen.getByRole("navigation", { name: "Trilha da página" });
    expect(within(trilha).getByRole("link", { name: "PROJ-000001" })).toHaveAttribute("href", VOLTAR);

    // Recarregar é montar de novo a partir do endereço.
    cleanup();
    vi.mocked(getQuoteVersion).mockClear();
    abrirApp("/comercial/orcamentos/q1");
    expect(await titulo("ORC-000444 · V1")).toBeInTheDocument();
    expect(getQuoteVersion).toHaveBeenCalledWith("q1");
  });

  it("versão que não existe: não encontrado, sem tentar de novo", async () => {
    servir([V1]);
    abrirApp("/comercial/orcamentos/nao-existe");

    expect(await screen.findByRole("heading", { name: "Orçamento não encontrado" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).toBeNull();
    expect(screen.getByRole("link", { name: "← Voltar para Projetos" })).toHaveAttribute(
      "href",
      "/comercial/projetos",
    );
    expect(getProject).not.toHaveBeenCalled();
  });

  it.each([
    ["500", () => new Error("Erro interno do servidor (500). Tente novamente ou avise o suporte.")],
    ["rede", () => new TypeError("Failed to fetch")],
  ])("leitura com falha de %s não vira não encontrado; tentar de novo abre", async (_nome, falha) => {
    servir([V1]);
    vi.mocked(getQuoteVersion).mockRejectedValue(falha());
    abrirApp(`/comercial/orcamentos/q1${COM_VOLTA}`);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível carregar o orçamento agora.",
    );
    expect(screen.queryByRole("heading", { name: "Orçamento não encontrado" })).toBeNull();

    servir([V1]);
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(await titulo("ORC-000444 · V1")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("releitura que falha depois de uma ação mantém a página e avisa", async () => {
    servir([V1]);
    vi.mocked(acceptQuoteVersion).mockResolvedValue(V1);
    abrirApp(`/comercial/orcamentos/q1${COM_VOLTA}`);
    await titulo("ORC-000444 · V1");

    vi.mocked(getQuoteVersion).mockRejectedValue(new TypeError("Failed to fetch"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar aceite" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível carregar o orçamento agora. A página abaixo pode estar desatualizada.",
    );
    expect(screen.getByRole("heading", { level: 1, name: "ORC-000444 · V1" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Orçamento não encontrado" })).toBeNull();
  });

  it("endereço antigo do Projeto com versão e linha chega à página própria, na linha", async () => {
    servir([V1, V2]);
    const router = abrirApp(`${VOLTAR}?quoteVersionId=q1&quoteLineId=ql-1`);

    expect(await titulo("ORC-000444 · V1")).toBeInTheDocument();
    expect(rota()).toBe(`/comercial/orcamentos/q1?quoteLineId=ql-1&voltar=${encodeURIComponent(VOLTAR)}`);
    // O endereço antigo sai do histórico: voltar não reabre o redirecionamento.
    expect(router.state.historyAction).toBe("REPLACE");
    await waitFor(() => expect(document.getElementById("quote-line-ql-1")).toHaveClass("is-selected"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(screen.getByRole("link", { name: VOLTAR_AO_PROJETO })).toHaveAttribute("href", VOLTAR);
  });

  it("CMV ida e volta: “Simular CMV” leva o contexto, e a volta chega à página, na linha", async () => {
    servir([V1, V2]);
    const router = abrirApp(`/comercial/orcamentos/q2${COM_VOLTA}`);

    const simular = await screen.findByRole("link", { name: "Simular CMV" });
    expect(simular).toHaveAttribute(
      "href",
      "/produtos/prod-1/cmv?quantity=1000.000000000000&projectId=prj-1&quoteVersionId=q2&quoteLineId=ql-2",
    );
    fireEvent.click(simular);
    expect(await screen.findByRole("heading", { name: "CMV aberto" })).toBeInTheDocument();

    // O endereço de volta que o CMV monta (conferido em `product-cmv/cmv.test.tsx`).
    await act(() =>
      router.navigate(`/comercial/orcamentos/q2?quoteLineId=ql-2&voltar=${encodeURIComponent(VOLTAR)}`),
    );

    expect(await titulo("ORC-000445 · V2")).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById("quote-line-ql-2")).toHaveClass("is-selected"));
    expect(screen.getByRole("link", { name: VOLTAR_AO_PROJETO })).toHaveAttribute("href", VOLTAR);
  });

  it("as outras versões do projeto são outros endereços — um editor por página", async () => {
    servir([V1, V2]);
    abrirApp(`/comercial/orcamentos/q1${COM_VOLTA}`);

    const navegacao = await screen.findByRole("navigation", { name: "Versões deste projeto" });
    expect(within(navegacao).getByText("ORC-000444 · V1 · Enviado")).toHaveAttribute(
      "aria-current",
      "page",
    );
    const outra = within(navegacao).getByRole("link", { name: "ORC-000445 · V2 · Rascunho" });
    expect(outra).toHaveAttribute("href", `/comercial/orcamentos/q2${COM_VOLTA}`);

    fireEvent.click(outra);

    expect(await titulo("ORC-000445 · V2")).toBeInTheDocument();
    expect(document.querySelectorAll(".quote-workspace")).toHaveLength(1);
    expect(screen.getByLabelText("Validade da proposta")).toBeInTheDocument();
  });
});
