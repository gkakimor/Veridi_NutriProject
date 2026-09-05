import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProjectDTO, QuoteLineDTO, QuoteVersionDTO } from "@veridi/shared";

/**
 * O total do Orçamento em edição é PRÉVIA do que está na tela (BACKLOG #8H).
 *
 * Os campos de quantidade e preço eram não-controlados e só salvavam ao
 * perder o foco: enquanto a pessoa digitava, o total da linha e o "Total da
 * proposta" continuavam mostrando a conta do salvamento ANTERIOR — número
 * velho apresentado como consequência dos campos atuais. Agora a prévia sai
 * das mesmas funções que a API usa (`calcularTotaisOrcamento` e
 * `buildPaymentSchedule`), sem gravar nada, e versão enviada/aceita continua
 * sendo histórico que não recalcula.
 */

vi.mock("../../lib/products-api", () => ({ listProducts: () => Promise.resolve({ products: [] }) }));
vi.mock("../../lib/projects-api", () => ({
  createProjectProduct: vi.fn(),
  linkProjectProduct: vi.fn(),
  acceptQuoteVersion: vi.fn(),
  addQuoteLine: vi.fn(),
  applyQuotePricing: vi.fn(),
  createOrderFromQuote: vi.fn(),
  createQuoteVersion: vi.fn(),
  getQuotePricingOptions: vi.fn(() => Promise.resolve(null)),
  previewQuotePaymentSchedule: vi.fn(),
  rejectQuoteVersion: vi.fn(),
  removeQuoteLine: vi.fn(),
  sendQuoteVersion: vi.fn(),
  updateQuoteLine: vi.fn(),
  updateQuoteVersion: vi.fn(),
  useManualQuotePrice: vi.fn(),
}));

import { updateQuoteLine } from "../../lib/projects-api";
import { QuoteVersionsSection } from "./QuoteVersionsSection";

function linha(overrides: Partial<QuoteLineDTO> = {}): QuoteLineDTO {
  return {
    id: "ql-1",
    quoteVersionId: "q1",
    projectProductId: null,
    productId: "prod-1",
    productCode: "PROD-000001",
    productName: "Pré-Treino",
    sortOrder: 1,
    quotedQuantity: "1000",
    uomCode: "un",
    unitPrice: "12.5000",
    total: "12500.00",
    priceSource: "MANUAL",
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
    validUntil: null,
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

function projeto(versions: QuoteVersionDTO[]): ProjectDTO {
  return {
    id: "prj-1",
    code: "PROJ-000001",
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "NutriViva",
    name: "Linha Performance",
    status: "SAMPLE",
    products: [],
    quoteVersions: versions,
    statusHistory: [],
  } as unknown as ProjectDTO;
}

/** `toLocaleString` separa R$ do número com espaço fino — normalizar para ler. */
function texto(valor: string | null | undefined): string {
  return (valor ?? "").replace(/ /g, " ");
}

function abrir(versions: QuoteVersionDTO[], onChanged = () => {}) {
  render(
    <MemoryRouter>
      <QuoteVersionsSection
        project={projeto(versions)}
        canEdit
        projectStatus="SAMPLE"
        onChanged={onChanged}
      />
    </MemoryRouter>,
  );
}

/** O rodapé da tabela de linhas — o total da proposta. */
function rodape(): string {
  return texto(document.querySelector("tfoot")?.textContent);
}

/** O total exibido na linha do produto. */
function totalDaLinha(productCode: string): string {
  const celulas = screen
    .getByLabelText(`Quantidade de ${productCode}`)
    .closest("tr")!
    .querySelectorAll("td");
  return texto(celulas[celulas.length - 2]?.textContent);
}

beforeEach(() => {
  vi.mocked(updateQuoteLine).mockReset();
});

describe("#8H — orçamento em edição mostra o total do que está na tela", () => {
  it("A. mudar a quantidade muda o subtotal da linha na hora", () => {
    abrir([versao()]);
    fireEvent.change(screen.getByLabelText("Quantidade de PROD-000001"), {
      target: { value: "2000" },
    });
    // 2000 × 12,50 = 25.000,00 — sem sair do campo e sem gravar.
    expect(totalDaLinha("PROD-000001")).toContain("R$ 25.000,00");
  });

  it("B. mudar o preço muda o subtotal da linha na hora", () => {
    abrir([versao()]);
    fireEvent.change(screen.getByLabelText("Preço unitário de PROD-000001"), {
      target: { value: "13,25" },
    });
    expect(totalDaLinha("PROD-000001")).toContain("R$ 13.250,00");
  });

  it("C. o total da proposta acompanha, rotulado como prévia", () => {
    abrir([versao()]);
    expect(rodape()).toContain("Total da proposta (prévia)");
    expect(rodape()).toContain("R$ 12.500,00");

    fireEvent.change(screen.getByLabelText("Quantidade de PROD-000001"), {
      target: { value: "2000" },
    });
    expect(rodape()).toContain("R$ 25.000,00");
    // E o gravado continua na tela, dito como gravado — com a copy aprovada
    // pelo PO, que descreve o mecanismo em vez de mandar o usuário agir.
    expect(rodape()).toContain("Total salvo: R$ 12.500,00");
    expect(rodape()).toContain("alterações são gravadas ao sair do campo");
  });

  it("D. com várias linhas, o total soma a editada com as gravadas", () => {
    abrir([
      versao({
        lines: [
          linha(),
          linha({
            id: "ql-2",
            productId: "prod-2",
            productCode: "PROD-000002",
            productName: "Whey",
            quotedQuantity: "100",
            unitPrice: "20.0000",
            total: "2000.00",
            sortOrder: 2,
          }),
        ],
        subtotal: "14500.00",
        total: "14500.00",
      }),
    ]);
    fireEvent.change(screen.getByLabelText("Preço unitário de PROD-000001"), {
      target: { value: "13,25" },
    });
    // 13.250,00 (editada) + 2.000,00 (gravada) = 15.250,00.
    expect(rodape()).toContain("R$ 15.250,00");
    expect(totalDaLinha("PROD-000002")).toContain("R$ 2.000,00");
  });

  it("E. o desconto gravado entra na prévia pela mesma conta do documento", () => {
    abrir([versao({ discountPercent: "10.0000", total: "11250.00" })]);
    fireEvent.change(screen.getByLabelText("Quantidade de PROD-000001"), {
      target: { value: "2000" },
    });
    // 25.000,00 − 10% = 22.500,00.
    expect(rodape()).toContain("R$ 22.500,00");
  });

  it("F. precisão decimal: 0,1 × 3 dez vezes fecha em R$ 3,00", () => {
    abrir([
      versao({
        lines: Array.from({ length: 10 }, (_, i) =>
          linha({
            id: `ql-${i}`,
            productId: `prod-${i}`,
            productCode: `PROD-00000${i}`,
            quotedQuantity: "0.1",
            unitPrice: "3.0000",
            total: "0.30",
          }),
        ),
        subtotal: "3.00",
        total: "3.00",
      }),
    ]);
    fireEvent.change(screen.getByLabelText("Preço unitário de PROD-000000"), {
      target: { value: "3" },
    });
    expect(rodape()).toContain("R$ 3,00");
  });

  it("G. digitar não grava: o PATCH só sai ao perder o foco", () => {
    abrir([versao()]);
    fireEvent.change(screen.getByLabelText("Quantidade de PROD-000001"), {
      target: { value: "2000" },
    });
    expect(updateQuoteLine).not.toHaveBeenCalled();
  });

  it("H. salvar envia o operando que gerou a prévia", async () => {
    vi.mocked(updateQuoteLine).mockResolvedValue({} as never);
    abrir([versao()]);
    const campo = screen.getByLabelText("Quantidade de PROD-000001");
    fireEvent.change(campo, { target: { value: "2000" } });
    fireEvent.blur(campo);

    await waitFor(() => expect(updateQuoteLine).toHaveBeenCalled());
    const [lineId, payload] = vi.mocked(updateQuoteLine).mock.calls[0]!;
    expect(lineId).toBe("ql-1");
    expect(payload.quotedQuantity).toBe("2000");
  });

  it("I. recarregar a tela descarta a digitação e volta ao gravado", () => {
    abrir([versao()]);
    fireEvent.change(screen.getByLabelText("Quantidade de PROD-000001"), {
      target: { value: "9999" },
    });
    expect(rodape()).toContain("R$ 124.987,50");

    // Recarregar é remontar: nada da digitação sobrevive.
    cleanup();
    abrir([versao()]);
    expect((screen.getByLabelText("Quantidade de PROD-000001") as HTMLInputElement).value).toBe(
      "1000",
    );
    expect(rodape()).toContain("R$ 12.500,00");
    expect(rodape()).not.toContain("Total salvo");
  });

  it("I2. o gravado volta a mandar assim que o servidor confirma", () => {
    const { rerender } = render(
      <MemoryRouter>
        <QuoteVersionsSection
          project={projeto([versao()])}
          canEdit
          projectStatus="SAMPLE"
          onChanged={() => {}}
        />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Quantidade de PROD-000001"), {
      target: { value: "2000" },
    });
    expect(rodape()).toContain("Total salvo: R$ 12.500,00");

    // A proposta recarregada já traz 2000 gravado: o rascunho de tela sai e o
    // rodapé deixa de ter dois números concorrendo.
    rerender(
      <MemoryRouter>
        <QuoteVersionsSection
          project={projeto([
            versao({
              lines: [linha({ quotedQuantity: "2000", total: "25000.00" })],
              subtotal: "25000.00",
              total: "25000.00",
            }),
          ])}
          canEdit
          projectStatus="SAMPLE"
          onChanged={() => {}}
        />
      </MemoryRouter>,
    );
    expect(rodape()).toContain("R$ 25.000,00");
    expect(rodape()).not.toContain("Total salvo");
  });

  it("J. versão enviada é histórico: sem campos e sem prévia", () => {
    abrir([versao({ status: "SENT", sentAt: "2026-02-01T00:00:00.000Z" })]);
    expect(screen.queryByLabelText("Quantidade de PROD-000001")).toBeNull();
    expect(rodape()).toContain("Total da proposta");
    expect(rodape()).not.toContain("prévia");
    expect(rodape()).toContain("R$ 12.500,00");
  });

  it("K. versão aceita é histórico e não recalcula", () => {
    abrir([
      versao({
        status: "ACCEPTED",
        acceptedAt: "2026-02-02T00:00:00.000Z",
        sourcedOrder: {
          id: "co-1",
          code: "PED-000001",
          status: "CONFIRMED",
          createdAt: "2026-02-02T00:00:00.000Z",
        },
      }),
    ]);
    expect(screen.queryByLabelText("Preço unitário de PROD-000001")).toBeNull();
    expect(rodape()).toContain("R$ 12.500,00");
    expect(rodape()).not.toContain("prévia");
  });

  it("L. editar o rascunho não toca no total da versão histórica", () => {
    const historica = versao({
      id: "q1",
      versionNumber: 1,
      versionLabel: "ORC-000001 · V1",
      status: "SENT",
      sentAt: "2026-02-01T00:00:00.000Z",
    });
    const rascunho = versao({
      id: "q2",
      versionNumber: 2,
      versionLabel: "ORC-000001 · V2",
      status: "DRAFT",
      lines: [linha({ id: "ql-2", quoteVersionId: "q2" })],
    });
    abrir([historica, rascunho]);

    fireEvent.change(screen.getByLabelText("Quantidade de PROD-000001"), {
      target: { value: "5000" },
    });
    expect(rodape()).toContain("R$ 62.500,00");
    // A lista de versões continua descrevendo o que está gravado em cada uma.
    const listaV1 = screen.getByText("ORC-000001 · V1").closest("tr")!;
    expect(texto(listaV1.textContent)).toContain("R$ 12.500,00");
    expect(screen.getByText("Total salvo", { selector: "th" })).toBeTruthy();
  });

  it("M. valor incompleto não vira zero: sem total, com aviso", () => {
    abrir([versao({ lines: [linha({ unitPrice: null, total: null })], subtotal: null, total: null })]);
    expect(totalDaLinha("PROD-000001")).toContain("—");
    expect(rodape()).toContain("Existem produtos sem preço definido");
    expect(rodape()).not.toContain("R$ 0,00");
  });

  it("N. valor ilegível não produz total falso e é dito", () => {
    abrir([versao()]);
    fireEvent.change(screen.getByLabelText("Quantidade de PROD-000001"), {
      target: { value: "1.2.3" },
    });
    expect(rodape()).toContain("Existe valor que não dá para ler");
    // A prévia fica sem número; o gravado segue à vista, com o próprio nome.
    expect(texto(document.querySelector("tfoot strong")?.textContent)).toBe("—");
    expect(rodape()).toContain("Total salvo: R$ 12.500,00");
    expect(totalDaLinha("PROD-000001")).toContain("—");
    expect(
      screen.getByLabelText("Quantidade de PROD-000001").getAttribute("aria-invalid"),
    ).toBe("true");
  });

  /*
   * BACKLOG #15 — a tela e o documento fecham no MESMO centavo.
   *
   * Duas linhas de 7 × R$ 12,3450: cada uma imprime R$ 86,42 e a proposta
   * fecha em R$ 172,84. Somar sem arredondar e arredondar no fim daria
   * R$ 172,83 — um total que não bate com as linhas que estão na tela.
   */
  it("O. o total da proposta é a soma das linhas impressas, centavo por centavo", () => {
    const quatroCasas = (id: string, code: string, name: string, sortOrder: number) =>
      linha({
        id,
        productId: `prod-${sortOrder}`,
        productCode: code,
        productName: name,
        quotedQuantity: "7",
        unitPrice: "12.3450",
        total: "86.42",
        sortOrder,
      });

    abrir([
      versao({
        lines: [
          quatroCasas("ql-1", "PROD-000001", "Pré-Treino", 1),
          quatroCasas("ql-2", "PROD-000002", "Whey", 2),
        ],
        subtotal: "172.84",
        total: "172.84",
      }),
    ]);

    expect(totalDaLinha("PROD-000001")).toContain("R$ 86,42");
    expect(totalDaLinha("PROD-000002")).toContain("R$ 86,42");
    expect(rodape()).toContain("R$ 172,84");
    expect(rodape()).not.toContain("R$ 172,83");

    // E ao vivo, com a segunda linha digitada, a regra é a mesma.
    fireEvent.change(screen.getByLabelText("Quantidade de PROD-000002"), {
      target: { value: "14" },
    });
    // 14 × 12,3450 = 172,83 → R$ 172,83 na linha; 86,42 + 172,83 = 259,25.
    expect(totalDaLinha("PROD-000002")).toContain("R$ 172,83");
    expect(rodape()).toContain("R$ 259,25");
  });
});
