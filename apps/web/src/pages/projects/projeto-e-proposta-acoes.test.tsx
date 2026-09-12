import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ProjectDTO, QuoteVersionDTO } from "@veridi/shared";

/**
 * UX-ACTIONS-FEEDBACK-WAVE-02 — Projeto e Proposta.
 *
 * O Resumo do Projeto tinha quatro ações coladas e com o mesmo espaçamento:
 * trocar a etapa parecia tão definitivo quanto aprovar. As condições da
 * proposta punham "Simular" (que não grava) encostado em "Salvar condições",
 * e o botão de salvar não dizia que estava salvando. Nenhum workflow mudou:
 * aprovar e cancelar continuam com o diálogo deles.
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

import { cancelProject, changeProjectStatus, getProject } from "../../lib/projects-api";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { QuoteConditionsForm } from "./QuoteConditionsForm";

const PROJETO = {
  id: "prj-1",
  code: "PROJ-000001",
  externalCode: null,
  customerId: "cli-1",
  customerCode: "CLI-000001",
  customerName: "G S TEZOTTO",
  customerPhone: null,
  customerEmail: null,
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
} as unknown as ProjectDTO;

async function abrirProjeto() {
  vi.mocked(getProject).mockResolvedValue(PROJETO as never);
  render(
    <MemoryRouter initialEntries={["/comercial/projetos/prj-1"]}>
      <Routes>
        <Route path="/comercial/projetos/:id" element={<ProjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("button", { name: "Aprovar projeto" });
}

function proposta(overrides: Partial<QuoteVersionDTO> = {}): QuoteVersionDTO {
  return {
    id: "q1",
    code: "ORC-000001",
    projectId: "prj-1",
    versionNumber: 1,
    versionLabel: "ORC-000001 · V1",
    status: "DRAFT",
    validUntil: "2026-09-15T00:00:00.000Z",
    expired: false,
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
    commercialNotes: null,
    leadTimeDays: null,
    ...overrides,
  } as QuoteVersionDTO;
}

const botao = (nome: string | RegExp) => screen.getByRole("button", { name: nome });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Resumo do Projeto — quatro ações, dois assuntos", () => {
  it("etapa de um lado; aprovar e cancelar do outro, cada um com o seu peso", async () => {
    await abrirProjeto();

    const barra = botao("Aprovar projeto").closest(".form-actions") as HTMLElement;
    expect(barra).toHaveClass("form-actions--split");
    const [etapa, decisao] = Array.from(barra.querySelectorAll(".form-actions__group"));
    expect(etapa).toContainElement(botao("Mudar para Amostra"));
    expect(etapa).toContainElement(botao("Stand-by"));
    expect(decisao).toContainElement(botao("Aprovar projeto"));
    expect(decisao).toContainElement(botao("Cancelar projeto"));

    // Nunca quatro pesos iguais: rotina, decisão principal e destrutiva.
    expect(botao("Mudar para Amostra")).toHaveClass("btn--secondary");
    expect(botao("Stand-by")).toHaveClass("btn--secondary");
    expect(botao("Aprovar projeto")).toHaveClass("btn--accent");
    expect(botao("Cancelar projeto")).toHaveClass("btn--danger");

    // A ordem de leitura — e de tabulação — é a de antes.
    const ordem = Array.from(barra.querySelectorAll("button")).map((b) => b.textContent);
    expect(ordem).toEqual(["Mudar para Amostra", "Stand-by", "Aprovar projeto", "Cancelar projeto"]);
  });

  it("cancelar continua perguntando antes — o layout não virou atalho", async () => {
    await abrirProjeto();

    fireEvent.click(botao("Cancelar projeto"));

    expect(await screen.findByText("Cancelar o projeto?")).toBeInTheDocument();
    expect(cancelProject).not.toHaveBeenCalled();
    expect(changeProjectStatus).not.toHaveBeenCalled();
  });
});

describe("Condições da proposta — simular não encosta em quem grava", () => {
  it("Simular num grupo; salvar, descartar e a situação no outro", () => {
    render(
      <QuoteConditionsForm quote={proposta()} editable saving={false} onSave={() => undefined} />,
    );
    fireEvent.change(screen.getByLabelText("Desconto (%)"), { target: { value: "5" } });

    const barra = botao("Salvar condições").closest(".form-actions") as HTMLElement;
    expect(barra).toHaveClass("form-actions--split");
    expect(botao("Simular").closest(".form-actions__group")).not.toBe(
      botao("Salvar condições").closest(".form-actions__group"),
    );
    const grupoDeGravar = botao("Salvar condições").closest(".form-actions__group") as HTMLElement;
    expect(grupoDeGravar).toContainElement(botao("Descartar alterações"));
    expect(grupoDeGravar).toContainElement(screen.getByText("Alterações não salvas"));
  });

  it("com a gravação no ar o botão diz Salvando…, recusa o segundo clique, e volta ao fim", async () => {
    let concluir: () => void = () => {};
    const onSave = vi.fn(() => new Promise<void>((resolve) => (concluir = resolve)));
    render(<QuoteConditionsForm quote={proposta()} editable saving={false} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Desconto (%)"), { target: { value: "5" } });

    fireEvent.click(botao("Salvar condições"));

    const emCurso = await screen.findByRole("button", { name: "Salvando…" });
    expect(emCurso).toBeDisabled();
    fireEvent.click(emCurso);
    expect(onSave).toHaveBeenCalledTimes(1);
    // Enquanto o servidor não respondeu, a situação continua sendo a pendência.
    expect(screen.getByText("Alterações não salvas")).toBeInTheDocument();

    concluir();
    await waitFor(() => expect(botao("Salvar condições")).toBeInTheDocument());
  });
});
