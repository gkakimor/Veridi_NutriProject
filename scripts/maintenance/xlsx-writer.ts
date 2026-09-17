import { deflateRawSync } from "node:zlib";

/**
 * Gerador de `.xlsx` sem dependência (MASTER-DATA-DUPLICATE-SANITIZATION-01).
 *
 * O arquivo que a Veridi recebe é uma planilha, não um CSV, e o projeto não
 * tem — nem vai ganhar por causa disto — uma biblioteca de Excel. Um `.xlsx` é
 * um ZIP de XML; o mínimo que o Excel e o LibreOffice abrem são cinco partes,
 * e é isso que este arquivo escreve.
 *
 * Escopo deliberadamente pequeno:
 *
 *  - texto e número; data entra como texto ISO, que é o que um anexo de
 *    auditoria precisa ser (sem fuso implícito, sem serial do Excel);
 *  - `inlineStr` em vez de `sharedStrings`: uma parte a menos e nenhuma tabela
 *    de índices para manter em dia;
 *  - um estilo só, o negrito do cabeçalho.
 *
 * Sem fórmula, sem mesclagem, sem formatação condicional. Se um dia isso for
 * preciso, aí sim entra uma biblioteca.
 */

export type ValorDeCelula = string | number | null | undefined;

export interface AbaDaPlanilha {
  /** Nome da aba. Excel limita a 31 caracteres e proíbe `: \ / ? * [ ]`. */
  nome: string;
  /** Primeira linha, em negrito. */
  cabecalho: readonly string[];
  linhas: readonly (readonly ValorDeCelula[])[];
}

const PROIBIDOS_NO_NOME_DA_ABA = /[:\\/?*[\]]/g;

/** Nome de aba que o Excel aceita: sem caractere proibido e com 31 no máximo. */
export function nomeDeAbaValido(nome: string): string {
  const limpo = nome.replace(PROIBIDOS_NO_NOME_DA_ABA, " ").trim();
  return (limpo.length === 0 ? "Planilha" : limpo).slice(0, 31);
}

function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Controle fora de tab/LF/CR quebra o XML do Excel sem dizer por quê.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** `0` → `A`, `25` → `Z`, `26` → `AA`. */
export function colunaDoExcel(indice: number): string {
  let resto = indice;
  let nome = "";
  do {
    nome = String.fromCharCode(65 + (resto % 26)) + nome;
    resto = Math.floor(resto / 26) - 1;
  } while (resto >= 0);
  return nome;
}

function celula(ref: string, valor: ValorDeCelula, estilo: number): string {
  const s = estilo > 0 ? ` s="${estilo}"` : "";
  if (valor === null || valor === undefined || valor === "") return `<c r="${ref}"${s}/>`;
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return `<c r="${ref}"${s}><v>${valor}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escaparXml(String(valor))}</t></is></c>`;
}

function xmlDaAba(aba: AbaDaPlanilha): string {
  const linhas: string[] = [];
  const escrever = (valores: readonly ValorDeCelula[], numero: number, estilo: number): void => {
    const celulas = valores.map((valor, coluna) => celula(`${colunaDoExcel(coluna)}${numero}`, valor, estilo));
    linhas.push(`<row r="${numero}">${celulas.join("")}</row>`);
  };

  escrever(aba.cabecalho, 1, 1);
  aba.linhas.forEach((linha, indice) => escrever(linha, indice + 2, 0));

  const largura = Math.max(aba.cabecalho.length, ...aba.linhas.map((l) => l.length), 1);
  const dimensao = `A1:${colunaDoExcel(largura - 1)}${aba.linhas.length + 1}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dimensao}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><sheetData>${linhas.join("")}</sheetData></worksheet>`;
}

const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;

/** As cinco partes do pacote, no formato `caminho → conteúdo`. */
export function partesDaPlanilha(abas: readonly AbaDaPlanilha[]): Map<string, string> {
  if (abas.length === 0) throw new Error("Planilha sem aba.");
  const nomes = abas.map((aba) => nomeDeAbaValido(aba.nome));
  if (new Set(nomes).size !== nomes.length) {
    throw new Error(`Planilha com aba repetida: ${nomes.join(", ")}.`);
  }

  const partes = new Map<string, string>();
  const folhas = abas.map((_, i) => `sheet${i + 1}.xml`);

  partes.set(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${folhas
      .map(
        (folha) =>
          `<Override PartName="/xl/worksheets/${folha}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("")}</Types>`,
  );

  partes.set(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );

  partes.set(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nomes
      .map((nome, i) => `<sheet name="${escaparXml(nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
  );

  partes.set(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${folhas
      .map(
        (folha, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${folha}"/>`,
      )
      .join("")}<Relationship Id="rId${folhas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );

  partes.set("xl/styles.xml", ESTILOS);
  abas.forEach((aba, i) => partes.set(`xl/worksheets/${folhas[i]}`, xmlDaAba(aba)));
  return partes;
}

/* ------------------------------------------------------------------ *
 * ZIP
 * ------------------------------------------------------------------ */

const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[i] = c >>> 0;
  }
  return tabela;
})();

export function crc32(dados: Buffer): number {
  let c = 0xffffffff;
  for (const byte of dados) c = TABELA_CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Data/hora no formato MS-DOS que o cabeçalho do ZIP guarda. */
function dataDosZip(quando: Date): { hora: number; data: number } {
  const ano = Math.max(1980, quando.getFullYear());
  return {
    hora: (quando.getHours() << 11) | (quando.getMinutes() << 5) | (quando.getSeconds() >> 1),
    data: ((ano - 1980) << 9) | ((quando.getMonth() + 1) << 5) | quando.getDate(),
  };
}

/** Monta o ZIP (deflate) das partes, na ordem em que vieram. */
export function empacotarZip(partes: Map<string, string>, quando: Date = new Date()): Buffer {
  const { hora, data } = dataDosZip(quando);
  const locais: Buffer[] = [];
  const central: Buffer[] = [];
  let deslocamento = 0;

  for (const [caminho, conteudo] of partes) {
    const nome = Buffer.from(caminho, "utf8");
    const cru = Buffer.from(conteudo, "utf8");
    const comprimido = deflateRawSync(cru, { level: 9 });
    const crc = crc32(cru);

    const cabecalho = Buffer.alloc(30);
    cabecalho.writeUInt32LE(0x04034b50, 0);
    cabecalho.writeUInt16LE(20, 4);
    cabecalho.writeUInt16LE(0x0800, 6); // nome do arquivo em UTF-8
    cabecalho.writeUInt16LE(8, 8); // deflate
    cabecalho.writeUInt16LE(hora, 10);
    cabecalho.writeUInt16LE(data, 12);
    cabecalho.writeUInt32LE(crc, 14);
    cabecalho.writeUInt32LE(comprimido.length, 18);
    cabecalho.writeUInt32LE(cru.length, 22);
    cabecalho.writeUInt16LE(nome.length, 26);
    cabecalho.writeUInt16LE(0, 28);
    locais.push(cabecalho, nome, comprimido);

    const entrada = Buffer.alloc(46);
    entrada.writeUInt32LE(0x02014b50, 0);
    entrada.writeUInt16LE(20, 4);
    entrada.writeUInt16LE(20, 6);
    entrada.writeUInt16LE(0x0800, 8);
    entrada.writeUInt16LE(8, 10);
    entrada.writeUInt16LE(hora, 12);
    entrada.writeUInt16LE(data, 14);
    entrada.writeUInt32LE(crc, 16);
    entrada.writeUInt32LE(comprimido.length, 20);
    entrada.writeUInt32LE(cru.length, 24);
    entrada.writeUInt16LE(nome.length, 28);
    entrada.writeUInt32LE(0, 30); // extra + comentário
    entrada.writeUInt16LE(0, 34); // disco
    entrada.writeUInt16LE(0, 36); // atributos internos
    entrada.writeUInt32LE(0, 38); // atributos externos
    entrada.writeUInt32LE(deslocamento, 42);
    central.push(entrada, nome);

    deslocamento += cabecalho.length + nome.length + comprimido.length;
  }

  const diretorio = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(0, 4);
  fim.writeUInt16LE(0, 6);
  fim.writeUInt16LE(partes.size, 8);
  fim.writeUInt16LE(partes.size, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(deslocamento, 16);
  fim.writeUInt16LE(0, 20);

  return Buffer.concat([...locais, diretorio, fim]);
}

/** A planilha inteira, pronta para gravar. */
export function gerarXlsx(abas: readonly AbaDaPlanilha[], quando?: Date): Buffer {
  return empacotarZip(partesDaPlanilha(abas), quando);
}
