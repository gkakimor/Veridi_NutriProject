import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { colunaDoExcel, crc32, gerarXlsx, nomeDeAbaValido, partesDaPlanilha } from "./xlsx-writer.js";
import type { AbaDaPlanilha } from "./xlsx-writer.js";

/**
 * O `.xlsx` é um ZIP de XML escrito à mão (MASTER-DATA-DUPLICATE-SANITIZATION-01):
 * o teste desmonta o pacote e confere as partes, porque um ZIP inválido só
 * aparece na hora em que a Veridi tenta abrir o arquivo.
 */

/** Desmonta o ZIP pelo diretório central — o mesmo caminho que o Excel usa. */
function abrirZip(zip: Buffer): Map<string, string> {
  const fimDoDiretorio = (() => {
    for (let i = zip.length - 22; i >= 0; i -= 1) {
      if (zip.readUInt32LE(i) === 0x06054b50) return i;
    }
    throw new Error("ZIP sem fim de diretório central.");
  })();

  const entradas = zip.readUInt16LE(fimDoDiretorio + 10);
  let posicao = zip.readUInt32LE(fimDoDiretorio + 16);
  const partes = new Map<string, string>();

  for (let i = 0; i < entradas; i += 1) {
    expect(zip.readUInt32LE(posicao)).toBe(0x02014b50);
    const tamanhoDoNome = zip.readUInt16LE(posicao + 28);
    const tamanhoDoExtra = zip.readUInt16LE(posicao + 30);
    const tamanhoDoComentario = zip.readUInt16LE(posicao + 32);
    const nome = zip.subarray(posicao + 46, posicao + 46 + tamanhoDoNome).toString("utf8");
    const local = zip.readUInt32LE(posicao + 42);

    expect(zip.readUInt32LE(local)).toBe(0x04034b50);
    const crcGravado = zip.readUInt32LE(local + 14);
    const comprimido = zip.readUInt32LE(local + 18);
    const nomeLocal = zip.readUInt16LE(local + 26);
    const extraLocal = zip.readUInt16LE(local + 28);
    const inicio = local + 30 + nomeLocal + extraLocal;
    const cru = inflateRawSync(zip.subarray(inicio, inicio + comprimido));

    expect(crc32(cru)).toBe(crcGravado);
    expect(cru.length).toBe(zip.readUInt32LE(local + 22));
    partes.set(nome, cru.toString("utf8"));
    posicao += 46 + tamanhoDoNome + tamanhoDoExtra + tamanhoDoComentario;
  }
  return partes;
}

const abaSimples: AbaDaPlanilha = {
  nome: "Removidos",
  cabecalho: ["Cadastro", "Código", "Linhas"],
  linhas: [
    ["Item", "MP-000322", 4],
    ["Item", "MP-000304", 0],
  ],
};

describe("colunaDoExcel", () => {
  it("vai de A a Z e entra em AA", () => {
    expect(colunaDoExcel(0)).toBe("A");
    expect(colunaDoExcel(25)).toBe("Z");
    expect(colunaDoExcel(26)).toBe("AA");
    expect(colunaDoExcel(27)).toBe("AB");
    expect(colunaDoExcel(51)).toBe("AZ");
    expect(colunaDoExcel(52)).toBe("BA");
    expect(colunaDoExcel(701)).toBe("ZZ");
    expect(colunaDoExcel(702)).toBe("AAA");
  });
});

describe("nome da aba", () => {
  it("corta em 31 e tira o que o Excel proíbe", () => {
    expect(nomeDeAbaValido("Revisão necessária")).toBe("Revisão necessária");
    expect(nomeDeAbaValido("a/b:c\\d?e*f[g]h")).toBe("a b c d e f g h");
    expect(nomeDeAbaValido("x".repeat(40))).toHaveLength(31);
    expect(nomeDeAbaValido("   ")).toBe("Planilha");
  });

  it("recusa planilha sem aba e com aba repetida", () => {
    expect(() => partesDaPlanilha([])).toThrow(/sem aba/);
    expect(() => partesDaPlanilha([abaSimples, { ...abaSimples }])).toThrow(/aba repetida/);
  });
});

describe("pacote gerado", () => {
  const zip = gerarXlsx([abaSimples, { nome: "Resumo", cabecalho: ["Cadastro"], linhas: [["Item"]] }]);
  const partes = abrirZip(zip);

  it("traz as partes que o Excel exige", () => {
    expect([...partes.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]);
  });

  it("declara cada aba no workbook e nas relações", () => {
    const workbook = partes.get("xl/workbook.xml")!;
    expect(workbook).toContain(`<sheet name="Removidos" sheetId="1" r:id="rId1"/>`);
    expect(workbook).toContain(`<sheet name="Resumo" sheetId="2" r:id="rId2"/>`);
    const rels = partes.get("xl/_rels/workbook.xml.rels")!;
    expect(rels).toContain(`Target="worksheets/sheet1.xml"`);
    expect(rels).toContain(`Target="worksheets/sheet2.xml"`);
    expect(rels).toContain(`Target="styles.xml"`);
  });

  it("escreve cabeçalho em negrito, texto como inlineStr e número como número", () => {
    const folha = partes.get("xl/worksheets/sheet1.xml")!;
    expect(folha).toContain(`<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Cadastro</t></is></c>`);
    expect(folha).toContain(`<c r="B2" t="inlineStr"><is><t xml:space="preserve">MP-000322</t></is></c>`);
    expect(folha).toContain(`<c r="C2"><v>4</v></c>`);
    // Zero é número e continua visível: célula vazia mente sobre "nenhuma referência".
    expect(folha).toContain(`<c r="C3"><v>0</v></c>`);
    expect(folha).toContain(`<dimension ref="A1:C3"/>`);
  });
});

describe("conteúdo hostil", () => {
  it("escapa o que quebraria o XML e remove caractere de controle", () => {
    const partes = abrirZip(
      gerarXlsx([
        {
          nome: "Removidos",
          cabecalho: ["Nome"],
          linhas: [[`Tampa <b> & "aspas" 'simples'`], [`quebralinha`]],
        },
      ]),
    );
    const folha = partes.get("xl/worksheets/sheet1.xml")!;
    expect(folha).toContain("Tampa &lt;b&gt; &amp; &quot;aspas&quot; &apos;simples&apos;");
    expect(folha).toContain("quebralinha");
    expect(folha).not.toContain("");
  });

  it("acento sobrevive à ida e volta pelo ZIP", () => {
    const partes = abrirZip(
      gerarXlsx([{ nome: "Revisão necessária", cabecalho: ["Nome"], linhas: [["Ácido nicotínico — maçã"]] }]),
    );
    expect(partes.get("xl/worksheets/sheet1.xml")!).toContain("Ácido nicotínico — maçã");
    expect(partes.get("xl/workbook.xml")!).toContain("Revisão necessária");
  });

  it("célula nula e vazia viram célula vazia, não a string 'null'", () => {
    const partes = abrirZip(gerarXlsx([{ nome: "X", cabecalho: ["a", "b", "c"], linhas: [[null, undefined, ""]] }]));
    const folha = partes.get("xl/worksheets/sheet1.xml")!;
    expect(folha).toContain(`<row r="2"><c r="A2"/><c r="B2"/><c r="C2"/></row>`);
    expect(folha).not.toContain("null");
  });
});

describe("o mesmo conteúdo gera o mesmo arquivo", () => {
  it("com a mesma data, byte a byte — o arquivo entra em diff sem ruído", () => {
    const quando = new Date("2026-09-17T12:00:00.000Z");
    expect(gerarXlsx([abaSimples], quando).equals(gerarXlsx([abaSimples], quando))).toBe(true);
  });
});
