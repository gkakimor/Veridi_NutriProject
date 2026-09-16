// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderPdfBlob } from "../render";
import {
  UNIDADES,
  modeloCapsula,
  modeloLegado,
  modeloLongo,
  modeloPo,
} from "../testing/technical-sheet-template-fixtures";
import { lerPdf, type PdfLido } from "../testing/pdf-text";
import { TechnicalSheetPdf, technicalSheetPdfFileName } from "./TechnicalSheetPdf";
import { fichaTecnicaDoModelo } from "./technical-sheet-template-model";

/**
 * A Ficha Técnica do MODELO como ARQUIVO: PDF real, lido de volta folha por
 * folha (FORMULATION-TEMPLATE-TECHNICAL-SHEET-PDF-01).
 *
 * A mesma prova da ficha do Produto (`technical-sheet-documents.test.tsx`) —
 * A4 retrato, "Página X de Y" em toda folha, cabeçalho de tabela repetido,
 * nenhum rastro de navegador — com a moldura do Modelo: título, subtítulo de
 * matriz de biblioteca e código FT.
 *
 * `PDF_SAMPLES_DIR=<pasta>` grava as amostras para conferência visual.
 */

/** 09:30:45 em Brasília — os segundos não podem chegar ao papel. */
const GERADO_EM = new Date("2026-09-15T12:30:45.000Z");
const RASTROS = ["http", "localhost", "127.0.0.1", "about:blank", "09:30:45"];
/** O primeiro render carrega o motor de PDF. */
const PRAZO = 60_000;

/** A4 retrato: 595,28 × 841,89 pt (o arquivo grava com 6 casas). */
function ehA4Retrato(mediaBox: string): boolean {
  const [x, y, largura, altura] = mediaBox.split(/\s+/).map((valor) => Number.parseFloat(valor));
  return (
    x === 0 &&
    y === 0 &&
    Math.abs((largura ?? 0) - 595.28) < 0.01 &&
    Math.abs((altura ?? 0) - 841.89) < 0.01
  );
}

async function gerarFicha(
  version: Parameters<typeof fichaTecnicaDoModelo>[0],
  opcoes: { modeloArquivado?: boolean } = {},
): Promise<PdfLido> {
  const ficha = fichaTecnicaDoModelo(version, UNIDADES, GERADO_EM, opcoes);
  const blob = await renderPdfBlob(<TechnicalSheetPdf ficha={ficha} generatedAt={GERADO_EM} />);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pasta = process.env["PDF_SAMPLES_DIR"];
  if (pasta) {
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, technicalSheetPdfFileName(ficha)), bytes);
  }
  return lerPdf(bytes);
}

/** Toda folha: A4, "Página X de Y", carimbo sem segundos, natureza e o código FT. */
function conferirFolhas(pdf: PdfLido, codigo: string) {
  expect(pdf.bruto.startsWith("%PDF-")).toBe(true);
  expect(pdf.folhas.every(ehA4Retrato), pdf.folhas.join(" | ")).toBe(true);
  const total = pdf.paginas.length;
  pdf.paginas.forEach((pagina, indice) => {
    const folha = `folha ${indice + 1}`;
    expect(pagina, folha).toContain(`Página ${indice + 1} de ${total}`);
    expect(pagina, folha).toContain("Gerado em 15/09/2026 09:30");
    expect(pagina, folha).toContain("Documento interno");
    expect(pagina, folha).toContain(codigo);
  });
  const tudo = pdf.paginas.join("\n");
  for (const rastro of RASTROS) {
    expect(pdf.bruto).not.toContain(rastro);
    expect(tudo).not.toContain(rastro);
  }
}

describe("Ficha técnica do Modelo em PDF — arquivo real", () => {
  it(
    "cápsula em rascunho: A4, título do modelo, subtítulo de matriz e marca RASCUNHO",
    async () => {
      const pdf = await gerarFicha(modeloCapsula());

      conferirFolhas(pdf, "FT-000001 · V1");
      const tudo = pdf.paginas.join("\n");
      expect(tudo).toContain("FICHA TÉCNICA DO MODELO DE FORMULAÇÃO");
      expect(tudo).not.toContain("FICHA TÉCNICA DO PRODUTO");
      expect(tudo).toContain("Matriz de biblioteca — não é documento de Produto");
      expect(tudo).toContain("Modelo · Base multivitamínica — cápsula 120");
      expect(pdf.paginas[0]).toContain("RASCUNHO");
      expect(tudo).toContain("Status: Rascunho");
      expect(tudo).toContain("Matriz em rascunho.");
      expect(tudo).toContain("COMPOSIÇÃO — MATÉRIAS-PRIMAS");
      expect(tudo).toContain("EMBALAGEM");
      expect(tudo).toContain("L-metilfolato de cálcio");
      expect(tudo).toContain("POR CÁPSULA");
    },
    PRAZO,
  );

  it(
    "pó arquivado: versão histórica no papel, sem marca de rascunho nem coluna por cápsula",
    async () => {
      const pdf = await gerarFicha(
        modeloPo({ status: "ARCHIVED", archivedAt: "2026-09-10T14:00:00.000Z" }),
      );

      conferirFolhas(pdf, "FT-000002 · V2");
      const tudo = pdf.paginas.join("\n");
      expect(tudo).toContain("Status: Arquivado");
      expect(tudo).toContain("Versão histórica, arquivada.");
      expect(tudo).not.toContain("RASCUNHO");
      expect(tudo).not.toContain("POR CÁPSULA");
      expect(tudo).toContain("PROTEÍNA BOVINA");
      expect(tudo).toContain("30.000 mg");
      expect(tudo).toContain("900.000 mg");
    },
    PRAZO,
  );

  it(
    "ativo: sem marca de rascunho e sem aviso; modelo arquivado ganha o aviso",
    async () => {
      const ativo = (await gerarFicha(modeloPo())).paginas.join("\n");
      expect(ativo).toContain("Status: Ativo");
      expect(ativo).not.toContain("RASCUNHO");
      expect(ativo).not.toContain("Modelo arquivado.");

      const foraDaBiblioteca = (await gerarFicha(modeloPo(), { modeloArquivado: true })).paginas.join(
        "\n",
      );
      expect(foraDaBiblioteca).toContain("Modelo arquivado.");
    },
    PRAZO,
  );

  it(
    "legado sem forma: o arquivo nasce, com a forma não informada",
    async () => {
      const pdf = await gerarFicha(modeloLegado());

      conferirFolhas(pdf, "FT-000003 · V1");
      const tudo = pdf.paginas.join("\n");
      expect(tudo).toContain("Não informada");
      expect(tudo).toContain("0,104762 kg");
      expect(tudo).not.toContain("DOSES POR EMBALAGEM");
    },
    PRAZO,
  );

  it(
    "modelo longo: várias folhas, cabeçalho da tabela repetido e nenhuma linha perdida",
    async () => {
      const pdf = await gerarFicha(modeloLongo());

      expect(pdf.paginas.length).toBeGreaterThanOrEqual(2);
      conferirFolhas(pdf, "FT-000009 · V3");

      for (const [indice, pagina] of pdf.paginas.entries()) {
        if (/MP-000\d{3}/.test(pagina)) {
          expect(pagina, `folha ${indice + 1}`).toContain("INGREDIENTE");
          expect(pagina, `folha ${indice + 1}`).toContain("PUREZA (%)");
          expect(pagina, `folha ${indice + 1}`).toContain("RESERVA");
        }
      }

      /* Conferência pelo CÓDIGO: o nome quebra dentro da célula. */
      const tudo = pdf.paginas.join("\n");
      for (let indice = 0; indice < 48; indice += 1) {
        const codigo = `MP-${String(900 + indice).padStart(6, "0")}`;
        expect(tudo, codigo).toContain(codigo);
      }
      for (let indice = 0; indice < 12; indice += 1) {
        const codigo = `ME-${String(900 + indice).padStart(6, "0")}`;
        expect(tudo, codigo).toContain(codigo);
      }
    },
    PRAZO,
  );

  it(
    "nenhum custo, preço ou margem chega ao arquivo",
    async () => {
      const pdf = await gerarFicha(modeloCapsula());
      const tudo = pdf.paginas.join("\n").toLowerCase();
      for (const proibido of ["r$", "custo", "cmv", "preço", "margem", "markup", "fornecedor"]) {
        expect(tudo, `"${proibido}" não pode estar na ficha do modelo`).not.toContain(proibido);
      }
    },
    PRAZO,
  );
});
