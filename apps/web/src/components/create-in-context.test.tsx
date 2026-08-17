import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SearchableEntitySelect } from "./SearchableEntitySelect";
import { ApprovalPreviewDialog } from "../pages/projects/ApprovalPreviewDialog";
import type { ProjectDTO } from "@veridi/shared";

/**
 * Criação no contexto e prévia da aprovação.
 *
 * As duas nascem do mesmo princípio: o sistema já sabe alguma coisa e não
 * pode obrigar a pessoa a descobrir sozinha — nem abandonar o formulário para
 * cadastrar o que falta, nem aprovar um projeto sem ver o que fica de fora.
 */

const OPTIONS = [
  { id: "cli-1", code: "CLI-000001", name: "Vida Saudável" },
  { id: "cli-2", code: "CLI-000002", name: "Bem Estar" },
];

describe("Criação no contexto", () => {
  it("oferece cadastrar quando a busca não encontra nada", () => {
    const onCreateNew = vi.fn();
    render(
      <SearchableEntitySelect
        id="cliente"
        value=""
        onChange={() => {}}
        options={OPTIONS}
        canCreate
        createLabel="Cadastrar novo cliente"
        onCreateNew={onCreateNew}
      />,
    );

    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Nova Nutrição" } });

    const create = screen.getByRole("button", { name: /Cadastrar novo cliente/ });
    // O texto digitado vai junto: quem procurou já disse o nome.
    expect(create.textContent).toContain("Nova Nutrição");

    fireEvent.mouseDown(create);
    expect(onCreateNew).toHaveBeenCalledWith("Nova Nutrição");
  });

  it("não oferece cadastrar quando o papel não permite", () => {
    // CTA que termina em 403 é pior que CTA nenhum.
    render(
      <SearchableEntitySelect id="cliente" value="" onChange={() => {}} options={OPTIONS} />,
    );

    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.queryByRole("button", { name: /Cadastrar/ })).toBeNull();
  });

  it("continua listando resultados junto da opção de cadastrar", () => {
    render(
      <SearchableEntitySelect
        id="cliente"
        value=""
        onChange={() => {}}
        options={OPTIONS}
        canCreate
        createLabel="Cadastrar novo cliente"
        onCreateNew={() => {}}
      />,
    );

    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Cadastrar novo cliente/ })).toBeTruthy();
  });
});

function buildProject(overrides: Partial<ProjectDTO> = {}): ProjectDTO {
  return {
    id: "prj-1",
    code: "PROJ-000001",
    externalCode: null,
    customerId: "cli-1",
    customerCode: "CLI-000001",
    customerName: "Vida Saudável",
    name: "Linha Performance",
    concept: null,
    channel: null,
    status: "SAMPLE",
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
    productName: null,
    costing: null,
    products: [],
    latestQuoteLabel: null,
    latestQuoteStatus: null,
    acceptedQuoteLabel: null,
    quoteVersions: [],
    statusHistory: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByName: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as ProjectDTO;
}

function projectProduct(id: string, code: string, name: string, status = "ACTIVE") {
  return {
    id,
    projectId: "prj-1",
    productId: `prod-${id}`,
    productCode: code,
    productName: name,
    productLifecycle: "DEVELOPMENT",
    productActive: true,
    sequence: 1,
    status,
    costing: null,
    latestSampleCode: null,
    latestSampleLabel: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdByName: null,
  } as ProjectDTO["products"][number];
}

describe("Prévia da aprovação", () => {
  it("mostra o que será aprovado e o que fica fora do escopo", () => {
    // Três sabores desenvolvidos, dois vendidos: quem aprova precisa ver a
    // divisão antes, não descobrir que o terceiro não entra em pedido.
    const project = buildProject({
      products: [
        projectProduct("pp-a", "PROD-000001", "Sabor A"),
        projectProduct("pp-b", "PROD-000002", "Sabor B"),
        projectProduct("pp-c", "PROD-000003", "Sabor C"),
      ],
      quoteVersions: [
        {
          id: "q1",
          code: "ORC-000001",
          projectId: "prj-1",
          versionNumber: 1,
          versionLabel: "ORC-000001 · V1",
          externalCode: null,
          status: "ACCEPTED",
          source: "MANUAL",
          quoteDate: "2026-01-02T00:00:00.000Z",
          validUntil: null,
          currencyCode: "BRL",
          lines: [
            { productId: "prod-pp-a" },
            { productId: "prod-pp-b" },
          ],
          total: "100.00",
        },
      ] as unknown as ProjectDTO["quoteVersions"],
    });

    render(
      <MemoryRouter>
        <ApprovalPreviewDialog project={project} onCancel={() => {}} onConfirm={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/contém 2 de 3/)).toBeTruthy();
    expect(screen.getByText("Sabor A")).toBeTruthy();
    expect(screen.getByText("Sabor B")).toBeTruthy();
    expect(screen.getByText(/Ficarão fora do escopo comercial/)).toBeTruthy();
    expect(screen.getByText("Sabor C")).toBeTruthy();
  });

  it("sem proposta aceita, explica o que falta em vez de deixar aprovar às cegas", () => {
    render(
      <MemoryRouter>
        <ApprovalPreviewDialog project={buildProject()} onCancel={() => {}} onConfirm={() => {}} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/ainda não tem uma proposta aceita/)).toBeTruthy();
  });
});
