import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { lerPdf as lerPdfDaWeb } from "../../../apps/web/src/pdf/testing/pdf-text";
import { lerPdf, normalizarTexto, textoDoPdfDaTela } from "./pdf.mjs";

/**
 * E2E-BASELINE-REDESIGN-WAVE-01-02 — `lib/pdf.mjs` é gêmeo do leitor da web.
 *
 * As suítes leem o impresso com `lib/pdf.mjs`; os testes de unidade da web, com
 * `apps/web/src/pdf/testing/pdf-text.ts`. Dois leitores que divergem fazem a E2E
 * reprovar o PDF que a unidade aprova (ou o contrário). Aqui os dois leem os
 * mesmos bytes — com os operadores que o renderer escreve — e têm de devolver o
 * mesmo texto. E o contrato de tela (`blob:`, `%PDF-`, NBSP) com página falsa.
 */

type Pagina = { conteudo: string; comprimir?: boolean; mediaBox?: string };

/** PDF mínimo à mão: catálogo, árvore de páginas e um fluxo de conteúdo por página. */
function montarPdf(paginas: Pagina[]): Uint8Array {
  const partes: Buffer[] = [];
  const escrever = (trecho: Buffer | string) =>
    partes.push(typeof trecho === "string" ? Buffer.from(trecho, "latin1") : trecho);
  escrever("%PDF-1.3\n");
  const ids = paginas.map((_, indice) => 3 + indice * 2);
  escrever("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  escrever(`2 0 obj\n<< /Type /Pages /Kids [${ids.map((id) => `${id} 0 R`).join(" ")}] /Count ${paginas.length} >>\nendobj\n`);
  paginas.forEach((pagina, indice) => {
    const id = ids[indice]!;
    escrever(
      `${id} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [${pagina.mediaBox ?? "0 0 595.28 841.89"}] /Contents ${id + 1} 0 R >>\nendobj\n`,
    );
    const bruto = Buffer.from(pagina.conteudo, "latin1");
    const dados = pagina.comprimir === false ? bruto : deflateSync(bruto);
    escrever(`${id + 1} 0 obj\n<< /Length ${dados.length}${pagina.comprimir === false ? "" : " /Filter /FlateDecode"} >>\nstream\n`);
    escrever(dados);
    escrever("\nendstream\nendobj\n");
  });
  escrever("trailer\n<< /Root 1 0 R >>\n%%EOF\n");
  return new Uint8Array(Buffer.concat(partes));
}

const DOCUMENTO = montarPdf([
  {
    conteudo: [
      "BT /F1 12 Tf 1 0 0 1 56 800 Tm (Pedido de compra OC-123) Tj ET",
      // `cm` desloca o trecho: os dois caem na mesma linha de base (780), fora de ordem de x.
      "q 1 0 0 1 0 -20 cm BT /F1 10 Tf 1 0 0 1 200 800 Tm <466F726E656365646F72> Tj ET Q",
      "BT /F1 10 Tf 1 0 0 1 56 780 Tm (Fornecedor:) Tj ET",
      // TJ com kerning e NBSP em WinAnsi (\\240) entre R$ e o valor.
      "BT 1 0 0 1 56 700 Tm [(Total ) -300 (R$\\240100,00)] TJ ET",
      // Td relativo e octal WinAnsi: ç = \\347, ã = \\343.
      "BT 56 650 Td (A\\347\\343o) Tj 0 -14 Td (linha \\(2\\)) Tj ET",
    ].join("\n"),
  },
  { conteudo: "BT 1 0 0 1 72 72 Tm (Segunda folha) ' ET", comprimir: false, mediaBox: "0 0 841.89 595.28" },
]);

describe("lib/pdf.mjs e o leitor da web leem igual", () => {
  it("mesmos bytes, mesmo texto por página e mesma folha", () => {
    const suites = lerPdf(DOCUMENTO);
    const web = lerPdfDaWeb(DOCUMENTO);
    expect(suites.paginas).toEqual(web.paginas);
    expect(suites.folhas).toEqual(web.folhas);
    expect(suites.paginas[0]).toBe(
      ["Pedido de compra OC-123", "Fornecedor: Fornecedor", "Total R$ 100,00", "Ação", "linha (2)"].join("\n"),
    );
    expect(suites.paginas[1]).toBe("Segunda folha");
    expect(suites.folhas).toEqual(["0 0 595.28 841.89", "0 0 841.89 595.28"]);
  });

  it("o tokenizador e a tolerância de linha são os mesmos nos dois arquivos", () => {
    const trecho = (arquivo: string, padrao: RegExp) => padrao.exec(readFileSync(new URL(arquivo, import.meta.url), "utf8"))?.[0];
    const TOKEN = /const TOKEN = .*;/;
    const LINHA = /Math\.abs\(candidata\.y - trecho\.y\) < [\d.]+/;
    const web = "../../../apps/web/src/pdf/testing/pdf-text.ts";
    expect(trecho("./pdf.mjs", TOKEN)).toBeDefined();
    expect(trecho("./pdf.mjs", TOKEN)).toBe(trecho(web, TOKEN));
    expect(trecho("./pdf.mjs", LINHA)).toBe(trecho(web, LINHA));
  });
});

describe("texto do PDF da tela", () => {
  const paginaFalsa = (lido: { src: string; base64: string | null }) => ({
    locator: () => ({ first: () => ({ waitFor: async () => {} }) }),
    evaluate: async () => lido,
  });

  it("lê o blob gerado no navegador e entrega o texto com espaço comum no lugar de NBSP", async () => {
    const base64 = Buffer.from(DOCUMENTO).toString("base64");
    const texto = await textoDoPdfDaTela(paginaFalsa({ src: "blob:http://127.0.0.1:5174/abc#toolbar=0", base64 }));
    expect(texto).toContain("Total R$ 100,00");
    expect(texto).not.toMatch(/[  ]/);
    expect(texto.split("\n").at(-1)).toBe("Segunda folha");
  });

  it("recusa documento que não veio como blob, e blob que não é PDF", async () => {
    await expect(textoDoPdfDaTela(paginaFalsa({ src: "http://127.0.0.1:3334/purchase-orders/x.pdf", base64: null }))).rejects.toThrow(
      /não veio como blob/,
    );
    const html = Buffer.from("<!doctype html><p>erro</p>").toString("base64");
    await expect(textoDoPdfDaTela(paginaFalsa({ src: "blob:http://127.0.0.1:5174/x", base64: html }))).rejects.toThrow(/não é PDF/);
  });

  it("normaliza NBSP e espaço fino", () => {
    expect(normalizarTexto("R$ 1.234,56 e 1 000")).toBe("R$ 1.234,56 e 1 000");
  });
});
