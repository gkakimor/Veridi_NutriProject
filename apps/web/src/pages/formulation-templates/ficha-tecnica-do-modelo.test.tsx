import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  Route,
  RouterProvider,
  createMemoryRouter,
  createRoutesFromElements,
  useParams,
} from "react-router-dom";
import type { FormulationTemplateDTO, FormulationTemplateVersionDTO } from "@veridi/shared";
import {
  UNIDADES,
  modeloCapsula,
  modeloPo,
} from "../../pdf/testing/technical-sheet-template-fixtures";

/**
 * FORMULATION-TEMPLATE-TECHNICAL-SHEET-PDF-01 — a porta e a rota.
 *
 * O documento é provado em `pdf/documents/technical-sheet-template-*.test.tsx`.
 * Aqui: a ação "Ficha técnica (PDF)" no cabeçalho do Modelo leva à ficha da
 * versão que a bancada mostra; o histórico leva à ficha de CADA versão —
 * inclusive a arquivada —; quem só consulta também gera; e a tela do documento
 * monta a ficha do MODELO certo, com o nome de arquivo dele.
 */

const getFormulationTemplate = vi.fn();
vi.mock("../../lib/formulation-templates-api", () => ({
  listFormulationTemplates: vi.fn(),
  getFormulationTemplate: (...a: unknown[]) => getFormulationTemplate(...a),
  createFormulationTemplate: vi.fn(),
  activateFormulationTemplateVersion: vi.fn(),
  createTemplateVersionFrom: vi.fn(),
  updateFormulationTemplateVersion: vi.fn(),
  updateFormulationTemplate: vi.fn(),
  setFormulationTemplateArchived: vi.fn(),
  compareTemplateVersions: vi.fn(),
}));
vi.mock("../../lib/items-api", () => ({
  listItems: () => Promise.resolve({ items: [] }),
  getItem: vi.fn(),
}));
vi.mock("../../lib/units-api", () => ({ listUnits: () => Promise.resolve(UNIDADES) }));

const papel = { role: "ADMIN" };
vi.mock("../../app/AuthProvider", () => ({ useOptionalAuth: () => null,
  useAuth: () => ({ user: { id: "u1", name: "Pessoa", role: papel.role } }),
}));

const renderPdfBlob = vi.fn();
vi.mock("../../pdf/render", () => ({
  renderPdfBlob: (...args: unknown[]) => renderPdfBlob(...args),
  downloadPdf: vi.fn(),
}));
vi.mock("@react-pdf/renderer", async () => ({
  ...(await import("../../pdf/testing/react-pdf-dom")),
}));

import { FormulationTemplateDetailPage } from "./FormulationTemplateDetailPage";
import { FormulationTemplateTechnicalSheetPrintPage } from "../print/FormulationTemplateTechnicalSheetPrintPage";

const ARQUIVADA_V1 = modeloPo({
  id: "ftv-1",
  formulationTemplateId: "ft-7",
  templateCode: "FT-000007",
  templateName: "Base proteica — pó 900 g",
  versionNumber: 1,
  versionLabel: "V1",
  status: "ARCHIVED",
  archivedAt: "2026-09-10T14:00:00.000Z",
  sourceVersionId: null,
  sourceVersionNumber: null,
});

function versao(overrides: Partial<FormulationTemplateVersionDTO>): FormulationTemplateVersionDTO {
  return modeloCapsula({
    formulationTemplateId: "ft-7",
    templateCode: "FT-000007",
    templateName: "Base proteica — pó 900 g",
    ...overrides,
  });
}

function modelo(versions: FormulationTemplateVersionDTO[], archived = false): FormulationTemplateDTO {
  return {
    id: "ft-7",
    code: "FT-000007",
    name: "Base proteica — pó 900 g",
    description: null,
    archived,
    archivedAt: archived ? "2026-09-12T12:00:00.000Z" : null,
    activeVersion: versions.find((version) => version.status === "ACTIVE") ?? null,
    draftVersion: versions.find((version) => version.status === "DRAFT") ?? null,
    versions,
    createdAt: "2026-08-01T12:00:00.000Z",
    createdBy: "Qualidade",
    updatedAt: "2026-09-12T12:00:00.000Z",
  };
}

/** V1 arquivada, V2 ativa e V3 em rascunho — as três situações numa tela. */
const TRES_VERSOES = modelo([
  ARQUIVADA_V1,
  versao({ id: "ftv-2", versionNumber: 2, versionLabel: "V2", status: "ACTIVE", sourceVersionId: "ftv-1", sourceVersionNumber: 1 }),
  versao({ id: "ftv-3", versionNumber: 3, versionLabel: "V3", status: "DRAFT", sourceVersionId: "ftv-2", sourceVersionNumber: 2 }),
]);

function FichaStub() {
  const { templateId, versionId } = useParams();
  return <p>ficha de {`${templateId}/${versionId}`}</p>;
}

async function abrirPagina(dto: FormulationTemplateDTO) {
  getFormulationTemplate.mockResolvedValue(dto);
  const router = createMemoryRouter(
    createRoutesFromElements(
      <>
        <Route
          path="/producao/templates-formulacao/:templateId"
          element={<FormulationTemplateDetailPage />}
        />
        <Route
          path="/producao/templates-formulacao/:templateId/versoes/:versionId/ficha-tecnica"
          element={<FichaStub />}
        />
      </>,
    ),
    { initialEntries: ["/producao/templates-formulacao/ft-7"] },
  );
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getAllByText(/FT-000007/).length).toBeGreaterThan(0));
}

beforeEach(() => {
  vi.clearAllMocks();
  papel.role = "ADMIN";
  renderPdfBlob.mockResolvedValue(new Blob(["%PDF-1.3"], { type: "application/pdf" }));
  URL.createObjectURL = vi.fn(() => "blob:veridi/ficha-modelo");
  URL.revokeObjectURL = vi.fn();
});

describe("Modelo — Ficha técnica (PDF) na página", () => {
  it("a ação fica no cabeçalho e é da versão da bancada — o rascunho, quando há", async () => {
    await abrirPagina(TRES_VERSOES);
    const cabecalho = document.querySelector(".doc-header") as HTMLElement;
    /* O mesmo destino no cabeçalho e na linha da V3 do histórico: mesmo nome. */
    const botao = within(cabecalho).getByRole("button", { name: "Ficha técnica (PDF) da V3" });
    expect(botao).toHaveTextContent("Ficha técnica (PDF)");
    expect(within(cabecalho).getAllByRole("button")).toHaveLength(1);

    fireEvent.click(botao);
    expect(await screen.findByText("ficha de ft-7/ftv-3")).toBeInTheDocument();
  });

  it("sem rascunho, a ação do cabeçalho é da versão ativa", async () => {
    await abrirPagina(modelo(TRES_VERSOES.versions.filter((version) => version.status !== "DRAFT")));
    const cabecalho = document.querySelector(".doc-header") as HTMLElement;
    fireEvent.click(within(cabecalho).getByRole("button", { name: "Ficha técnica (PDF) da V2" }));
    expect(await screen.findByText("ficha de ft-7/ftv-2")).toBeInTheDocument();
  });

  it("o histórico leva à ficha de cada versão, inclusive a arquivada", async () => {
    await abrirPagina(TRES_VERSOES);
    const linhaDaV1 = screen
      .getAllByRole("row")
      .find((linha) => within(linha).queryByText("V1") && within(linha).queryByText("Arquivada"));
    expect(linhaDaV1).toBeDefined();
    fireEvent.click(
      within(linhaDaV1 as HTMLElement).getByRole("button", { name: "Ficha técnica (PDF) da V1" }),
    );
    expect(await screen.findByText("ficha de ft-7/ftv-1")).toBeInTheDocument();
  });

  it("toda versão do histórico tem a ação — rascunho, ativa e arquivada", async () => {
    await abrirPagina(TRES_VERSOES);
    for (const rotulo of ["V1", "V2", "V3"]) {
      expect(
        screen.getAllByRole("button", { name: `Ficha técnica (PDF) da ${rotulo}` }).length,
        rotulo,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("quem só consulta também gera a ficha — é leitura", async () => {
    papel.role = "VIEWER";
    await abrirPagina(TRES_VERSOES);
    expect(screen.queryByRole("button", { name: "Salvar rascunho" })).toBeNull();
    expect(
      within(document.querySelector(".doc-header") as HTMLElement).getByRole("button", {
        name: "Ficha técnica (PDF) da V3",
      }),
    ).toBeInTheDocument();
  });
});

describe("Modelo — tela da Ficha técnica", () => {
  async function abrirFicha(dto: FormulationTemplateDTO, versionId: string) {
    getFormulationTemplate.mockResolvedValue(dto);
    const router = createMemoryRouter(
      createRoutesFromElements(
        <>
          <Route
            path="/producao/templates-formulacao/:templateId/versoes/:versionId/ficha-tecnica"
            element={<FormulationTemplateTechnicalSheetPrintPage />}
          />
          <Route path="/producao/templates-formulacao/:templateId" element={<p>página do modelo</p>} />
        </>,
      ),
      { initialEntries: [`/producao/templates-formulacao/ft-7/versoes/${versionId}/ficha-tecnica`] },
    );
    render(<RouterProvider router={router} />);
  }

  /** O documento que a tela mandou gerar, desenhado para leitura. */
  function documentoGerado(): HTMLElement {
    const [documento] = renderPdfBlob.mock.calls.at(-1) as [ReactElement];
    const alvo = document.createElement("div");
    document.body.appendChild(alvo);
    render(documento, { container: alvo });
    return alvo;
  }

  it("gera a ficha da versão pedida, com o nome de arquivo do modelo", async () => {
    await abrirFicha(TRES_VERSOES, "ftv-1");
    expect(await screen.findByTitle("Documento ficha-tecnica-modelo-FT-000007-v1.pdf")).toBeInTheDocument();
    expect(getFormulationTemplate).toHaveBeenCalledWith("ft-7");

    const papelGerado = documentoGerado();
    expect(papelGerado).toHaveTextContent("Ficha técnica do modelo de formulação");
    expect(papelGerado).toHaveTextContent("FT-000007 · V1");
    expect(papelGerado).toHaveTextContent("Versão histórica, arquivada.");
    expect(papelGerado).not.toHaveTextContent("Ficha técnica do produto");
  });

  it("modelo arquivado na biblioteca: a ficha avisa", async () => {
    await abrirFicha(modelo(TRES_VERSOES.versions, true), "ftv-2");
    expect(await screen.findByTitle("Documento ficha-tecnica-modelo-FT-000007-v2.pdf")).toBeInTheDocument();
    expect(documentoGerado()).toHaveTextContent("Modelo arquivado.");
  });

  it("versão que não é deste modelo não vira ficha dele", async () => {
    await abrirFicha(TRES_VERSOES, "ftv-de-outro-modelo");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível gerar o documento: esta versão não pertence ao modelo.",
    );
    expect(renderPdfBlob).not.toHaveBeenCalled();
  });

  it("Voltar leva à página do modelo", async () => {
    await abrirFicha(TRES_VERSOES, "ftv-2");
    await screen.findByTitle("Documento ficha-tecnica-modelo-FT-000007-v2.pdf");
    fireEvent.click(screen.getByRole("button", { name: "← Voltar" }));
    expect(await screen.findByText("página do modelo")).toBeInTheDocument();
  });
});
