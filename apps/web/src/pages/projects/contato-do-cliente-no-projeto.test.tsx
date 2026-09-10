import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ProjectDTO } from "@veridi/shared";

/**
 * O telefone do Cliente no Resumo do Projeto — PROJECT-CUSTOMER-CONTACT-01.
 *
 * A Veridi relatou o percurso: trabalhando dentro de um Projeto, para ligar
 * (ou mandar mensagem) era preciso sair da tela e abrir o cadastro do
 * Cliente. O link para o Cliente já existia; o que faltava era o número
 * estar visível onde a pessoa já está.
 *
 * O que estes casos protegem é o que se LÊ: o nome do cliente, o telefone com
 * a máscara brasileira, o e-mail, o link que já existia — e, quando o cadastro
 * não tem o dado, um rótulo presente com "—". Esconder a linha vazia diria
 * "este sistema não tem telefone de cliente", que é outra coisa.
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
  applyQuotePricing: vi.fn(),
  createOrderFromQuote: vi.fn(),
  createQuoteVersion: vi.fn(),
  getQuotePricingOptions: vi.fn(() => Promise.resolve(null)),
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

import { getProject } from "../../lib/projects-api";
import { ProjectDetailPage } from "./ProjectDetailPage";

const BASE: ProjectDTO = {
  id: "prj-1",
  code: "PROJ-000001",
  externalCode: null,
  customerId: "cli-1",
  customerCode: "CLI-000001",
  customerName: "G S TEZOTTO",
  customerPhone: "15999998888",
  customerEmail: "contato@empresa.com.br",
  name: "Multivitamínico Detox",
  concept: "Detox",
  channel: "Distribuidora",
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

beforeEach(() => {
  vi.clearAllMocks();
});

/** Abre a ficha do projeto e devolve a lista de definições do Resumo. */
async function abrirResumo(projeto: Partial<ProjectDTO> = {}) {
  vi.mocked(getProject).mockResolvedValue({ ...BASE, ...projeto } as never);
  render(
    <MemoryRouter initialEntries={["/comercial/projetos/prj-1"]}>
      <Routes>
        <Route path="/comercial/projetos/:id" element={<ProjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(getProject).toHaveBeenCalled());
  const rotulo = await screen.findByText("Telefone");
  // O `<dl>` do Resumo — pares rótulo/valor, na ordem em que a pessoa lê.
  return rotulo.closest("dl") as HTMLElement;
}

/** O valor que vem logo depois do rótulo, no `<dl>`. */
function valorDe(lista: HTMLElement, rotulo: string): string {
  const dt = within(lista).getByText(rotulo);
  return (dt.nextElementSibling as HTMLElement).textContent?.trim() ?? "";
}

describe("Resumo do Projeto — contato do Cliente", () => {
  it("mostra nome, telefone com máscara e e-mail do cliente", async () => {
    const resumo = await abrirResumo();

    expect(valorDe(resumo, "Cliente")).toContain("G S TEZOTTO");
    expect(valorDe(resumo, "Telefone")).toBe("(15) 99999-8888");
    expect(valorDe(resumo, "E-mail")).toBe("contato@empresa.com.br");
  });

  it("o link para o Cliente continua sendo o mesmo, e é um só", async () => {
    const resumo = await abrirResumo();

    const links = within(resumo).getAllByRole("link", { name: /G S TEZOTTO/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/cadastros/clientes?ids=cli-1&open=cli-1");
    // Nenhum segundo botão "ver cliente" nasceu ao lado do contato.
    expect(within(resumo).queryByRole("link", { name: /ver cliente/i })).toBeNull();
  });

  it('telefone não preenchido mostra "—" com o rótulo à vista', async () => {
    const resumo = await abrirResumo({ customerPhone: null });

    expect(within(resumo).getByText("Telefone")).toBeInTheDocument();
    expect(valorDe(resumo, "Telefone")).toBe("—");
    // O e-mail informado continua aparecendo: um campo vazio não some com o outro.
    expect(valorDe(resumo, "E-mail")).toBe("contato@empresa.com.br");
  });

  it('e-mail não preenchido mostra "—" com o rótulo à vista', async () => {
    const resumo = await abrirResumo({ customerEmail: null });

    expect(within(resumo).getByText("E-mail")).toBeInTheDocument();
    expect(valorDe(resumo, "E-mail")).toBe("—");
    expect(valorDe(resumo, "Telefone")).toBe("(15) 99999-8888");
  });

  it("cliente sem contato nenhum não quebra a ficha", async () => {
    const resumo = await abrirResumo({ customerPhone: null, customerEmail: null });

    expect(valorDe(resumo, "Telefone")).toBe("—");
    expect(valorDe(resumo, "E-mail")).toBe("—");
    expect(valorDe(resumo, "Cliente")).toContain("G S TEZOTTO");
  });

  it("telefone e e-mail ficam junto do Cliente, não numa seção distante", async () => {
    const resumo = await abrirResumo();

    // A ordem é a leitura: quem é o cliente, e como se fala com ele.
    const rotulos = [...resumo.querySelectorAll("dt")].map((dt) => dt.textContent?.trim());
    expect(rotulos.slice(0, 3)).toEqual(["Cliente", "Telefone", "E-mail"]);
  });
});
