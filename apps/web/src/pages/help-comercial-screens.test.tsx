import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { helpHints, helpTopics } from "../help/help-content";
import type { HelpTopic, HelpTopicId } from "../help/help-content";

/**
 * Ajuda contextual nas telas do Comercial — Projetos, Amostras, Expedições.
 *
 * O comportamento do painel (foco, teclado, caixas clicáveis) já tem suíte
 * própria em `components/help/help-kit.test.tsx`. O que estes testes
 * protegem é outra coisa:
 *
 * 1. a LIGAÇÃO — a tela de Expedições não pode exibir a explicação de
 *    Amostras, e o painel não pode nascer aberto empurrando a operação para
 *    baixo da dobra;
 * 2. a ORDEM — "Nesta tela" (o vocabulário) vem antes do fluxo, porque
 *    quem não sabe o que é "reservado disponível" não aproveita um caminho
 *    que começa por ele;
 * 3. a REGRA que motivou cada tópico. As frases abaixo são literais de
 *    propósito: "reprovar não estorna consumo", "só a confirmada mexe no
 *    estoque", "aprovar a amostra não aprova o projeto". Reescrevê-las é
 *    permitido — em silêncio, não.
 */

vi.mock("../app/AuthProvider", () => ({ useAuth: () => ({ user: { id: "u-1", role: "ADMIN" } }) }));
vi.mock("../components/AttachmentsSection", () => ({ AttachmentsSection: () => null }));

vi.mock("../lib/projects-api", () => ({
  listProjects: vi.fn(),
  getProjectVocabulary: () => Promise.resolve({ concepts: [], channels: [] }),
  getProject: vi.fn(),
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
  applyQuotePricing: vi.fn(),
  createOrderFromQuote: vi.fn(),
  createQuoteVersion: vi.fn(),
  // Consultada por linha assim que há quantidade: precisa devolver promessa.
  getQuotePricingOptions: vi.fn(() => Promise.resolve(null)),
  rejectQuoteVersion: vi.fn(),
  removeQuoteLine: vi.fn(),
  sendQuoteVersion: vi.fn(),
  updateQuoteLine: vi.fn(),
  updateQuoteVersion: vi.fn(),
  useManualQuotePrice: vi.fn(),
}));
vi.mock("../lib/products-api", () => ({ listProducts: () => Promise.resolve({ products: [] }) }));
vi.mock("../lib/customers-api", () => ({ listCustomers: () => Promise.resolve({ customers: [] }) }));
vi.mock("../lib/samples-api", () => ({
  listSamples: vi.fn(),
  getSample: vi.fn(),
  approveSample: vi.fn(),
  cancelSample: vi.fn(),
  produceSample: vi.fn(),
  registerSampleConsumption: vi.fn(),
  rejectSample: vi.fn(),
}));
vi.mock("../lib/shipments-api", () => ({
  listShipments: vi.fn(),
  getShipment: vi.fn(),
  updateShipment: vi.fn(),
  confirmShipment: vi.fn(),
  cancelShipment: vi.fn(),
  verifyShipmentLine: vi.fn(),
}));
vi.mock("../lib/billings-api", () => ({ createBilling: vi.fn() }));
vi.mock("../lib/items-api", () => ({ listItems: () => Promise.resolve({ items: [] }) }));
vi.mock("../lib/units-api", () => ({ listUnits: () => Promise.resolve([]) }));
vi.mock("../lib/inventory-api", () => ({ getInventoryItem: vi.fn() }));

import { getProject, listProjects } from "../lib/projects-api";
import { getSample, listSamples } from "../lib/samples-api";
import { getShipment, listShipments } from "../lib/shipments-api";

import { ProjectsPage } from "./projects/ProjectsPage";
import { ProjectDetailPage } from "./projects/ProjectDetailPage";
import { SamplesPage } from "./samples/SamplesPage";
import { SampleDetailPage } from "./samples/SampleDetailPage";
import { ShipmentsPage } from "./shipments/ShipmentsPage";
import { ShipmentPage } from "./shipments/ShipmentPage";

/**
 * O contrato do painel, verificado igual em toda tela: nasce fechado, abre
 * com o tópico DAQUELA tela, mostra a regra e fecha pelo botão do diálogo.
 *
 * O gatilho fica atrás do overlay enquanto a ajuda está aberta — clicar nele
 * de novo não chega nele, e é o "Fechar" do diálogo que encerra.
 */
async function verificaPainel(topicoId: HelpTopicId, regraEsperada: RegExp) {
  const topico: HelpTopic = helpTopics[topicoId];
  const user = userEvent.setup();
  const gatilho = screen.getByRole("button", { name: /Como funciona/ });

  expect(gatilho).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("heading", { name: topico.title })).toBeNull();

  await user.click(gatilho);

  expect(gatilho).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("heading", { name: topico.title })).toBeInTheDocument();
  expect(screen.getByText(regraEsperada)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Fechar" }));

  expect(gatilho).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("heading", { name: topico.title })).toBeNull();
}

/**
 * As caixas numeradas de um fluxo, na ordem — `1Rótulo`, `2Rótulo`, …
 *
 * O número é o que amarra o desenho ao passo a passo logo abaixo; sem a
 * ordem certa, clicar na caixa 3 destaca a explicação errada.
 */
function verificaFluxoNumerado(topicoId: HelpTopicId, nomeDoFluxo: string) {
  const topico: HelpTopic = helpTopics[topicoId];
  const etapas =
    topico.flows?.find((fluxo) => fluxo.name === nomeDoFluxo)?.steps ?? topico.flow ?? [];

  expect(etapas.length).toBeGreaterThan(0);

  const lista = screen.getByRole("list", { name: `Fluxo: ${nomeDoFluxo}` });
  expect(Array.from(lista.querySelectorAll("li")).map((item) => item.textContent)).toEqual(
    etapas.map((etapa, i) => `${i + 1}${etapa.label}`),
  );
}

/** O vocabulário da tela é apresentado, e vem ANTES do primeiro fluxo. */
function verificaGlossarioAntesDoFluxo(topicoId: HelpTopicId) {
  const topico: HelpTopic = helpTopics[topicoId];
  const conceitos = topico.concepts ?? [];
  expect(conceitos.length).toBeGreaterThanOrEqual(4);

  // Os termos são procurados DENTRO do glossário: "Rascunho" e "Quantidade"
  // também são rótulo de caixa e cabeçalho de coluna, e uma busca solta pelo
  // texto acharia o lugar errado.
  const titulo = screen.getByRole("heading", { name: "Nesta tela" });
  const glossario = titulo.nextElementSibling;
  expect(glossario).not.toBeNull();
  expect(Array.from(glossario!.querySelectorAll("dt")).map((dt) => dt.textContent)).toEqual(
    conceitos.map((conceito) => conceito.term),
  );

  // Ordem no documento: o glossário precede o desenho do primeiro caminho.
  const primeiroFluxo = screen.getAllByRole("list", { name: /^Fluxo: / })[0]!;
  expect(titulo.compareDocumentPosition(primeiroFluxo)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function renderRota(path: string, url: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Projetos (lista)", () => {
  async function abrir() {
    vi.mocked(listProjects).mockResolvedValue({ projects: [], total: 0 } as never);

    render(
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(listProjects).toHaveBeenCalled());
  }

  it("diz o que é um projeto e que aprovado é terminal — e começa fechado", async () => {
    await abrir();

    await verificaPainel(
      "comercial.projetos",
      /não aceita edição, amostra nova nem orçamento novo/,
    );
  });

  it("apresenta o vocabulário do funil antes de desenhar o caminho", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    verificaGlossarioAntesDoFluxo("comercial.projetos");
  });

  it("separa o projeto que avança do projeto que não fecha", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    // Duas situações diferentes na mesma tela: cada uma tem nome, e o
    // stand-by não é lido como uma etapa do caminho feliz.
    verificaFluxoNumerado("comercial.projetos", "Fluxo A · Projeto que avança");
    verificaFluxoNumerado("comercial.projetos", "Fluxo B · Projeto que não fecha");
  });

  it("explica no ⓘ da coluna que a última versão é de orçamento", async () => {
    await abrir();

    const dica = helpHints["comercial.projetoUltimaVersao"];
    expect(screen.queryByText(dica.text)).toBeNull();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: `Ajuda sobre ${dica.label}` }));

    expect(screen.getByText(dica.text)).toBeInTheDocument();
  });
});

describe("Projeto (detalhe)", () => {
  async function abrir() {
    vi.mocked(getProject).mockResolvedValue({
      id: "prj-1",
      code: "PROJ-000001",
      externalCode: null,
      customerId: "cli-1",
      customerCode: "CLI-000006",
      customerName: "NutriViva",
      name: "Linha Performance",
      concept: null,
      channel: null,
      status: "WAITING",
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
      costing: null,
      productName: null,
      latestQuoteLabel: null,
      latestQuoteStatus: null,
      acceptedQuoteLabel: null,
      products: [],
      quoteVersions: [],
      statusHistory: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      createdByName: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as never);
    vi.mocked(listSamples).mockResolvedValue({ samples: [], total: 0 } as never);

    renderRota("/comercial/projetos/:id", "/comercial/projetos/prj-1", <ProjectDetailPage />);
    await waitFor(() => expect(getProject).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(/PROJ-000001/).length).toBeGreaterThan(0));
  }

  it("diz que enviado congela a versão — e a explicação começa fechada", async () => {
    await abrir();

    await verificaPainel("comercial.projeto", /Enviado é congelamento/);
  });

  it("separa a proposta com faixa da proposta com preço manual", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    verificaGlossarioAntesDoFluxo("comercial.projeto");
    verificaFluxoNumerado("comercial.projeto", "Fluxo A · Preço vindo da precificação");
    verificaFluxoNumerado("comercial.projeto", "Fluxo B · Preço manual");
  });

  it("diz que custo e margem nunca saem no documento do cliente", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    expect(
      screen.getByText(/não entram no documento do cliente, e só perfis comercial/),
    ).toBeInTheDocument();
  });
});

describe("Amostras (lista)", () => {
  async function abrir() {
    vi.mocked(listSamples).mockResolvedValue({ samples: [], total: 0 } as never);

    render(
      <MemoryRouter>
        <SamplesPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(listSamples).toHaveBeenCalled());
  }

  it("diz que amostra não é lote nem ordem de produção — e começa fechado", async () => {
    await abrir();

    await verificaPainel("comercial.amostras", /Amostra não é lote e não é ordem de produção/);
  });

  it("mostra o ciclo da amostra numerado, do rascunho à decisão", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    verificaGlossarioAntesDoFluxo("comercial.amostras");
    // Caminho único: o painel dá a ele o nome genérico, e a numeração é a
    // mesma que o passo a passo usa.
    verificaFluxoNumerado("comercial.amostras", "Fluxo da tela");
  });

  it("diz que aprovar a amostra não aprova o projeto", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    expect(screen.getByText(/Aprovar a amostra não aprova o projeto/)).toBeInTheDocument();
  });
});

describe("Amostra (detalhe)", () => {
  async function abrir() {
    vi.mocked(getSample).mockResolvedValue({
      id: "am-1",
      code: "AM-000001",
      externalCode: null,
      projectId: "prj-1",
      projectCode: "PROJ-000001",
      projectName: "Linha Performance",
      customerId: "cli-1",
      customerName: "NutriViva",
      projectProductId: null,
      productId: null,
      productCode: null,
      productName: null,
      testSequence: 1,
      testLabel: "T1",
      status: "PRODUCED",
      source: "MANUAL",
      description: null,
      productionNotes: null,
      decisionNotes: null,
      outputQuantity: null,
      outputUomCode: null,
      customerNameSnapshot: null,
      projectCodeSnapshot: null,
      projectNameSnapshot: null,
      qrPayload: "SAMPLE:AM-000001",
      consumptions: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      createdByName: null,
      startedAt: null,
      startedByName: null,
      producedAt: null,
      producedByName: null,
      approvedAt: null,
      approvedByName: null,
      rejectedAt: null,
      rejectedByName: null,
      cancelledAt: null,
      cancelledByName: null,
    } as never);

    renderRota("/comercial/amostras/:id", "/comercial/amostras/am-1", <SampleDetailPage />);
    await waitFor(() => expect(getSample).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(/AM-000001/).length).toBeGreaterThan(0));
  }

  it("diz que reprovar não estorna consumo — e começa fechado", async () => {
    await abrir();

    await verificaPainel("comercial.amostra", /Reprovar ou cancelar não estorna nada/);
  });

  it("separa a amostra com consumo da amostra sem consumo registrado", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    verificaGlossarioAntesDoFluxo("comercial.amostra");
    verificaFluxoNumerado("comercial.amostra", "Fluxo A · Amostra com consumo de material");
    verificaFluxoNumerado("comercial.amostra", "Fluxo B · Amostra sem consumo registrado");
  });

  it("explica no ⓘ que material de cliente só serve para amostra do mesmo cliente", async () => {
    await abrir();

    const dica = helpHints["comercial.amostraProprietario"];
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: `Ajuda sobre ${dica.label}` }));

    expect(screen.getByText(dica.text)).toBeInTheDocument();
  });
});

describe("Expedições (lista)", () => {
  async function abrir() {
    vi.mocked(listShipments).mockResolvedValue({ shipments: [], total: 0 } as never);

    render(
      <MemoryRouter>
        <ShipmentsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(listShipments).toHaveBeenCalled());
  }

  it("diz que só a expedição confirmada mexe no estoque — e começa fechado", async () => {
    await abrir();

    await verificaPainel("comercial.expedicoes", /Rascunho não é realidade física/);
  });

  it("mostra o caminho do pedido ao faturamento, numerado", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    verificaGlossarioAntesDoFluxo("comercial.expedicoes");
    verificaFluxoNumerado("comercial.expedicoes", "Fluxo da tela");
  });

  it("diz que expedição confirmada não se edita nem se cancela", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    expect(
      screen.getByText(/Expedição confirmada não se edita, não se reconfirma e não se cancela/),
    ).toBeInTheDocument();
  });

  it("explica no ⓘ da coluna o que Quantidade significa em cada situação", async () => {
    await abrir();

    const dica = helpHints["comercial.expedicaoQuantidade"];
    expect(screen.queryByText(dica.text)).toBeNull();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: `Ajuda sobre ${dica.label}` }));

    expect(screen.getByText(dica.text)).toBeInTheDocument();
  });
});

describe("Expedição (detalhe)", () => {
  async function abrir() {
    vi.mocked(getShipment).mockResolvedValue({
      id: "exp-1",
      code: "EXP-000005",
      status: "DRAFT",
      customerOrderId: "ped-1",
      customerOrderCode: "PED-000003",
      customerId: "cli-1",
      customerName: "IGEIA BELEZA E NUTRICAO LTDA",
      shipmentDate: "2026-08-22T00:00:00.000Z",
      notes: null,
      lines: [],
      products: [],
      totalQuantity: "0",
      verification: {
        productCount: 0,
        lotsRequired: 0,
        lotsVerified: 0,
        allLotsVerified: true,
      },
      billingId: null,
      billingCode: null,
      billingStatus: "PENDING",
      confirmedAt: null,
      confirmedBy: null,
      cancelledAt: null,
      cancelledBy: null,
      cancelReason: null,
      createdAt: "2026-08-22T00:00:00.000Z",
      createdBy: "Admin",
    } as never);

    renderRota("/comercial/expedicoes/:id", "/comercial/expedicoes/exp-1", <ShipmentPage />);
    await waitFor(() => expect(getShipment).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText("EXP-000005").length).toBeGreaterThan(0));
  }

  it("diz que confirmar é o único ato que move estoque — e começa fechado", async () => {
    await abrir();

    await verificaPainel("comercial.expedicao", /Conferir é só auditoria/);
  });

  it("separa a expedição total da entrega parcial", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    verificaGlossarioAntesDoFluxo("comercial.expedicao");
    verificaFluxoNumerado("comercial.expedicao", "Fluxo A · Expedição total do pedido");
    verificaFluxoNumerado("comercial.expedicao", "Fluxo B · Entrega parcial");
  });

  it("diz que trocar de lote é realocação explícita, nunca substituição automática", async () => {
    await abrir();
    await userEvent.setup().click(screen.getByRole("button", { name: /Como funciona/ }));

    expect(
      screen.getByText(/é uma realocação explícita da reserva, feita no Pedido do Cliente/),
    ).toBeInTheDocument();
  });
});
