import { Prisma } from "@prisma/client";

/**
 * Geração de CSV do Veridi.
 *
 * Formato pensado para abrir corretamente no Excel/LibreOffice brasileiro:
 * UTF-8 **com BOM**, separador `;`, quebra de linha CRLF, cabeçalhos em
 * português, datas e decimais em pt-BR.
 *
 * O CSV nunca é uma nova fonte de verdade: ele é sempre uma representação
 * do MESMO read model que a tela usa, com os MESMOS filtros.
 */

const BOM = "﻿";
const SEPARATOR = ";";
const LINE_BREAK = "\r\n";

/** Caracteres que fazem uma planilha interpretar o texto como fórmula. */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Neutraliza CSV/Spreadsheet Formula Injection: um valor digitado pelo
 * usuário começando por `=`, `+`, `-` ou `@` não pode virar fórmula
 * executável ao abrir a planilha. Só a REPRESENTAÇÃO exportada muda — o
 * valor persistido nunca é alterado.
 */
export function sanitizeCsvValue(value: string): string {
  if (value.length === 0) return value;
  return FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix)) ? `'${value}` : value;
}

/** Escapa separador, aspas e quebras de linha conforme RFC 4180. */
function escapeCell(value: string): string {
  const needsQuotes =
    value.includes(SEPARATOR) || value.includes('"') || value.includes("\n") || value.includes("\r");
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

export interface CsvColumn<TRow> {
  header: string;
  value: (row: TRow) => string;
}

/** Texto livre — sanitizado contra fórmula. `null` vira célula vazia. */
export function csvText(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return sanitizeCsvValue(String(value));
}

/**
 * Código de negócio (PED-000001, LT-…, CNPJ, código de barras). Sempre
 * texto: nunca é substituído por UUID técnico nem convertido em número.
 */
export function csvCode(value: string | null | undefined): string {
  return csvText(value);
}

export function csvDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("pt-BR");
}

export function csvDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("pt-BR");
}

/**
 * Decimal em pt-BR (vírgula decimal). A conversão passa por
 * `Prisma.Decimal`, nunca por float do JS — `19.000000` nunca vira
 * `18,999999999`. Valor desconhecido é célula VAZIA, nunca `0`.
 */
export function csvDecimal(
  value: string | number | Prisma.Decimal | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "";
  // Inteiros de cadastro (doses, meses, unidades) também passam por aqui —
  // convertidos para texto sem virar notação/float.
  if (typeof value === "number") return String(value);
  const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  return decimal.toString().replace(".", ",");
}

/**
 * TOTAL em dinheiro: mesma regra do decimal, com duas casas. Desconhecido =
 * vazio. Só para valor já somado — para preço unitário use `csvUnitPrice`.
 */
export function csvMoney(value: string | Prisma.Decimal | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  return decimal.toFixed(2).replace(".", ",");
}

/**
 * PREÇO UNITÁRIO: de 2 a 4 casas, conforme o preço.
 *
 * As colunas de preço unitário são `Decimal(14,4)`. Exportá-las por
 * `csvMoney` transformava `4,0531` em `4,05` sem aviso — a planilha do
 * operador passava a discordar do documento, e a diferença aparecia como
 * erro de conta em vez de perda de precisão na exportação.
 *
 * Duas casas continuam sendo o piso, para que a coluna leia como dinheiro no
 * caso comum; as casas extras só aparecem quando existem de fato.
 */
export function csvUnitPrice(value: string | Prisma.Decimal | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  const quatroCasas = decimal.toFixed(4).replace(/(\.\d\d)0+$/, "$1");
  return quatroCasas.replace(".", ",");
}

export function csvBoolean(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value ? "Sim" : "Não";
}

export function buildCsv<TRow>(columns: CsvColumn<TRow>[], rows: TRow[]): string {
  const header = columns.map((column) => escapeCell(column.header)).join(SEPARATOR);
  const body = rows.map((row) =>
    columns.map((column) => escapeCell(column.value(row))).join(SEPARATOR),
  );
  return BOM + [header, ...body].join(LINE_BREAK) + LINE_BREAK;
}

/**
 * Nome de arquivo legível e determinístico — nunca UUID.
 * Ex.: `veridi_movimentacoes_2026-08-01_2026-08-16.csv`.
 */
export function csvFileName(slug: string, period?: { from?: Date; to?: Date }): string {
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  if (period?.from && period.to) {
    return `veridi_${slug}_${iso(period.from)}_${iso(period.to)}.csv`;
  }
  return `veridi_${slug}_${iso(new Date())}.csv`;
}
