import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ProjectDTO, ProjectProductDTO, QuoteVersionDTO } from "@veridi/shared";
import { ProjectProductsSection } from "./ProjectProductsSection";
import { QuoteVersionsSection } from "./QuoteVersionsSection";

/**
 * Experiência multiproduto na tela.
 *
 * O que estes testes protegem é o que a pessoa lê: que o projeto tem vários
 * produtos, que a versão aberta é a que ela escolheu, e que uma proposta com
 * linha sem preço não mostra um total que não existe.
 */

vi.mock("../../lib/products-api", () => ({ listProducts: () => Promise.resolve({ products: [] }) }));
vi.mock("../../lib/projects-api", () => ({
  createProjectProduct: vi.fn(),
  linkProjectProduct: vi.fn(),
  acceptQuoteVersion: vi.fn(),
  addQuoteLine: vi.fn(),
  applyQuotePricing: vi.fn(),
  createQuoteVersion: vi.fn(),
  getQuotePricingOptions: vi.fn(),
  rejectQuoteVersion: vi.fn(),
  removeQuoteLine: vi.fn(),
  sendQuoteVersion: vi.fn(),
  updateQuoteLine: vi.fn(),
  updateQuoteVersion: vi.fn(),
  useManualQuotePrice: vi.fn(),
}));

function product(
  id: string,
  code: string,
  name: string,
  status: ProjectProductDTO["status"] = "ACTIVE",
): ProjectProductDTO {
  return {
    id,
    projectId: "prj-1",
    productId: `prod-${id}`,
    productCode: code,
    productName: name,
    productLifecycle: status === "APPROVED" ? "APPROVED" : "DEVELOPMENT",
    productActive: true,
    sequence: 1,
    status,
    costing: null,
    latestSampleCode: null,
    latestSampleLabel: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByName: null,
  };
}

function line(id: string, code: string, name: string, price: string | null, total: string | null) {
  return {
    id,
    quoteVersionId: "q1",
    projectProductId: null,
    productId: `prod-${id}`,
    productCode: code,
    productName: name,
    sortOrder: 1,
    quotedQuantity: "1000",
    uomCode: "un",
    unitPrice: price,
    total,
    priceSource: "MANUAL" as const,
    pricing: null,
  };
}

function quote(overrides: Partial<QuoteVersionDTO>): QuoteVersionDTO {
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
    lines: [],
    total: null,
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

function project(overrides: Partial<ProjectDTO> = {}): ProjectDTO {
  return {
    id: "prj-1",
    code: "PROJ-000001",
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "NutriViva",
    name: "Linha Performance",
    status: "SAMPLE",
    products: [],
    quoteVersions: [],
    statusHistory: [],
    ...overrides,
  } as unknown as ProjectDTO;
}

describe("Produtos do projeto", () => {
  it("lista os três produtos com nomes distintos", () => {
    render(
      <MemoryRouter>
        <ProjectProductsSection
          projectId="prj-1"
          customerId="cli-1"
          products={[
            product("pp-a", "PROD-000001", "Pré-Treino Frutas Vermelhas"),
            product("pp-b", "PROD-000002", "Pré-Treino Limão"),
            product("pp-c", "PROD-000003", "Pré-Treino Laranja"),
          ]}
          editable
          onChanged={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /Frutas Vermelhas/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Limão/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Laranja/ })).toBeTruthy();
    // A tela fala de produtos do projeto — nada de nome de entidade técnica.
    expect(screen.queryByText(/ProjectProduct/)).toBeNull();
  });

  it("explica o produto fora do escopo em vez de parecer erro", () => {
    render(
      <MemoryRouter>
        <ProjectProductsSection
          projectId="prj-1"
          customerId="cli-1"
          products={[product("pp-c", "PROD-000003", "Pré-Treino Laranja", "OUT_OF_SCOPE")]}
          editable={false}
          onChanged={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Fora do escopo")).toBeTruthy();
    expect(screen.getByText(/Não fez parte da proposta aceita/)).toBeTruthy();
    // Projeto fechado não recebe produto novo.
    expect(screen.queryByRole("button", { name: /Adicionar produto/ })).toBeNull();
  });

  it("projeto aprovado explica por que não há como adicionar produto", () => {
    render(
      <MemoryRouter>
        <ProjectProductsSection
          projectId="prj-1"
          customerId="cli-1"
          products={[product("pp-a", "PROD-000001", "Pré-Treino Frutas Vermelhas", "APPROVED")]}
          editable={false}
          projectStatus="APPROVED"
          onChanged={() => {}}
        />
      </MemoryRouter>,
    );

    // Sem o texto, a ação simplesmente some e o usuário conclui que a tela
    // quebrou — foi o que acontecia quando o botão aparecia e o backend
    // recusava com 409 depois de o nome já ter sido digitado.
    expect(screen.queryByRole("button", { name: /Adicionar produto/ })).toBeNull();
    expect(screen.getByText(/Projeto aprovado é histórico/)).toBeTruthy();
  });
});

describe("Histórico de orçamentos", () => {
  const v1 = quote({
    id: "q1",
    status: "SENT",
    versionLabel: "ORC-000001 · V1",
    lines: [line("l1", "PROD-000001", "Frutas Vermelhas", "10.0000", "10000.00")] as never,
    total: "10000.00",
  });
  const v2 = quote({
    id: "q2",
    status: "DRAFT",
    versionNumber: 2,
    versionLabel: "ORC-000001 · V2",
    lines: [line("l2", "PROD-000002", "Limão", "20.0000", "20000.00")] as never,
    total: "20000.00",
  });

  it("abre exatamente a versão escolhida", () => {
    render(
      <MemoryRouter>
        <QuoteVersionsSection
          project={project({ quoteVersions: [v1, v2] })}
          canEdit
          onChanged={() => {}}
        />
      </MemoryRouter>,
    );

    // Abre no rascunho por padrão — é onde o trabalho está.
    const workspace = document.querySelector(".quote-workspace") as HTMLElement;
    expect(within(workspace).getByText(/V2/)).toBeTruthy();

    // Clicar na V1 abre a V1, não a última.
    fireEvent.click(screen.getAllByText("ORC-000001 · V1")[0]!);
    const reopened = document.querySelector(".quote-workspace") as HTMLElement;
    expect(within(reopened).getByRole("link", { name: /Frutas Vermelhas/ })).toBeTruthy();
  });

  it("versão enviada é somente leitura", () => {
    render(
      <MemoryRouter>
        <QuoteVersionsSection project={project({ quoteVersions: [v1] })} canEdit onChanged={() => {}} />
      </MemoryRouter>,
    );

    const workspace = document.querySelector(".quote-workspace") as HTMLElement;
    // Nenhum campo editável na proposta apresentada.
    expect(within(workspace).queryByLabelText(/^Preço unitário de/)).toBeNull();
    expect(within(workspace).queryByLabelText(/^Quantidade de/)).toBeNull();
    expect(within(workspace).queryByRole("button", { name: "Remover" })).toBeNull();
    expect(within(workspace).getByText(/Proposta apresentada é histórico/)).toBeTruthy();
    // O que resta é decisão comercial.
    expect(within(workspace).getByRole("button", { name: "Registrar aceite" })).toBeTruthy();
  });

  it("a versão aberta continua sendo a escolhida quando a lista recarrega", () => {
    // Regressão real: ao criar a V2, o id novo era selecionado, a lista ainda
    // era a antiga por um render, e a tela voltava para a V1 enviada —
    // parecendo que a nova versão nascia bloqueada.
    const { rerender } = render(
      <MemoryRouter>
        <QuoteVersionsSection project={project({ quoteVersions: [v1] })} canEdit onChanged={() => {}} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByText("ORC-000001 · V1")[0]!);

    rerender(
      <MemoryRouter>
        <QuoteVersionsSection
          project={project({ quoteVersions: [v1, v2] })}
          canEdit
          onChanged={() => {}}
        />
      </MemoryRouter>,
    );

    const workspace = document.querySelector(".quote-workspace") as HTMLElement;
    expect(within(workspace).getByText(/V1/)).toBeTruthy();
  });

  it("linha sem preço não vira total parcial", () => {
    const incomplete = quote({
      id: "q3",
      status: "DRAFT",
      lines: [
        line("l1", "PROD-000001", "Frutas Vermelhas", "10.0000", "10000.00"),
        line("l2", "PROD-000002", "Limão", null, null),
      ] as never,
      total: null,
    });

    render(
      <MemoryRouter>
        <QuoteVersionsSection
          project={project({ quoteVersions: [incomplete] })}
          canEdit
          onChanged={() => {}}
        />
      </MemoryRouter>,
    );

    const footer = document.querySelector(".table--quote-lines tfoot") as HTMLElement;
    expect(footer.textContent).toContain("Total da proposta");
    expect(footer.textContent).toContain("—");
    expect(footer.textContent).toContain("Existem produtos sem preço definido.");
    // Somar só o que tem preço mostraria 10.000 com cara de total.
    expect(footer.textContent).not.toContain("10.000");
  });
});
