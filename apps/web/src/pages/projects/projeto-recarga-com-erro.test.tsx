import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ProjectDTO } from "@veridi/shared";

/**
 * EDITING-INTEGRITY-WAVE-01 — leitura do Projeto que falha sem ser 404.
 *
 * Todo erro de `getProject` virava "Projeto não encontrado": uma queda de rede
 * ou um 500 na releitura depois de uma ação desmontava a ficha inteira, como se
 * o Projeto não existisse. Só o 404 diz que não existe; o resto mantém a ficha
 * que já estava na tela, avisa e oferece tentar de novo.
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

import { changeProjectStatus, getProject } from "../../lib/projects-api";
import { NotFoundApiError } from "../../lib/api-errors";
import { ProjectDetailPage } from "./ProjectDetailPage";

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

function montar() {
  render(
    <MemoryRouter initialEntries={["/comercial/projetos/prj-1"]}>
      <Routes>
        <Route path="/comercial/projetos/:id" element={<ProjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const ficha = () => screen.queryByRole("heading", { name: "PROJ-000001 · Multivitamínico Detox" });
const naoEncontrado = () => screen.queryByRole("heading", { name: "Projeto não encontrado" });
const AVISO = "Não foi possível carregar o projeto agora.";

/** As duas falhas que não dizem nada sobre existir: servidor e rede. */
const FALHAS_TRANSITORIAS: [string, () => Error][] = [
  ["500", () => new Error("Erro interno do servidor (500). Tente novamente ou avise o suporte.")],
  ["rede", () => new TypeError("Failed to fetch")],
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Projeto — 404 é não encontrado; o resto não é", () => {
  it("404 real: Projeto não encontrado, sem aviso de recarga", async () => {
    vi.mocked(getProject).mockRejectedValue(new NotFoundApiError("Registro não encontrado."));
    montar();

    expect(await screen.findByRole("heading", { name: "Projeto não encontrado" })).toBeInTheDocument();
    expect(screen.queryByText(AVISO, { exact: false })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).toBeNull();
  });

  it.each(FALHAS_TRANSITORIAS)(
    "primeira leitura com falha de %s: não diz que não existe, avisa e tenta de novo",
    async (_nome, falha) => {
      vi.mocked(getProject).mockRejectedValueOnce(falha());
      montar();

      expect(await screen.findByRole("alert")).toHaveTextContent(AVISO);
      expect(naoEncontrado()).toBeNull();

      vi.mocked(getProject).mockResolvedValue(PROJETO as never);
      fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

      await waitFor(() => expect(ficha()).toBeInTheDocument());
      expect(screen.queryByText(AVISO, { exact: false })).toBeNull();
      expect(getProject).toHaveBeenCalledTimes(2);
    },
  );

  it.each(FALHAS_TRANSITORIAS)(
    "releitura depois de uma ação falha por %s: a ficha fica, com o aviso, e tentar de novo limpa",
    async (_nome, falha) => {
      vi.mocked(getProject).mockResolvedValue(PROJETO as never);
      vi.mocked(changeProjectStatus).mockResolvedValue(undefined as never);
      montar();
      await screen.findByRole("button", { name: "Aprovar projeto" });

      vi.mocked(getProject).mockRejectedValueOnce(falha());
      fireEvent.click(screen.getByRole("button", { name: "Stand-by" }));

      const aviso = await screen.findByRole("alert");
      expect(aviso).toHaveTextContent(AVISO);
      expect(aviso).toHaveTextContent("A ficha abaixo pode estar desatualizada.");
      expect(naoEncontrado()).toBeNull();
      expect(ficha()).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Aprovar projeto" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
      await waitFor(() => expect(screen.queryByText(AVISO, { exact: false })).toBeNull());
      expect(ficha()).toBeInTheDocument();
      expect(getProject).toHaveBeenCalledTimes(3);
    },
  );

  it("404 na releitura continua sendo não encontrado", async () => {
    vi.mocked(getProject).mockResolvedValue(PROJETO as never);
    vi.mocked(changeProjectStatus).mockResolvedValue(undefined as never);
    montar();
    await screen.findByRole("button", { name: "Aprovar projeto" });

    vi.mocked(getProject).mockRejectedValueOnce(new NotFoundApiError("Registro não encontrado."));
    fireEvent.click(screen.getByRole("button", { name: "Stand-by" }));

    expect(await screen.findByRole("heading", { name: "Projeto não encontrado" })).toBeInTheDocument();
  });
});
