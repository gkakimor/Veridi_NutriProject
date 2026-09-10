import { StrictMode, useLayoutEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  ProjectDTO,
  ProjectProductDTO,
  QuoteLineDTO,
  QuotePaymentScheduleDTO,
  QuoteVersionDTO,
  UpdateQuoteVersionInput,
} from "@veridi/shared";

/**
 * Condição comercial digitada e ainda não salva sobrevive à recarga da MESMA
 * versão — QUOTE-DRAFT-STATE-01.
 *
 * O percurso que perdia trabalho: na proposta em rascunho a pessoa digita a
 * validade (ou o desconto, ou o prazo), não clica em "Salvar condições" e
 * adiciona uma linha. A mutação da linha recarrega o Projeto inteiro, a versão
 * volta como um objeto NOVO — com as mesmas condições gravadas —, e o
 * formulário tratava objeto novo como documento novo: descartava o que estava
 * digitado e passava a dizer "Tudo salvo".
 *
 * O que estes casos fixam:
 *
 * 1. mesma versão + alteração local → a alteração fica, e continua pendente;
 * 2. mesma versão + nada alterado → o formulário acompanha o servidor;
 * 3. outra versão → o formulário é dela, nunca o rascunho da anterior;
 * 4. salvar → o valor salvo vira a base, e não há mais o que salvar;
 * 5. a cadeia real — adicionar, editar, remover linha, e a linha que falha —
 *    pela ficha do Projeto, com o servidor devolvendo objetos novos a cada
 *    leitura, como o JSON de uma resposta HTTP.
 *
 * Tudo em StrictMode: a correção não pode depender de efeito rodar uma vez.
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

import {
  addQuoteLine,
  getProject,
  previewQuotePaymentSchedule,
  removeQuoteLine,
  updateQuoteLine,
  updateQuoteVersion,
} from "../../lib/projects-api";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { QuoteConditionsForm } from "./QuoteConditionsForm";

const VALIDADE_GRAVADA = "2026-09-15T00:00:00.000Z";

function linha(overrides: Partial<QuoteLineDTO> = {}): QuoteLineDTO {
  return {
    id: "ql-1",
    quoteVersionId: "q1",
    projectProductId: "pp-1",
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Pré-Treino",
    sortOrder: 1,
    quotedQuantity: "1000",
    uomCode: "un",
    unitPrice: "12.5000",
    total: "12500.00",
    priceSource: "MANUAL",
    priceOrigin: null,
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
    code: "ORC-000001",
    projectId: "prj-1",
    versionNumber: 1,
    versionLabel: "ORC-000001 · V1",
    externalCode: null,
    status: "DRAFT",
    source: "MANUAL",
    quoteDate: "2026-01-02T00:00:00.000Z",
    validUntil: VALIDADE_GRAVADA,
    expired: false,
    currencyCode: "BRL",
    lines: [],
    total: null,
    subtotal: null,
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

/** O plano que o servidor devolveria para 10% sobre R$ 12.500,00. */
const PLANO_SIMULADO: QuotePaymentScheduleDTO = {
  subtotal: "12500.00",
  discountPercent: "10",
  discountAmount: "1250.00",
  total: "11250.00",
  method: "CASH",
  downPaymentPercent: null,
  downPayment: null,
  financedAmount: null,
  monthlyInterestPercent: null,
  installmentIntervalDays: null,
  installments: [{ number: 1, amount: "11250.00", dueInDays: 0 }],
  totalPayable: "11250.00",
  interestAmount: "0.00",
};

function campo(rotulo: string): HTMLInputElement {
  return screen.getByLabelText(rotulo) as HTMLInputElement;
}

function digitar(rotulo: string, valor: string) {
  fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
}

function botaoSalvar(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Salvar condições" }) as HTMLButtonElement;
}

/** O aviso ao lado dos botões: é ele que responde "salvei?". */
function situacao(): string {
  const aviso = screen
    .getAllByRole("status")
    .find((elemento) => /^(Alterações não salvas|Tudo salvo)$/.test(elemento.textContent ?? ""));
  return aviso?.textContent ?? "(sem aviso de situação)";
}

/**
 * O formulário sozinho, e um jeito de entregar a ele uma leitura nova do
 * servidor — objeto NOVO a cada chamada, como a recarga do Projeto produz.
 */
function montarFormulario(quote: QuoteVersionDTO, { editable = true } = {}) {
  const onSave = vi.fn<(input: UpdateQuoteVersionInput) => void>();
  const arvore = (atual: QuoteVersionDTO, podeEditar: boolean) => (
    <StrictMode>
      <QuoteConditionsForm quote={atual} editable={podeEditar} saving={false} onSave={onSave} />
    </StrictMode>
  );
  const { rerender } = render(arvore(quote, editable));
  return {
    onSave,
    releitura: (atual: QuoteVersionDTO, opcoes: { editable?: boolean } = {}) =>
      rerender(arvore(atual, opcoes.editable ?? editable)),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("QUOTE-DRAFT-STATE-01 — a mesma versão recarregada", () => {
  it("a validade digitada e não salva continua no campo quando a MESMA versão volta do servidor", () => {
    const { releitura } = montarFormulario(versao());
    expect(campo("Validade da proposta").value).toBe("2026-09-15");

    digitar("Validade da proposta", "2026-09-20");
    // Mesma versão, objeto novo, e o servidor ainda com 15/09 — é o que a
    // recarga depois de adicionar uma linha entrega.
    releitura(versao());

    expect(campo("Validade da proposta").value).toBe("2026-09-20");
    expect(situacao()).toBe("Alterações não salvas");
    expect(botaoSalvar().disabled).toBe(false);
  });

  it("sem alteração local, a releitura acompanha o que o servidor mandou", () => {
    const { releitura } = montarFormulario(versao());

    releitura(versao({ validUntil: "2026-10-01T00:00:00.000Z", discountPercent: "5.0000" }));

    expect(campo("Validade da proposta").value).toBe("2026-10-01");
    expect(campo("Desconto (%)").value).toBe("5");
    expect(situacao()).toBe("Tudo salvo");
    expect(botaoSalvar().disabled).toBe(true);
  });

  it("com alteração local, o campo que a pessoa NÃO tocou continua acompanhando o servidor", () => {
    const { releitura } = montarFormulario(versao());

    digitar("Validade da proposta", "2026-09-20");
    releitura(versao({ leadTimeDays: 45 }));

    expect(campo("Validade da proposta").value).toBe("2026-09-20");
    expect(campo("Prazo de entrega (dias)").value).toBe("45");
    expect(situacao()).toBe("Alterações não salvas");
  });

  it("os nove campos alterados sobrevivem JUNTOS — não só o último tocado —, e salvar leva os nove", () => {
    const { releitura, onSave } = montarFormulario(versao());

    digitar("Validade da proposta", "2026-09-20");
    digitar("Prazo de entrega (dias)", "15");
    digitar("Observações comerciais", "Frete por conta do cliente");
    digitar("Desconto (%)", "7,5");
    fireEvent.change(screen.getByLabelText("Forma de pagamento"), {
      target: { value: "INSTALLMENTS" },
    });
    digitar("Entrada (%)", "20");
    digitar("Parcelas", "3");
    digitar("Intervalo (dias)", "28");
    digitar("Juros ao mês (%)", "1,5");

    releitura(versao());

    expect({
      validUntil: campo("Validade da proposta").value,
      leadTimeDays: campo("Prazo de entrega (dias)").value,
      commercialNotes: campo("Observações comerciais").value,
      discountPercent: campo("Desconto (%)").value,
      paymentMethod: campo("Forma de pagamento").value,
      downPaymentPercent: campo("Entrada (%)").value,
      installmentCount: campo("Parcelas").value,
      installmentIntervalDays: campo("Intervalo (dias)").value,
      monthlyInterestPercent: campo("Juros ao mês (%)").value,
    }).toEqual({
      validUntil: "2026-09-20",
      leadTimeDays: "15",
      commercialNotes: "Frete por conta do cliente",
      discountPercent: "7,5",
      paymentMethod: "INSTALLMENTS",
      downPaymentPercent: "20",
      installmentCount: "3",
      installmentIntervalDays: "28",
      monthlyInterestPercent: "1,5",
    });
    expect(situacao()).toBe("Alterações não salvas");

    fireEvent.click(botaoSalvar());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      validUntil: "2026-09-20",
      leadTimeDays: 15,
      commercialNotes: "Frete por conta do cliente",
      discountPercent: "7.5",
      paymentMethod: "INSTALLMENTS",
      downPaymentPercent: "20",
      installmentCount: 3,
      installmentIntervalDays: 28,
      monthlyInterestPercent: "1.5",
    });
  });
});

describe("QUOTE-DRAFT-STATE-01 — outra versão é outro documento", () => {
  it("abrir outra versão mostra as condições DELA, nunca o rascunho da anterior", () => {
    const { releitura } = montarFormulario(versao());

    digitar("Validade da proposta", "2026-09-20");
    digitar("Desconto (%)", "7,5");
    releitura(
      versao({
        id: "q2",
        versionNumber: 2,
        versionLabel: "ORC-000001 · V2",
        validUntil: "2026-11-30T00:00:00.000Z",
        discountPercent: null,
      }),
    );

    expect(campo("Validade da proposta").value).toBe("2026-11-30");
    expect(campo("Desconto (%)").value).toBe("");
    expect(situacao()).toBe("Tudo salvo");
  });

  it("versão que deixou de ser rascunho mostra o que foi GRAVADO, não o que ficou digitado", () => {
    const { releitura } = montarFormulario(versao());

    digitar("Desconto (%)", "7,5");
    // Enviada: agora é o documento do cliente, somente leitura.
    releitura(versao({ status: "SENT" }), { editable: false });

    expect(campo("Desconto (%)").value).toBe("");
    expect(campo("Desconto (%)").disabled).toBe(true);
  });

  /*
   * A E2E viu a validade digitada na V2 dentro da V1 enviada: com a leitura
   * absorvida num efeito, a tela era desenhada UMA vez com a versão nova e o
   * rascunho da anterior, e só depois se corrigia. `rerender` espera tudo
   * assentar e não enxerga esse quadro; o efeito de layout do pai enxerga —
   * ele roda a cada quadro desenhado, antes de qualquer efeito comum.
   */
  function montarObservado(inicial: QuoteVersionDTO) {
    const quadros: string[] = [];
    function Tela({ quote }: { quote: QuoteVersionDTO }) {
      useLayoutEffect(() => {
        const validade = document.getElementById("quote-valid-until") as HTMLInputElement;
        quadros.push(`${quote.versionLabel} ${quote.status}: ${validade.value}`);
      });
      return (
        <QuoteConditionsForm
          quote={quote}
          editable={quote.status === "DRAFT"}
          saving={false}
          onSave={() => {}}
        />
      );
    }
    const arvore = (quote: QuoteVersionDTO) => (
      <StrictMode>
        <Tela quote={quote} />
      </StrictMode>
    );
    const { rerender } = render(arvore(inicial));
    return { quadros, trocar: (quote: QuoteVersionDTO) => rerender(arvore(quote)) };
  }

  it("nenhum quadro desenhado mostra a versão aberta com o rascunho de outra", () => {
    const { quadros, trocar } = montarObservado(
      versao({ id: "q2", versionNumber: 2, versionLabel: "ORC-000001 · V2", validUntil: null }),
    );

    digitar("Validade da proposta", "2026-10-15");
    trocar(versao({ status: "SENT", validUntil: "2026-09-20T00:00:00.000Z" }));

    expect(quadros).toContain("ORC-000001 · V1 SENT: 2026-09-20");
    expect(quadros).not.toContain("ORC-000001 · V1 SENT: 2026-10-15");
  });

  it("nenhum quadro desenhado mostra a versão enviada com o que ficou digitado e não foi salvo", () => {
    const { quadros, trocar } = montarObservado(versao());

    digitar("Validade da proposta", "2026-10-15");
    trocar(versao({ status: "SENT" }));

    expect(quadros).toContain("ORC-000001 · V1 SENT: 2026-09-15");
    expect(quadros).not.toContain("ORC-000001 · V1 SENT: 2026-10-15");
  });
});

describe("QUOTE-DRAFT-STATE-01 — salvar troca a base", () => {
  it("o valor salvo continua no campo e não há mais o que salvar", () => {
    const { releitura, onSave } = montarFormulario(versao());

    digitar("Validade da proposta", "2026-09-20");
    fireEvent.click(botaoSalvar());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ validUntil: "2026-09-20" }));

    // O servidor gravou: a leitura seguinte já traz o valor novo.
    releitura(versao({ validUntil: "2026-09-20T00:00:00.000Z" }));

    expect(campo("Validade da proposta").value).toBe("2026-09-20");
    expect(situacao()).toBe("Tudo salvo");
    expect(botaoSalvar().disabled).toBe(true);
  });

  it("percentual digitado com vírgula e gravado com quatro casas não fica pendente depois de salvar", () => {
    const { releitura } = montarFormulario(versao());

    digitar("Desconto (%)", "7,5");
    fireEvent.click(botaoSalvar());
    releitura(versao({ discountPercent: "7.5000" }));

    expect(situacao()).toBe("Tudo salvo");
    expect(botaoSalvar().disabled).toBe(true);
    // A tela passa a mostrar o que ficou gravado.
    expect(campo("Desconto (%)").value).toBe("7.5");
  });
});

describe("QUOTE-DRAFT-STATE-01 — descartar e simular descrevem o rascunho", () => {
  const comLinha = () => versao({ lines: [linha()], subtotal: "12500.00", total: "12500.00" });

  it("descartar volta ao gravado e leva a simulação junto", async () => {
    vi.mocked(previewQuotePaymentSchedule).mockResolvedValue(PLANO_SIMULADO);
    montarFormulario(comLinha());

    digitar("Desconto (%)", "10");
    fireEvent.click(screen.getByRole("button", { name: "Simular" }));
    await screen.findByText(/— ainda não salva/);

    fireEvent.click(screen.getByRole("button", { name: "Descartar alterações" }));

    expect(campo("Desconto (%)").value).toBe("");
    // Simulação de valores que já não estão nos campos seria número de outro momento.
    expect(screen.queryByText(/— ainda não salva/)).toBeNull();
    expect(situacao()).toBe("Tudo salvo");
  });

  it("a releitura tira a simulação — feita sobre as linhas de antes — e mantém o rascunho", async () => {
    vi.mocked(previewQuotePaymentSchedule).mockResolvedValue(PLANO_SIMULADO);
    const { releitura } = montarFormulario(comLinha());

    digitar("Desconto (%)", "10");
    fireEvent.click(screen.getByRole("button", { name: "Simular" }));
    await screen.findByText(/— ainda não salva/);

    releitura(
      versao({
        lines: [linha(), linha({ id: "ql-2", productId: "prod-2", productCode: "PROD-000002" })],
        subtotal: "25000.00",
        total: "25000.00",
      }),
    );

    expect(screen.queryByText(/— ainda não salva/)).toBeNull();
    expect(campo("Desconto (%)").value).toBe("10");
    expect(screen.getByRole("button", { name: "Simular" })).toBeInTheDocument();
  });
});

/*
 * A tela real. Um servidor de mentira COM MEMÓRIA: cada leitura devolve um
 * Projeto novo (JSON ida e volta, como uma resposta HTTP), e cada escrita muda
 * o que a leitura seguinte devolve. É a cadeia que causava a perda — mutação da
 * linha → `onChanged` → `load()` do Projeto → versão nova para o formulário.
 */
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

let noServidor: QuoteVersionDTO;
let produtosDoProjeto: ProjectProductDTO[];

/** Subtotal só existe com todas as linhas precificadas — como no domínio. */
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

/** O que `updateQuoteVersion` grava: data como marcador do dia, percentual com 4 casas. */
function gravarCondicoes(atual: QuoteVersionDTO, input: UpdateQuoteVersionInput): QuoteVersionDTO {
  const quatroCasas = (valor: string | null | undefined) =>
    valor === null || valor === undefined ? null : Number(valor).toFixed(4);
  return {
    ...atual,
    validUntil: input.validUntil ? `${input.validUntil}T00:00:00.000Z` : null,
    leadTimeDays: input.leadTimeDays ?? null,
    commercialNotes: input.commercialNotes ?? null,
    discountPercent: quatroCasas(input.discountPercent),
    paymentMethod: input.paymentMethod ?? atual.paymentMethod,
    downPaymentPercent: quatroCasas(input.downPaymentPercent),
    installmentCount: input.installmentCount ?? null,
    installmentIntervalDays: input.installmentIntervalDays ?? null,
    monthlyInterestPercent: quatroCasas(input.monthlyInterestPercent),
  };
}

function leituraDoProjeto(): ProjectDTO {
  return JSON.parse(
    JSON.stringify({ ...PROJETO, products: produtosDoProjeto, quoteVersions: [noServidor] }),
  ) as ProjectDTO;
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
  await screen.findByLabelText("Validade da proposta");
}

/** A linha da versão na lista de versões — o "Total salvo" só muda com releitura. */
function linhaDaVersao(): HTMLElement {
  return screen.getByText("ORC-000001 · V1", { selector: "td" }).closest("tr") as HTMLElement;
}

function leituras(): number {
  return vi.mocked(getProject).mock.calls.length;
}

describe("QUOTE-DRAFT-STATE-01 — a ficha do Projeto, com a mutação de linha de verdade", () => {
  beforeEach(() => {
    produtosDoProjeto = [vinculo(1, "Pré-Treino"), vinculo(2, "Whey")];
    noServidor = versao();
    vi.mocked(getProject).mockImplementation(async () => leituraDoProjeto());
    vi.mocked(addQuoteLine).mockImplementation(async (_quoteId, projectProductId) => {
      const link = produtosDoProjeto.find((p) => p.id === projectProductId)!;
      const nova = linha({
        id: `ql-${link.productId}`,
        projectProductId: link.id,
        productId: link.productId,
        productCode: link.productCode,
        productName: link.productName,
        sortOrder: noServidor.lines.length + 1,
        quotedQuantity: null,
        unitPrice: null,
        total: null,
      });
      noServidor = comTotais({ ...noServidor, lines: [...noServidor.lines, nova] });
      return nova as never;
    });
    vi.mocked(updateQuoteLine).mockImplementation(async (lineId, input) => {
      noServidor = comTotais({
        ...noServidor,
        lines: noServidor.lines.map((l) =>
          l.id === lineId ? ({ ...l, ...input } as QuoteLineDTO) : l,
        ),
      });
      return noServidor.lines.find((l) => l.id === lineId) as never;
    });
    vi.mocked(removeQuoteLine).mockImplementation(async (lineId) => {
      noServidor = comTotais({
        ...noServidor,
        lines: noServidor.lines.filter((l) => l.id !== lineId),
      });
      return undefined as never;
    });
    vi.mocked(updateQuoteVersion).mockImplementation(async (_id, input) => {
      noServidor = gravarCondicoes(noServidor, input);
      return noServidor as never;
    });
  });

  it("adicionar produto com condições digitadas: elas ficam, continuam pendentes, e nada foi gravado às escondidas", async () => {
    await abrirFicha();

    digitar("Validade da proposta", "2026-09-20");
    digitar("Desconto (%)", "7,5");
    digitar("Observações comerciais", "Frete por conta do cliente");
    fireEvent.change(screen.getByLabelText("Forma de pagamento"), {
      target: { value: "INSTALLMENTS" },
    });
    const validadeAntes = campo("Validade da proposta");
    const antes = leituras();

    fireEvent.change(screen.getByLabelText("Adicionar produto à proposta"), {
      target: { value: "pp-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    // A linha nova só aparece depois que o Projeto foi relido.
    await screen.findByLabelText("Quantidade de PROD-000001");
    expect(leituras()).toBeGreaterThan(antes);

    expect(campo("Validade da proposta").value).toBe("2026-09-20");
    expect(campo("Desconto (%)").value).toBe("7,5");
    expect(campo("Observações comerciais").value).toBe("Frete por conta do cliente");
    expect(campo("Forma de pagamento").value).toBe("INSTALLMENTS");
    expect(situacao()).toBe("Alterações não salvas");
    expect(botaoSalvar().disabled).toBe(false);

    // Adicionar produto é uma operação; salvar condição é outra.
    expect(updateQuoteVersion).not.toHaveBeenCalled();
    expect(noServidor.validUntil).toBe(VALIDADE_GRAVADA);
    // O mesmo elemento: a recarga não desmontou o formulário.
    expect(campo("Validade da proposta")).toBe(validadeAntes);
  });

  it("editar a quantidade da linha (grava ao sair do campo) não apaga a condição digitada", async () => {
    noServidor = versao({ lines: [linha({ quotedQuantity: null, total: null })] });
    await abrirFicha();

    digitar("Validade da proposta", "2026-09-20");
    digitar("Prazo de entrega (dias)", "15");
    const quantidade = screen.getByLabelText("Quantidade de PROD-000001");
    fireEvent.change(quantidade, { target: { value: "2000" } });
    fireEvent.blur(quantidade);

    // 2.000 × R$ 12,50: o "Total salvo" da lista só muda com a releitura.
    await waitFor(() => expect(linhaDaVersao().textContent).toContain("25.000,00"));
    expect(updateQuoteLine).toHaveBeenCalledWith("ql-1", { quotedQuantity: "2000" });

    expect(campo("Validade da proposta").value).toBe("2026-09-20");
    expect(campo("Prazo de entrega (dias)").value).toBe("15");
    expect(situacao()).toBe("Alterações não salvas");
    expect(botaoSalvar().disabled).toBe(false);
  });

  it("remover uma linha não apaga a condição digitada", async () => {
    noServidor = comTotais(
      versao({
        lines: [
          linha(),
          linha({
            id: "ql-2",
            projectProductId: "pp-2",
            productId: "prod-2",
            productCode: "PROD-000002",
            productName: "Whey",
            sortOrder: 2,
          }),
        ],
      }),
    );
    await abrirFicha();

    digitar("Desconto (%)", "7,5");
    digitar("Observações comerciais", "Frete por conta do cliente");
    const linhaDoWhey = screen.getByLabelText("Quantidade de PROD-000002").closest("tr") as HTMLElement;
    fireEvent.click(
      [...linhaDoWhey.querySelectorAll("button")].find((b) => b.textContent === "Remover")!,
    );

    await waitFor(() => expect(screen.queryByLabelText("Quantidade de PROD-000002")).toBeNull());
    expect(removeQuoteLine).toHaveBeenCalledWith("ql-2");

    expect(campo("Desconto (%)").value).toBe("7,5");
    expect(campo("Observações comerciais").value).toBe("Frete por conta do cliente");
    expect(situacao()).toBe("Alterações não salvas");
  });

  it("linha que falha ao gravar não mexe no formulário de condições", async () => {
    vi.mocked(addQuoteLine).mockRejectedValueOnce(new Error("Produto já está na proposta"));
    await abrirFicha();

    digitar("Validade da proposta", "2026-09-20");
    digitar("Desconto (%)", "7,5");
    const antes = leituras();
    fireEvent.change(screen.getByLabelText("Adicionar produto à proposta"), {
      target: { value: "pp-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));

    await screen.findByText(/Produto já está na proposta/);
    expect(leituras()).toBe(antes);
    expect(campo("Validade da proposta").value).toBe("2026-09-20");
    expect(campo("Desconto (%)").value).toBe("7,5");
    expect(situacao()).toBe("Alterações não salvas");
    expect(botaoSalvar().disabled).toBe(false);
  });

  it("formulário sem alteração, linha adicionada: as condições continuam as gravadas", async () => {
    await abrirFicha();

    fireEvent.change(screen.getByLabelText("Adicionar produto à proposta"), {
      target: { value: "pp-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await screen.findByLabelText("Quantidade de PROD-000002");

    expect(campo("Validade da proposta").value).toBe("2026-09-15");
    expect(situacao()).toBe("Tudo salvo");
    expect(botaoSalvar().disabled).toBe(true);
  });

  it("depois da linha, salvar grava o que foi digitado e o formulário fica limpo", async () => {
    await abrirFicha();

    digitar("Validade da proposta", "2026-09-20");
    digitar("Desconto (%)", "7,5");
    fireEvent.change(screen.getByLabelText("Adicionar produto à proposta"), {
      target: { value: "pp-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }));
    await screen.findByLabelText("Quantidade de PROD-000001");

    fireEvent.click(botaoSalvar());

    await waitFor(() => expect(situacao()).toBe("Tudo salvo"));
    expect(updateQuoteVersion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ validUntil: "2026-09-20", discountPercent: "7.5" }),
    );
    expect(noServidor.validUntil).toBe("2026-09-20T00:00:00.000Z");
    expect(campo("Validade da proposta").value).toBe("2026-09-20");
    expect(campo("Desconto (%)").value).toBe("7.5");
    expect(botaoSalvar().disabled).toBe(true);
  });
});
