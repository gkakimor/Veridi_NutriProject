import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Link,
  Outlet,
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
} from "react-router-dom";
import type { ProjectDTO, QuoteVersionDTO } from "@veridi/shared";

/**
 * UNSAVED-CHANGES-FOUNDATION-01 nas condições comerciais do Orçamento.
 *
 * A pendência aqui já existia e já tem dono: `condicoesAlteradas` compara o
 * que está nos campos com o que está gravado, e é ela que desenha
 * "Alterações não salvas" e prende o envio da proposta. A guarda de saída
 * consome a MESMA resposta — uma segunda comparação divergiria da primeira no
 * dia em que uma condição fosse acrescentada.
 *
 * As LINHAS da proposta ficam de fora de propósito: elas gravam ao sair do
 * campo, então não há edição pendente ali para perder na saída, e nada no
 * comportamento delas muda por causa desta capability.
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
vi.mock("../../lib/customers-api", () => ({
  listCustomers: () => Promise.resolve({ customers: [] }),
}));
vi.mock("../../lib/samples-api", () => ({
  listSamples: vi.fn(() => Promise.resolve({ samples: [], total: 0 })),
  createSample: vi.fn(),
}));

import { QuoteVersionsSection } from "./QuoteVersionsSection";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";

function versao(): QuoteVersionDTO {
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
  } as QuoteVersionDTO;
}

const PROJETO = {
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
} as ProjectDTO;

function Raiz() {
  return (
    <UnsavedChangesProvider>
      <nav id="sidebar">
        <Link to="/comercial/pedidos">Pedidos</Link>
      </nav>
      <Outlet />
    </UnsavedChangesProvider>
  );
}

function abrir() {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Raiz />}>
        <Route
          path="/comercial/projetos/:id"
          element={
            <QuoteVersionsSection
              project={{ ...PROJETO, quoteVersions: [versao()] }}
              canEdit
              projectStatus="WAITING"
              onChanged={() => {}}
            />
          }
        />
        <Route path="/comercial/pedidos" element={<h1>Pedidos</h1>} />
      </Route>,
    ),
    { initialEntries: ["/comercial/projetos/prj-1"] },
  );
  render(<RouterProvider router={router} />);
}

const pergunta = () => screen.queryByRole("alertdialog");
const menuPedidos = () => screen.getByRole("link", { name: "Pedidos" });
const desconto = () => document.getElementById("quote-discount") as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Orçamento — guarda de alterações não salvas", () => {
  it("proposta aberta sem condição alterada sai sem perguntar", async () => {
    const user = userEvent.setup();
    abrir();

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });

  it("condição alterada e não salva pergunta antes de sair", async () => {
    const user = userEvent.setup();
    abrir();

    fireEvent.change(desconto(), { target: { value: "5" } });
    // A mesma pendência que a própria tela anuncia.
    expect(screen.getByText(/Alterações não salvas/i)).toBeInTheDocument();

    await user.click(menuPedidos());

    expect(await screen.findByText("Sair sem salvar?")).toBeInTheDocument();
    expect(screen.getByText(/alterações não salvas neste orçamento/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pedidos" })).toBeNull();
  });

  it("desfeita a alteração, a saída volta a ser livre", async () => {
    const user = userEvent.setup();
    abrir();

    fireEvent.change(desconto(), { target: { value: "5" } });
    fireEvent.change(desconto(), { target: { value: "" } });

    await user.click(menuPedidos());

    expect(await screen.findByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    expect(pergunta()).toBeNull();
  });
});
