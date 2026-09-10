import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ProjectDTO, ProjectProductDTO, QuoteLineDTO, QuoteVersionDTO } from "@veridi/shared";

/**
 * A proposta não se envia com linha que a tela mostra e o servidor não tem —
 * QUOTE-SEND-LINE-DRAFT-01.
 *
 * Quantidade, preço e unidade da linha gravam ao sair do campo. Quando esse
 * salvamento FALHAVA, o campo continuava mostrando o digitado — de propósito:
 * a pessoa precisa ver o que tentou informar —, o servidor ficava com o valor
 * antigo, e "Enviar ao cliente" seguia disponível. O envio congela o gravado:
 * a tela mostrava R$ 12,50 e o cliente recebia R$ 10,00.
 *
 * O que estes casos fixam:
 *
 * 1. valor digitado diferente do gravado segura o envio desde a primeira
 *    tecla — sem esperar o blur, sem corrida entre salvar e enviar;
 * 2. salvamento em andamento segura; o que dá certo libera; o que falha
 *    mantém o digitado no campo e o envio preso até a nova tentativa passar;
 * 3. uma linha pendente segura o orçamento inteiro, e condição e linha
 *    pendentes se somam numa espera só;
 * 4. o campo com o valor gravado não segura nada: pendência é valor, não foco;
 * 5. a confirmação já aberta confere de novo.
 */

vi.mock("../../app/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "u-1", name: "Admin", role: "ADMIN" } }),
}));
vi.mock("../../components/AttachmentsSection", () => ({ AttachmentsSection: () => null }));
vi.mock("../../lib/projects-api", () => ({
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
  adjustQuotePrice: vi.fn(),
  applyQuotePricing: vi.fn(),
  createOrderFromQuote: vi.fn(),
  createQuoteVersion: vi.fn(),
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

import { getProject, sendQuoteVersion, updateQuoteLine } from "../../lib/projects-api";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { QuoteVersionsSection } from "./QuoteVersionsSection";

const PRODUTOS =
  "Salve as alterações dos produtos antes de enviar o orçamento. O envio usa somente os valores já salvos.";
const CONDICOES =
  "Salve as alterações das condições antes de enviar o orçamento. O envio usa somente as condições já salvas.";
const TUDO =
  "Salve as alterações do orçamento antes de enviar. O envio usa somente o que já está salvo.";

const PRECO = "Preço unitário de PROD-000001";
const QUANTIDADE = "Quantidade de PROD-000001";
const UNIDADE = "Unidade de PROD-000001";

function linha(overrides: Partial<QuoteLineDTO> = {}): QuoteLineDTO {
  return {
    id: "ql-1",
    quoteVersionId: "q1",
    projectProductId: "pp-1",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Pré-Treino",
    sortOrder: 1,
    // Como a API devolve: quantidade com doze casas, preço com quatro.
    quotedQuantity: "1000.000000000000",
    uomCode: "un",
    unitPrice: "10.0000",
    total: "10000.00",
    priceSource: "MANUAL",
    priceOrigin: null,
    inheritedFromQuoteLineId: null,
    adjustmentPercent: null,
    priceOriginReason: null,
    pricing: null,
    ...overrides,
  };
}

const SEGUNDA = () =>
  linha({
    id: "ql-2",
    projectProductId: "pp-2",
    productId: "prod-2",
    productCode: "PROD-000002",
    productName: "Whey",
    sortOrder: 2,
  });

function versao(overrides: Partial<QuoteVersionDTO> = {}): QuoteVersionDTO {
  return {
    id: "q1",
    code: "ORC-000001",
    projectId: "prj-1",
    versionNumber: 1,
    versionLabel: "ORC-000001 · V1",
    externalCode: null,
    status: "DRAFT",
    source: "MANUAL",
    quoteDate: "2026-01-02T00:00:00.000Z",
    validUntil: "2026-09-15T00:00:00.000Z",
    expired: false,
    currencyCode: "BRL",
    lines: [linha()],
    total: "10000.00",
    subtotal: "10000.00",
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
    customerCode: null,
    customerName: null,
    customerTradeName: null,
    customerCnpj: null,
    customerZipCode: null,
    customerStreet: null,
    customerNumber: null,
    customerComplement: null,
    customerDistrict: null,
    customerCity: null,
    customerState: null,
    projectCode: null,
    projectName: null,
    projectConcept: null,
    projectChannel: null,
    createdAt: "2026-01-02T00:00:00.000Z",
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
};

function vinculo(n: number, nome: string): ProjectProductDTO {
  return {
    id: `pp-${n}`,
    projectId: "prj-1",
    productId: `prod-${n}`,
    productCode: `PROD-00000${n}`,
    productName: nome,
    productLifecycle: "DEVELOPMENT",
    productActive: true,
    sequence: n,
    status: "ACTIVE",
    costing: null,
    latestSampleCode: null,
    latestSampleLabel: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByName: null,
  };
}

function campo(rotulo: string): HTMLInputElement {
  return screen.getByLabelText(rotulo) as HTMLInputElement;
}

function digitar(rotulo: string, valor: string) {
  fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
}

function botaoEnviar(): HTMLButtonElement {
  // Com a confirmação aberta há dois "Enviar ao cliente"; o da página vem primeiro.
  return screen.getAllByRole("button", { name: "Enviar ao cliente" })[0] as HTMLButtonElement;
}

/** O motivo do bloqueio, perto do botão — `null` quando nada bloqueia. */
function avisoDeEnvio(): HTMLElement | null {
  return document.getElementById("quote-send-pending");
}

async function confirmarEnvio() {
  const dialogo = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialogo).getByRole("button", { name: "Enviar ao cliente" }));
}

/** Envio bloqueado por esta razão, e nenhuma confirmação nem chamada ao tentar. */
function conferirBloqueio(razao: string) {
  const enviar = botaoEnviar();
  expect(enviar.disabled).toBe(true);
  expect(avisoDeEnvio()?.textContent).toBe(razao);
  expect(enviar.getAttribute("aria-describedby")).toBe("quote-send-pending");
  expect(enviar.title).toBe(razao.slice(0, razao.indexOf(".") + 1));
  fireEvent.click(enviar);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(sendQuoteVersion).not.toHaveBeenCalled();
}

/** A seção de orçamentos sozinha, com projeto fixo e sem servidor. */
function abrirSecao(quote: QuoteVersionDTO = versao()) {
  render(
    <StrictMode>
      <MemoryRouter>
        <QuoteVersionsSection
          project={{ ...PROJETO, products: [], quoteVersions: [quote] }}
          canEdit
          projectStatus="WAITING"
          onChanged={() => {}}
        />
      </MemoryRouter>
    </StrictMode>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendQuoteVersion).mockReset();
});

describe("QUOTE-SEND-LINE-DRAFT-01 — o que está no campo da linha segura o envio", () => {
  it("preço digitado diferente do gravado segura o envio antes mesmo de sair do campo", () => {
    abrirSecao();
    expect(botaoEnviar().disabled).toBe(false);

    digitar(PRECO, "12,50");

    conferirBloqueio(PRODUTOS);
  });

  it("quantidade digitada diferente do gravado segura o envio", () => {
    abrirSecao();

    digitar(QUANTIDADE, "1200");

    conferirBloqueio(PRODUTOS);
  });

  it("unidade digitada diferente da gravada segura o envio", () => {
    abrirSecao();

    digitar(UNIDADE, "cx");

    conferirBloqueio(PRODUTOS);
  });

  it("o valor gravado escrito de outro jeito não segura nada: pendência é valor, não foco", () => {
    abrirSecao();

    fireEvent.focus(campo(PRECO));
    digitar(PRECO, "10");
    digitar(QUANTIDADE, "1000,0");
    digitar(UNIDADE, " un ");

    expect(botaoEnviar().disabled).toBe(false);
    expect(avisoDeEnvio()).toBeNull();
  });

  it("uma linha pendente segura o orçamento inteiro, mesmo com as outras gravadas", () => {
    abrirSecao(versao({ lines: [linha(), SEGUNDA()], subtotal: "20000.00", total: "20000.00" }));

    digitar("Preço unitário de PROD-000002", "12,50");

    conferirBloqueio(PRODUTOS);
  });

  it.each([
    ["condições salvas e linhas salvas", false, false, null],
    ["condição por salvar e linhas salvas", true, false, CONDICOES],
    ["condições salvas e linha por salvar", false, true, PRODUTOS],
    ["condição e linha por salvar", true, true, TUDO],
  ] as const)("%s", (_caso, condicao, produto, razao) => {
    abrirSecao();

    if (condicao) digitar("Validade da proposta", "2026-09-20");
    if (produto) digitar(PRECO, "12,50");

    if (razao === null) {
      expect(botaoEnviar().disabled).toBe(false);
      expect(avisoDeEnvio()).toBeNull();
    } else {
      conferirBloqueio(razao);
    }
  });

  it("a confirmação que já estava aberta confere de novo a linha", async () => {
    abrirSecao();
    fireEvent.click(botaoEnviar());
    const dialogo = await screen.findByRole("alertdialog");

    // Com a confirmação aberta, um preço muda.
    digitar(PRECO, "12,50");
    fireEvent.click(within(dialogo).getByRole("button", { name: "Enviar ao cliente" }));

    expect(sendQuoteVersion).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(PRODUTOS);
  });
});

/*
 * A ficha inteira, com um servidor de mentira COM MEMÓRIA: cada leitura devolve
 * um Projeto novo e cada escrita muda o que a leitura seguinte devolve. É o
 * caminho real — o campo sai, a linha grava (ou não), o Projeto é relido.
 */
let noServidor: QuoteVersionDTO;
/** O que o envio congelou, linha a linha. */
let linhasNoEnvio: { preco: string | null; quantidade: string | null; unidade: string | null }[];

function comTotais(atual: QuoteVersionDTO): QuoteVersionDTO {
  const completas = atual.lines.every((l) => l.quotedQuantity !== null && l.unitPrice !== null);
  const subtotal =
    atual.lines.length > 0 && completas
      ? atual.lines
          .reduce((soma, l) => soma + Number(l.quotedQuantity) * Number(l.unitPrice), 0)
          .toFixed(2)
      : null;
  return { ...atual, subtotal, total: subtotal };
}

/** Como o servidor grava a linha: quantidade com doze casas, preço com quatro. */
function gravarLinha(
  atual: QuoteLineDTO,
  input: { quotedQuantity?: string | null; unitPrice?: string | null; uomCode?: string | null },
): QuoteLineDTO {
  const casas = (valor: string | null, n: number) => (valor === null ? null : Number(valor).toFixed(n));
  return {
    ...atual,
    ...(input.quotedQuantity !== undefined
      ? { quotedQuantity: casas(input.quotedQuantity, 12) }
      : {}),
    ...(input.unitPrice !== undefined ? { unitPrice: casas(input.unitPrice, 4) } : {}),
    ...(input.uomCode !== undefined ? { uomCode: input.uomCode } : {}),
  };
}

function gravarNoServidor(
  lineId: string,
  input: { quotedQuantity?: string | null; unitPrice?: string | null; uomCode?: string | null },
) {
  noServidor = comTotais({
    ...noServidor,
    lines: noServidor.lines.map((l) => (l.id === lineId ? gravarLinha(l, input) : l)),
  });
}

async function abrirFicha() {
  render(
    <StrictMode>
      <MemoryRouter initialEntries={["/comercial/projetos/prj-1"]}>
        <Routes>
          <Route path="/comercial/projetos/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
  await screen.findByLabelText(PRECO);
}

describe("QUOTE-SEND-LINE-DRAFT-01 — salvar a linha, falhar, tentar de novo", () => {
  beforeEach(() => {
    noServidor = versao();
    linhasNoEnvio = [];
    vi.mocked(getProject).mockImplementation(async () =>
      JSON.parse(
        JSON.stringify({
          ...PROJETO,
          products: [vinculo(1, "Pré-Treino"), vinculo(2, "Whey")],
          quoteVersions: [noServidor],
        }),
      ),
    );
    vi.mocked(updateQuoteLine).mockImplementation(async (lineId, input) => {
      gravarNoServidor(lineId, input);
      return noServidor as never;
    });
    vi.mocked(sendQuoteVersion).mockImplementation(async () => {
      // Como o servidor de verdade: o envio congela o que está GRAVADO.
      linhasNoEnvio = noServidor.lines.map((l) => ({
        preco: l.unitPrice,
        quantidade: l.quotedQuantity,
        unidade: l.uomCode,
      }));
      noServidor = { ...noServidor, status: "SENT", sentAt: "2026-09-10T12:00:00.000Z" };
      return noServidor as never;
    });
  });

  it("salvamento em andamento segura o envio; quando dá certo, libera sem recarregar", async () => {
    let concluir!: () => void;
    vi.mocked(updateQuoteLine).mockImplementationOnce(
      (lineId, input) =>
        new Promise<never>((resolve) => {
          concluir = () => {
            gravarNoServidor(lineId, input);
            resolve(noServidor as never);
          };
        }),
    );
    await abrirFicha();

    digitar(PRECO, "12,50");
    fireEvent.blur(campo(PRECO));
    await waitFor(() => expect(updateQuoteLine).toHaveBeenCalledWith("ql-1", { unitPrice: "12.50" }));
    expect(botaoEnviar().disabled).toBe(true);

    await act(async () => concluir());

    await waitFor(() => expect(botaoEnviar().disabled).toBe(false));
    expect(avisoDeEnvio()).toBeNull();
    expect(campo(PRECO).value).toBe("12.5000");
  });

  it("preço: o salvamento que falha deixa o digitado e o envio preso; a nova tentativa libera, e o que vai é o preço novo", async () => {
    vi.mocked(updateQuoteLine).mockRejectedValueOnce(new Error("Não foi possível salvar a linha."));
    await abrirFicha();

    digitar(PRECO, "12,50");
    fireEvent.blur(campo(PRECO));

    await screen.findByText(/Não foi possível salvar a linha\./);
    // O digitado fica: a pessoa vê o que tentou informar, junto do erro.
    expect(campo(PRECO).value).toBe("12,50");
    expect(noServidor.lines[0]?.unitPrice).toBe("10.0000");
    conferirBloqueio(PRODUTOS);

    // Nova tentativa: sair do campo de novo grava.
    fireEvent.blur(campo(PRECO));
    await waitFor(() => expect(botaoEnviar().disabled).toBe(false));
    expect(avisoDeEnvio()).toBeNull();
    expect(screen.queryByText(/Não foi possível salvar a linha\./)).toBeNull();

    fireEvent.click(botaoEnviar());
    await confirmarEnvio();
    await waitFor(() => expect(sendQuoteVersion).toHaveBeenCalledTimes(1));
    expect(linhasNoEnvio).toEqual([
      { preco: "12.5000", quantidade: "1000.000000000000", unidade: "un" },
    ]);
  });

  it("quantidade: o salvamento que falha segura o envio", async () => {
    vi.mocked(updateQuoteLine).mockRejectedValueOnce(new Error("Não foi possível salvar a linha."));
    await abrirFicha();

    digitar(QUANTIDADE, "1200");
    fireEvent.blur(campo(QUANTIDADE));

    await screen.findByText(/Não foi possível salvar a linha\./);
    expect(campo(QUANTIDADE).value).toBe("1200");
    conferirBloqueio(PRODUTOS);
  });

  it("unidade: o salvamento que falha segura o envio", async () => {
    vi.mocked(updateQuoteLine).mockRejectedValueOnce(new Error("Não foi possível salvar a linha."));
    await abrirFicha();

    digitar(UNIDADE, "cx");
    fireEvent.blur(campo(UNIDADE));

    await screen.findByText(/Não foi possível salvar a linha\./);
    expect(campo(UNIDADE).value).toBe("cx");
    conferirBloqueio(PRODUTOS);

    fireEvent.blur(campo(UNIDADE));
    await waitFor(() => expect(botaoEnviar().disabled).toBe(false));
    expect(noServidor.lines[0]?.uomCode).toBe("cx");
  });

  it("duas linhas: a que ficou pendente segura o orçamento; salva, libera", async () => {
    noServidor = comTotais(versao({ lines: [linha(), SEGUNDA()] }));
    vi.mocked(updateQuoteLine).mockRejectedValueOnce(new Error("Não foi possível salvar a linha."));
    await abrirFicha();

    digitar("Preço unitário de PROD-000002", "12,50");
    fireEvent.blur(campo("Preço unitário de PROD-000002"));

    await screen.findByText(/Não foi possível salvar a linha\./);
    // A primeira linha está gravada; é a segunda que segura.
    expect(campo(PRECO).value).toBe("10.0000");
    conferirBloqueio(PRODUTOS);

    fireEvent.blur(campo("Preço unitário de PROD-000002"));
    await waitFor(() => expect(botaoEnviar().disabled).toBe(false));
    expect(noServidor.lines[1]?.unitPrice).toBe("12.5000");
  });
});
