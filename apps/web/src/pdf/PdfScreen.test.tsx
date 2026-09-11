import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PdfScreen } from "./PdfScreen";

/**
 * A tela do documento: o arquivo nasce sem diálogo de impressão, a
 * pré-visualização é o próprio PDF e as ações dizem o que fazem.
 * O gerador em si é provado em `pdf-generator.test.tsx`.
 */

const renderPdfBlob = vi.fn();
const downloadPdf = vi.fn();
vi.mock("./render", () => ({
  renderPdfBlob: (...args: unknown[]) => renderPdfBlob(...args),
  downloadPdf: (...args: unknown[]) => downloadPdf(...args),
}));

type Doc = { code: string; versionNumber: number };

beforeEach(() => {
  renderPdfBlob.mockReset().mockResolvedValue(new Blob(["%PDF-1.3"], { type: "application/pdf" }));
  downloadPdf.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:veridi/pdf-1");
  URL.revokeObjectURL = vi.fn();
});

function abrir(load: () => Promise<Doc> = () => Promise.resolve({ code: "ORC-000001", versionNumber: 1 })) {
  return render(
    <MemoryRouter initialEntries={["/comercial/orcamentos/qv-1/imprimir"]}>
      <Routes>
        <Route
          path="/comercial/orcamentos/:id/imprimir"
          element={
            <PdfScreen<Doc>
              load={load}
              build={async (doc) => ({
                document: <div />,
                fileName: `${doc.code}-V${doc.versionNumber}.pdf`,
              })}
              backTo="/comercial/projetos/prj-1"
            />
          }
        />
        <Route path="/comercial/projetos/prj-1" element={<p>Projeto de origem</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("tela do documento PDF", () => {
  it("gera o arquivo e mostra o próprio PDF — sem diálogo de impressão", async () => {
    abrir();
    expect(screen.getByRole("status")).toHaveTextContent("Gerando PDF");

    const arquivo = await screen.findByTitle("Documento ORC-000001-V1.pdf");
    expect(arquivo).toHaveAttribute("src", "blob:veridi/pdf-1#toolbar=0&navpanes=0");
    expect(renderPdfBlob).toHaveBeenCalledTimes(1);
  });

  it("Baixar PDF salva o arquivo gerado, com o nome do documento", async () => {
    abrir();
    await screen.findByTitle("Documento ORC-000001-V1.pdf");

    fireEvent.click(screen.getByRole("button", { name: "Baixar PDF" }));
    expect(downloadPdf).toHaveBeenCalledWith(expect.any(Blob), "ORC-000001-V1.pdf");
  });

  it("as ações dizem o que fazem: baixar o arquivo ou imprimir", async () => {
    abrir();
    await screen.findByTitle("Documento ORC-000001-V1.pdf");

    expect(screen.getByRole("button", { name: "Imprimir" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Baixar PDF" })).toBeEnabled();
    // A ação dupla antiga ("Imprimir / Salvar PDF") dependia do diálogo do navegador.
    expect(screen.queryByText(/Salvar PDF/)).toBeNull();
  });

  it("falha ao carregar aparece como erro — nenhum PDF é gerado", async () => {
    abrir(() => Promise.reject(new Error("Sem permissão para este documento")));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sem permissão para este documento");
    expect(renderPdfBlob).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Baixar PDF" })).toBeDisabled();
  });

  it("Voltar leva ao documento de origem", async () => {
    abrir();
    await screen.findByTitle("Documento ORC-000001-V1.pdf");

    fireEvent.click(screen.getByRole("button", { name: /Voltar/ }));
    expect(screen.getByText("Projeto de origem")).toBeInTheDocument();
  });
});
