// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { renderPdfBlob } from "../render";
import {
  UNIDADES,
  versaoCapsula,
  versaoLonga,
  versaoPo,
} from "../testing/technical-sheet-fixtures";
import { lerPdf, type PdfLido } from "../testing/pdf-text";
import { TechnicalSheetPdf, technicalSheetPdfFileName } from "./TechnicalSheetPdf";
import { fichaTecnicaDaVersao } from "./technical-sheet-model";

/**
 * A Ficha Técnica como ARQUIVO: PDF real, lido de volta folha por folha.
 *
 * O que só o arquivo prova — A4 retrato, "Página X de Y" em toda folha,
 * cabeçalho de tabela repetido quando a composição atravessa a página, a marca
 * de rascunho no papel e nenhum rastro de navegador. O conteúdo por forma está
 * em `technical-sheet-content.test.tsx`.
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

async function gerar(documento: ReactElement, amostra: string): Promise<PdfLido> {
  const blob = await renderPdfBlob(documento);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pasta = process.env["PDF_SAMPLES_DIR"];
  if (pasta) {
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, amostra), bytes);
  }
  return lerPdf(bytes);
}

function ficha(version: Parameters<typeof fichaTecnicaDaVersao>[0]) {
  return fichaTecnicaDaVersao(version, UNIDADES);
}

async function gerarFicha(version: Parameters<typeof fichaTecnicaDaVersao>[0]): Promise<PdfLido> {
  const modelo = ficha(version);
  return gerar(
    <TechnicalSheetPdf ficha={modelo} generatedAt={GERADO_EM} />,
    technicalSheetPdfFileName(modelo),
  );
}

/** Toda folha: A4, "Página X de Y", carimbo sem segundos, natureza e o código. */
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

describe("Ficha técnica em PDF — arquivo real", () => {
  it(
    "cápsula em rascunho: A4, título, marca RASCUNHO no papel e nenhum rastro de navegador",
    async () => {
      const pdf = await gerarFicha(versaoCapsula());

      conferirFolhas(pdf, "PROD-000174 · V1");
      const tudo = pdf.paginas.join("\n");
      expect(tudo).toContain("FICHA TÉCNICA DO PRODUTO");
      expect(tudo).toContain("Formulação · Exemplo - Ácido Fólico PT 120 Caps");
      // `textTransform: uppercase` chega ao papel — é a marca, não o rótulo.
      expect(pdf.paginas[0]).toContain("RASCUNHO");
      expect(tudo).toContain("Status: Rascunho");
      expect(tudo).toContain("COMPOSIÇÃO — MATÉRIAS-PRIMAS");
      expect(tudo).toContain("EMBALAGEM");
      expect(tudo).toContain("L-metilfolato de cálcio");
      expect(tudo).toContain("POR CÁPSULA");
    },
    PRAZO,
  );

  it(
    "pó ativo: sem marca de rascunho, sem coluna Por cápsula, com dose e conteúdo",
    async () => {
      const pdf = await gerarFicha(versaoPo());

      conferirFolhas(pdf, "PROD-000175 · V2");
      const tudo = pdf.paginas.join("\n");
      expect(tudo).toContain("Status: Ativa");
      expect(tudo).not.toContain("RASCUNHO");
      expect(tudo).not.toContain("POR CÁPSULA");
      expect(tudo).toContain("PROTEÍNA BOVINA");
      expect(tudo).toContain("30.000 mg");
      expect(tudo).toContain("900.000 mg");
    },
    PRAZO,
  );

  it(
    "formulação longa: várias folhas, cabeçalho da tabela repetido e linha inteira",
    async () => {
      const pdf = await gerarFicha(versaoLonga());

      expect(pdf.paginas.length).toBeGreaterThanOrEqual(2);
      conferirFolhas(pdf, "PROD-000999 · V3");

      /*
       * Folha que tem linha de ingrediente tem o cabeçalho da tabela no topo —
       * senão a segunda página vira uma lista de números sem nome de coluna.
       */
      for (const [indice, pagina] of pdf.paginas.entries()) {
        if (/MP-000\d{3}/.test(pagina)) {
          expect(pagina, `folha ${indice + 1}`).toContain("INGREDIENTE");
          expect(pagina, `folha ${indice + 1}`).toContain("PUREZA (%)");
          // "RESERVA (%)" quebra em duas linhas na largura da coluna.
          expect(pagina, `folha ${indice + 1}`).toContain("RESERVA");
        }
      }

      /*
       * Nenhuma das 48 linhas se perdeu na quebra de página. A conferência é
       * pelo CÓDIGO: o nome do ingrediente quebra em duas linhas dentro da
       * célula, e o leitor junta o texto por linha de base, não por célula.
       */
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
      const pdf = await gerarFicha(versaoCapsula());
      const tudo = pdf.paginas.join("\n").toLowerCase();
      for (const proibido of ["r$", "custo", "cmv", "preço", "margem", "markup", "fornecedor"]) {
        expect(tudo, `"${proibido}" não pode estar na ficha técnica`).not.toContain(proibido);
      }
    },
    PRAZO,
  );
});
