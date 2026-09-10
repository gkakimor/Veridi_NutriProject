import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProjectDTO, QuoteVersionDTO } from "@veridi/shared";
import { ProjectCommercialSummary } from "./ProjectCommercialSummary";

/**
 * O resumo comercial do Projeto — PROJECT-COMMERCIAL-SUMMARY-01.
 *
 * O que estes casos protegem é o que se LÊ na coluna direita da ficha, e
 * sobretudo o que ela NÃO pode dizer.
 *
 * A regra central é uma: a versão MAIS RECENTE e a última EFETIVAMENTE
 * ENVIADA podem ser diferentes. `V3 SENT` + `V4 DRAFT` é o caso normal de uma
 * renegociação em aberto, e mostrar "V4 · Rascunho" ao lado de "Enviado em:
 * 14/09" — a data da V3 — anuncia um envio que não aconteceu. O caso da
 * mistura de versões é o que reprova se alguém simplificar isto.
 *
 * O valor vem de `QuoteVersionDTO.total`, que o servidor já entrega COM o
 * desconto aplicado. Nada aqui soma linha, e `null` nunca vira R$ 0,00 —
 * "ainda não há total" e "custa zero" são coisas diferentes.
 */

function quote(overrides: Partial<QuoteVersionDTO>): QuoteVersionDTO {
  return {
    id: `q-${overrides.versionNumber ?? 1}`,
    code: `ORC-00012${overrides.versionNumber ?? 1}`,
    projectId: "prj-1",
    versionNumber: 1,
    versionLabel: `ORC-00012${overrides.versionNumber ?? 1} · V${overrides.versionNumber ?? 1}`,
    externalCode: null,
    status: "DRAFT",
    source: "MANUAL",
    quoteDate: "2026-09-01T00:00:00.000Z",
    validUntil: null,
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
    createdAt: "2026-09-01T00:00:00.000Z",
    createdByName: null,
    ...overrides,
  } as QuoteVersionDTO;
}

function linha(productId: string) {
  return {
    id: `l-${productId}`,
    quoteVersionId: "q-1",
    projectProductId: null,
    productId,
    productCode: `PROD-${productId}`,
    productName: `Produto ${productId}`,
    sortOrder: 1,
    quotedQuantity: "1000",
    uomCode: "un",
    unitPrice: "10",
    total: "10000",
    priceSource: "MANUAL" as const,
    pricing: null,
    priceOrigin: null,
    inheritedFromQuoteLineId: null,
    adjustmentPercent: null,
    priceOriginReason: null,
  };
}

function projeto(overrides: Partial<ProjectDTO> = {}): ProjectDTO {
  return {
    id: "prj-1",
    code: "PROJ-000001",
    externalCode: null,
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "G S TEZOTTO",
    customerPhone: "15999998888",
    customerEmail: "contato@empresa.com.br",
    name: "Multivitamínico Detox",
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
    ...overrides,
  } as ProjectDTO;
}

/** Renderiza o bloco e devolve a lista de definições. */
function abrir(project: ProjectDTO) {
  render(
    <MemoryRouter>
      <ProjectCommercialSummary project={project} />
    </MemoryRouter>,
  );
  return screen.getByRole("heading", { name: "Comercial" }).parentElement!.querySelector(
    "dl",
  ) as HTMLElement;
}

/**
 * O valor que vem logo depois do rótulo.
 *
 * O espaço entre `R$` e o número é NÃO SEPARÁVEL — o formatador canônico o
 * usa para o símbolo nunca ficar sozinho no fim da linha. Normalizar aqui
 * deixa a asserção legível sem esconder o que a tela mostra.
 */
function valorDe(lista: HTMLElement, rotulo: string): string {
  const dt = within(lista).getByText(rotulo);
  const texto = (dt.nextElementSibling as HTMLElement).textContent ?? "";
  return texto.replace(/\s+/g, " ").trim();
}

function temRotulo(lista: HTMLElement, rotulo: string): boolean {
  return within(lista).queryByText(rotulo) !== null;
}

describe("resumo comercial do Projeto", () => {
  it("A. projeto sem orçamento mostra o bloco assim mesmo, sem parecer quebrado", () => {
    const lista = abrir(projeto());

    // O rótulo é o canônico de `PROJECT_STATUS_LABELS`, não um inventado aqui.
    expect(valorDe(lista, "Situação do projeto")).toBe("Aguardando");
    expect(valorDe(lista, "Último orçamento")).toBe("Nenhum");
    expect(valorDe(lista, "Valor da proposta")).toBe("—");
    expect(valorDe(lista, "Itens orçados")).toBe("0 produtos");
    expect(valorDe(lista, "Condição de pagamento")).toBe("—");
    expect(valorDe(lista, "Enviado em")).toBe("—");
    expect(valorDe(lista, "Validade")).toBe("—");
    expect(valorDe(lista, "Última atividade comercial")).toBe("Nenhum orçamento enviado");
    // Nada de "última proposta enviada" quando nunca houve envio.
    expect(temRotulo(lista, "Última proposta enviada")).toBe(false);
  });

  it("B. só rascunho: o valor aparece, o envio não", () => {
    const lista = abrir(
      projeto({
        quoteVersions: [
          quote({ versionNumber: 1, status: "DRAFT", total: "12000", lines: [linha("a")] }),
        ],
      }),
    );

    expect(valorDe(lista, "Último orçamento")).toBe("ORC-000121 · V1 · Rascunho");
    expect(valorDe(lista, "Valor da proposta")).toBe("R$ 12.000,00");
    expect(valorDe(lista, "Itens orçados")).toBe("1 produto");
    // Rascunho não foi enviado, e não existe versão anterior de onde tirar data.
    expect(valorDe(lista, "Enviado em")).toBe("—");
    expect(temRotulo(lista, "Última proposta enviada")).toBe(false);
    expect(valorDe(lista, "Última atividade comercial")).toBe("Nenhum orçamento enviado");
  });

  it("C. proposta enviada mostra a data da PRÓPRIA versão", () => {
    const lista = abrir(
      projeto({
        quoteVersions: [
          quote({
            versionNumber: 2,
            status: "SENT",
            total: "10000",
            sentAt: "2026-09-14T18:00:00.000Z",
            validUntil: "2026-10-15T00:00:00.000Z",
            lines: [linha("a"), linha("b")],
          }),
        ],
      }),
    );

    expect(valorDe(lista, "Último orçamento")).toBe("ORC-000122 · V2 · Enviado");
    expect(valorDe(lista, "Enviado em")).toBe("14/09/2026");
    expect(valorDe(lista, "Validade")).toBe("15/10/2026");
    expect(valorDe(lista, "Itens orçados")).toBe("2 produtos");
    // A versão corrente É a última enviada: não se repete a informação.
    expect(temRotulo(lista, "Última proposta enviada")).toBe(false);
    expect(valorDe(lista, "Última atividade comercial")).toBe(
      "Orçamento V2 enviado em 14/09/2026",
    );
  });

  it("D. SENT + DRAFT: a V4 é o último orçamento, e a V3 é quem foi enviada", () => {
    const lista = abrir(
      projeto({
        quoteVersions: [
          quote({
            versionNumber: 3,
            status: "SENT",
            total: "10000",
            sentAt: "2026-09-14T18:00:00.000Z",
            lines: [linha("a")],
          }),
          quote({
            versionNumber: 4,
            status: "DRAFT",
            total: "12000",
            lines: [linha("a"), linha("b")],
          }),
        ],
      }),
    );

    expect(valorDe(lista, "Último orçamento")).toBe("ORC-000124 · V4 · Rascunho");
    expect(valorDe(lista, "Valor da proposta")).toBe("R$ 12.000,00");
    expect(valorDe(lista, "Itens orçados")).toBe("2 produtos");
    // A LINHA QUE IMPEDE A MENTIRA: a V4 não foi enviada.
    expect(valorDe(lista, "Enviado em")).toBe("—");
    expect(valorDe(lista, "Última proposta enviada")).toBe("ORC-000123 · V3 · 14/09/2026");
  });

  it("D2. a data da versão anterior NUNCA aparece como envio da versão corrente", () => {
    const lista = abrir(
      projeto({
        quoteVersions: [
          quote({ versionNumber: 3, status: "SENT", total: "10000", sentAt: "2026-09-14T18:00:00.000Z" }),
          quote({ versionNumber: 4, status: "DRAFT", total: "12000" }),
        ],
      }),
    );

    // "14/09/2026" existe na ficha — mas só na linha da V3, nunca na do envio
    // da versão corrente nem colada ao valor da V4.
    expect(valorDe(lista, "Enviado em")).not.toContain("14/09/2026");
    expect(valorDe(lista, "Última proposta enviada")).toContain("V3");
    expect(valorDe(lista, "Último orçamento")).toContain("V4");
    expect(valorDe(lista, "Último orçamento")).not.toContain("14/09/2026");
  });

  it("E. proposta aceita mostra o aceite como última atividade", () => {
    const lista = abrir(
      projeto({
        status: "APPROVED",
        quoteVersions: [
          quote({
            versionNumber: 3,
            status: "ACCEPTED",
            total: "10000",
            sentAt: "2026-09-14T18:00:00.000Z",
            acceptedAt: "2026-09-15T13:00:00.000Z",
            lines: [linha("a")],
          }),
        ],
      }),
    );

    expect(valorDe(lista, "Situação do projeto")).toBe("Aprovado");
    expect(valorDe(lista, "Último orçamento")).toBe("ORC-000123 · V3 · Aceito");
    expect(valorDe(lista, "Valor da proposta")).toBe("R$ 10.000,00");
    expect(valorDe(lista, "Última atividade comercial")).toBe(
      "Orçamento V3 aceito em 15/09/2026",
    );
  });

  it("F. proposta recusada continua mostrando situação e valor", () => {
    const lista = abrir(
      projeto({
        quoteVersions: [
          quote({
            versionNumber: 2,
            status: "REJECTED",
            total: "9000",
            sentAt: "2026-09-01T12:00:00.000Z",
            rejectedAt: "2026-09-03T12:00:00.000Z",
            lines: [linha("a")],
          }),
        ],
      }),
    );

    // Não fechar não apaga o histórico: quem lê precisa saber que houve
    // proposta, quanto valia e que o cliente disse não.
    expect(valorDe(lista, "Último orçamento")).toBe("ORC-000122 · V2 · Recusado");
    expect(valorDe(lista, "Valor da proposta")).toBe("R$ 9.000,00");
    expect(valorDe(lista, "Última atividade comercial")).toBe(
      "Orçamento V2 recusado em 03/09/2026",
    );
  });

  it("G/H. o valor é o total do DTO — nunca a soma das linhas nem o subtotal bruto", () => {
    const lista = abrir(
      projeto({
        quoteVersions: [
          quote({
            versionNumber: 1,
            status: "SENT",
            sentAt: "2026-09-14T18:00:00.000Z",
            // Duas linhas de R$ 10.000 e 10% de desconto: o bruto é 20.000 e o
            // que o cliente recebeu é 18.000. Somar as linhas aqui daria 20.000.
            subtotal: "20000",
            discountPercent: "10",
            total: "18000",
            lines: [linha("a"), linha("b")],
          }),
        ],
      }),
    );

    expect(valorDe(lista, "Valor da proposta")).toBe("R$ 18.000,00");
    expect(valorDe(lista, "Valor da proposta")).not.toContain("20.000");
  });

  it("I. total ausente é travessão, nunca R$ 0,00", () => {
    const lista = abrir(
      projeto({
        quoteVersions: [quote({ versionNumber: 1, status: "DRAFT", total: null, lines: [linha("a")] })],
      }),
    );

    expect(valorDe(lista, "Valor da proposta")).toBe("—");
    expect(valorDe(lista, "Valor da proposta")).not.toContain("0,00");
  });

  it("J. a condição de pagamento é a mesma frase da Origem Comercial do Pedido", () => {
    const lista = abrir(
      projeto({
        quoteVersions: [
          quote({
            versionNumber: 1,
            status: "SENT",
            total: "9000",
            sentAt: "2026-09-14T18:00:00.000Z",
            paymentMethod: "INSTALLMENTS",
            paymentSchedule: {
              subtotal: "9000",
              discountPercent: null,
              discountAmount: "0.00",
              total: "9000.00",
              method: "INSTALLMENTS",
              downPaymentPercent: "25",
              downPayment: "2250.00",
              financedAmount: "6750.00",
              monthlyInterestPercent: null,
              installmentIntervalDays: 30,
              installments: [
                { number: 1, amount: "2250.00", dueInDays: 30 },
                { number: 2, amount: "2250.00", dueInDays: 60 },
                { number: 3, amount: "2250.00", dueInDays: 90 },
              ],
              totalPayable: "9000.00",
              interestAmount: "0.00",
            },
          }),
        ],
      }),
    );

    expect(valorDe(lista, "Condição de pagamento")).toBe(
      "Parcelado — entrada de R$ 2.250,00 e 3× de R$ 2.250,00 sem juros",
    );
  });

  it("K. proposta vencida é dita pelo veredito do servidor, não recalculada aqui", () => {
    const lista = abrir(
      projeto({
        quoteVersions: [
          quote({
            versionNumber: 1,
            status: "SENT",
            total: "9000",
            sentAt: "2026-09-01T12:00:00.000Z",
            validUntil: "2026-09-05T00:00:00.000Z",
            expired: true,
          }),
        ],
      }),
    );

    expect(valorDe(lista, "Último orçamento")).toContain("Vencida");
    expect(valorDe(lista, "Validade")).toBe("05/09/2026");
  });

  it("L. os rótulos são texto — a ficha não depende de cor nem de ícone", () => {
    const lista = abrir(projeto());

    for (const rotulo of [
      "Situação do projeto",
      "Último orçamento",
      "Valor da proposta",
      "Itens orçados",
      "Condição de pagamento",
      "Enviado em",
      "Validade",
      "Última atividade comercial",
    ]) {
      expect(temRotulo(lista, rotulo), rotulo).toBe(true);
    }
    expect(screen.getByRole("heading", { name: "Comercial" })).toBeInTheDocument();
  });
});
