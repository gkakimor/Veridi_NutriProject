import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { Outlet, Route, RouterProvider, createMemoryRouter, createRoutesFromElements } from "react-router-dom";
import type { AttachmentDTO, ProductDTO } from "@veridi/shared";

/**
 * Documentos no modal do Produto, em 390px (MOBILE-UX-CLEANUP-WAVE-01).
 *
 * A seção tem tabela de sete colunas que não quebram linha. O modal de
 * workspace põe o formulário numa grade de uma trilha, e a trilha implícita
 * (`auto`) crescia até o conteúdo mínimo dessa tabela: em 390px o formulário
 * ia a 576px num corpo de 357px, o modal rolava 203px de lado e TODA seção
 * ficava cortada à direita — medido no Chromium, e igual no Fornecedor (543px)
 * e no Item (363px). Em 1440 nada muda: 880px, ou a largura que a tabela pedir
 * enquanto couber (Fornecedor, 964px).
 *
 * jsdom não faz layout. Aqui fica a regra da coluna e a estrutura que põe a
 * rolagem no lugar honesto: a tabela de Documentos dentro do próprio
 * `.table-container`, dentro da grade do modal, sem largura em pixel no JSX.
 * A medida (`scrollWidth` do corpo igual ao `clientWidth`) é do smoke.
 */

vi.mock("../../lib/products-api", () => ({ createProduct: vi.fn(), updateProduct: vi.fn() }));
vi.mock("../../lib/customers-api", () => ({ listCustomers: vi.fn() }));
vi.mock("../../lib/units-api", () => ({ listUnits: vi.fn() }));
vi.mock("../../app/AuthProvider", () => ({ useAuth: vi.fn() }));
vi.mock("../../lib/attachments-api", () => ({
  listAttachments: vi.fn(),
  uploadAttachment: vi.fn(),
  archiveAttachment: vi.fn(),
  attachmentDownloadUrl: (id: string) => `/attachments/${id}/download`,
}));
vi.mock("./ProductIndustrialCostSummary", () => ({ ProductIndustrialCostSummary: () => null }));
vi.mock("./ProductDefaultRouteSection", () => ({ ProductDefaultRouteSection: () => null }));

import { listCustomers } from "../../lib/customers-api";
import { listUnits } from "../../lib/units-api";
import { listAttachments } from "../../lib/attachments-api";
import { useAuth } from "../../app/AuthProvider";
import { UnsavedChangesProvider } from "../../app/UnsavedChangesProvider";
import { ProductFormModal } from "./ProductFormModal";

const PRODUTO = {
  id: "prod-1758",
  code: "PROD-001758",
  name: "COLÁGENO HIDROLISADO VERISOL FRUTAS VERMELHAS GF 11g BLISS",
  externalCode: null,
  customerId: null,
  customerName: null,
  finishedProductItemId: "item-1",
  finishedProductItem: { id: "item-1", code: "PA-001758", name: "Colágeno Verisol", requiresCoa: false },
  dosageForm: null,
  presentationType: null,
  capsulesPerDose: null,
  doseAmount: null,
  doseUomCode: null,
  dosesPerPackage: null,
  unitsPerShippingBox: null,
  targetAgeGroup: null,
  shelfLifeMonths: 24,
  minimumBatchQuantity: null,
  notes: null,
  active: true,
  createdAt: "2026-08-01T12:00:00.000Z",
  updatedAt: "2026-08-01T12:00:00.000Z",
} as unknown as ProductDTO;

const ANEXO = {
  id: "anexo-1",
  documentType: "TECHNICAL_SHEET",
  productId: PRODUTO.id,
  originalFileName: "ficha-tecnica-colageno-hidrolisado-verisol-frutas-vermelhas-revisao-final.pdf",
  mimeType: "application/pdf",
  sizeBytes: 482_113,
  uploadedAt: "2026-09-10T15:00:00.000Z",
  uploadedByUserId: "u1",
  uploadedByName: "Administradora de Qualidade da Veridi",
  active: true,
  archivedByName: null,
} as unknown as AttachmentDTO;

function abrirModal() {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route
        element={
          <UnsavedChangesProvider>
            <Outlet />
          </UnsavedChangesProvider>
        }
      >
        <Route
          path="/cadastros/produtos"
          element={<ProductFormModal mode="edit" product={PRODUTO} onClose={() => undefined} onSaved={() => undefined} />}
        />
      </Route>,
    ),
    { initialEntries: ["/cadastros/produtos"] },
  );
  return render(<RouterProvider router={router} />);
}

const folha = () => readFileSync(join(process.cwd(), "src", "styles", "components.css"), "utf8");

function regra(css: string, seletor: string): string {
  const inicio = css.indexOf(`\n${seletor} {`);
  expect(inicio, `regra "${seletor}"`).toBeGreaterThanOrEqual(0);
  return css.slice(inicio, css.indexOf("}", inicio));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "u1", name: "Admin", email: "a@b.c", role: "ADMIN" },
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(listUnits).mockResolvedValue([{ code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" }] as never);
  vi.mocked(listCustomers).mockResolvedValue({ customers: [], page: 1, pageSize: 20, total: 0 } as never);
  vi.mocked(listAttachments).mockResolvedValue({ attachments: [ANEXO] } as never);
});

describe("Produto > Documentos no modal de workspace", () => {
  it("a tabela de Documentos rola dentro do próprio contêiner, dentro da coluna do modal", async () => {
    abrirModal();
    expect(await screen.findByText(ANEXO.originalFileName)).toBeInTheDocument();
    await waitFor(() => expect(listAttachments).toHaveBeenCalledWith("products", PRODUTO.id, false));

    const secao = screen.getByRole("heading", { name: "Documentos", level: 3 }).closest(".form-section") as HTMLElement;
    const tabela = within(secao).getByRole("table");
    expect(tabela.closest(".table-container")?.closest(".form-section")).toBe(secao);
    const coluna = secao.closest(".modal-fullscreen__form-wrap");
    expect(coluna).not.toBeNull();
    expect(coluna!.closest(".modal-fullscreen__body")).not.toBeNull();
    // Envio de documento: controles na barra que quebra linha, nenhum com largura fixa.
    expect(within(secao).getByLabelText("Tipo do documento").closest(".toolbar")).not.toBeNull();
    for (const elemento of secao.querySelectorAll<HTMLElement>("[style]")) {
      expect(elemento.getAttribute("style")).not.toMatch(/width:\s*\d+px/);
    }
  });

  it("nenhuma tabela do modal fica fora de um `.table-container` — a coluna não precisa crescer por elas", async () => {
    abrirModal();
    expect(await screen.findByText(ANEXO.originalFileName)).toBeInTheDocument();
    const tabelas = document.querySelectorAll(".modal-fullscreen__form-wrap table");
    expect(tabelas.length).toBeGreaterThan(0);
    for (const tabela of tabelas) expect(tabela.closest(".table-container")).not.toBeNull();
  });
});

describe("a regra da coluna do modal", () => {
  it("390px: a coluna nunca passa do corpo, e a trilha não passa da coluna", () => {
    const coluna = regra(folha(), ".modal-fullscreen__form-wrap");
    expect(coluna).toMatch(/\n\s*max-width: 100%;/);
    expect(coluna).toMatch(/\n\s*min-width: min\(880px, 100%\);/);
    // Máximo em porcentagem = função de tamanho fixa: prende o mínimo automático
    // do item à coluna. Com a trilha `auto` de antes, a tabela empurrava a trilha.
    expect(coluna).toMatch(/\n\s*grid-template-columns: minmax\(auto, 100%\);/);
    expect(coluna).not.toMatch(/\n\s*max-width: 880px;/);
  });

  it("1440: continua a coluna de 880px, mais larga só pelo conteúdo mínimo", () => {
    const coluna = regra(folha(), ".modal-fullscreen__form-wrap");
    expect(coluna).toMatch(/\n\s*width: min-content;/);
    expect(coluna).toMatch(/\n\s*margin: 0 auto;/);
  });

  it("a tabela rola por dentro e a barra de envio ocupa a linha em tela estreita", () => {
    const css = folha();
    expect(regra(css, ".table-container")).toMatch(/\n\s*overflow-x: auto;/);
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.toolbar select \{\s*width: 100%;/);
  });
});
