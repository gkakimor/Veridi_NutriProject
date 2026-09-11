// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { renderPdfBlob } from "../render";
import { cmv, estruturaGrande } from "../testing/cost-structure-fixtures";
import { lerPdf, type PdfLido } from "../testing/pdf-text";
import { CmvPdf, cmvPdfFileName } from "./CmvPdf";
import { IndustrialCostPdf, industrialCostPdfFileName } from "./IndustrialCostPdf";

/**
 * Estrutura de custos e CMV como ARQUIVO: PDF real, lido de volta página por
 * página — A4, "Página X de Y" e identidade em toda folha, cabeçalho de tabela
 * repetido, quantidade de recursos (§87) e nenhum rastro de navegador.
 *
 * `PDF_SAMPLES_DIR=<pasta>` grava as amostras para inspeção visual.
 */

/** 09:30:45 em Brasília — os segundos não podem chegar ao papel. */
const GERADO_EM = new Date("2026-09-11T12:30:45.000Z");
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

/** Toda folha: A4, "Página X de Y", carimbo sem segundos, natureza interna e o código. */
function conferirFolhas(pdf: PdfLido, codigo: string) {
  expect(pdf.bruto.startsWith("%PDF-")).toBe(true);
  expect(pdf.folhas.every(ehA4Retrato), pdf.folhas.join(" | ")).toBe(true);
  const total = pdf.paginas.length;
  pdf.paginas.forEach((pagina, indice) => {
    const folha = `folha ${indice + 1}`;
    expect(pagina, folha).toContain(`Página ${indice + 1} de ${total}`);
    expect(pagina, folha).toContain("Gerado em 11/09/2026 09:30");
    expect(pagina, folha).toContain("Documento interno");
    expect(pagina, folha).toContain(codigo);
  });
  const tudo = pdf.paginas.join("\n");
  for (const rastro of RASTROS) {
    expect(pdf.bruto).not.toContain(rastro);
    expect(tudo).not.toContain(rastro);
  }
}

function linhaCom(pdf: PdfLido, trecho: string): string {
  return pdf.paginas.flatMap((pagina) => pagina.split("\n")).find((linha) => linha.includes(trecho)) ?? "";
}

describe("gerador de PDF — Estrutura de custos industriais", () => {
  it(
    "A4 multipágina, cabeçalho repetido, 2 × 2 hora com o total, energia sem multiplicador, sem rastro de navegador",
    async () => {
      const version = estruturaGrande();
      const pdf = await gerar(
        <IndustrialCostPdf version={version} generatedAt={GERADO_EM} generatedBy="Equipe de Custos" />,
        industrialCostPdfFileName(version),
      );

      expect(pdf.paginas.length).toBeGreaterThanOrEqual(2);
      conferirFolhas(pdf, "EC-000012 · V3");
      // Folha com linha de material tem o cabeçalho da tabela no topo.
      for (const pagina of pdf.paginas) {
        if (pagina.includes("Matéria-prima de teste")) expect(pagina).toContain("PUREZA");
      }

      expect(linhaCom(pdf, "Operador de produção")).toContain("2 × 2 hora");
      expect(pdf.paginas.join("\n")).toContain("Total: 4 hora");
      const energia = linhaCom(pdf, "Energia elétrica");
      expect(energia).toContain("50 kWh");
      expect(energia).not.toContain("×");
      expect(pdf.paginas.join("\n")).toContain("Pureza e overage: valores registrados");
    },
    PRAZO,
  );
});

describe("gerador de PDF — CMV", () => {
  it(
    "A4, rodapé controlado, recurso 2 × 4 hora com Total: 8 hora, sem rastro de navegador",
    async () => {
      const data = cmv();
      const pdf = await gerar(
        <CmvPdf
          data={data}
          quantity="3000"
          referenceDate="2026-09-09"
          generatedAt={GERADO_EM}
          generatedBy="Equipe de Custos"
        />,
        cmvPdfFileName(data, "3000", "2026-09-09"),
      );

      conferirFolhas(pdf, "PROD-000045 · CALC-000123");
      expect(linhaCom(pdf, "Operador de produção")).toContain("2 × 4 hora");
      expect(pdf.paginas.join("\n")).toContain("Total: 8 hora");
      const energia = linhaCom(pdf, "Energia elétrica");
      expect(energia).toContain("50 kWh");
      expect(energia).not.toContain("×");
      expect(pdf.paginas.join("\n")).toContain("CMV total para 3000 un");
    },
    PRAZO,
  );
});
