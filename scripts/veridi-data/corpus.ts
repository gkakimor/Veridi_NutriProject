import { Prisma as PrismaNamespace } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

/**
 * Leitura do corpus real da Veridi (CSVs extraídos das planilhas).
 *
 * Os arquivos ficam FORA do repositório (`.local-data/`, no `.gitignore`):
 * contêm clientes, CNPJ, fornecedores, formulações e preços reais. Nada
 * disso pode ser versionado.
 */

export const CORPUS_DIR =
  process.env["VERIDI_CORPUS_DIR"] ??
  path.resolve(process.cwd(), "..", ".local-data", "veridi", "csv");

export function corpusAvailable(): boolean {
  return fs.existsSync(CORPUS_DIR);
}

/** Parser CSV mínimo (RFC 4180): aspas, vírgula e quebras dentro da célula. */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const text = content.replace(/^﻿/, "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export interface CsvFile {
  name: string;
  header: string[];
  rows: Record<string, string>[];
}

/** Lê um CSV do corpus com cabeçalho — falha se o arquivo/estrutura sumir. */
export function readCorpusCsv(fileName: string): CsvFile {
  const full = path.join(CORPUS_DIR, fileName);
  if (!fs.existsSync(full)) {
    throw new Error(`Arquivo do corpus ausente: ${fileName} (${CORPUS_DIR})`);
  }

  const parsed = parseCsv(fs.readFileSync(full, "utf8"));
  const [header, ...body] = parsed;
  if (!header || header.length === 0) {
    throw new Error(`Cabeçalho inválido em ${fileName}`);
  }

  const rows = body
    .filter((cells) => cells.some((cell) => cell.trim().length > 0))
    .map((cells) => {
      const record: Record<string, string> = {};
      header.forEach((column, index) => {
        record[column.trim()] = (cells[index] ?? "").trim();
      });
      return record;
    });

  return { name: fileName, header: header.map((column) => column.trim()), rows };
}

/** Achado de qualidade — nunca derruba o processo, sempre é reportado. */
export interface Finding {
  code: string;
  entity: string;
  reference: string;
  detail: string;
}

/**
 * Receptor de findings. A analise so precisa registrar; quem consome pode
 * ser o log simples do harness ou o log com severidade da migracao
 * (capacidade 41) — nenhum modulo de analise conhece a diferenca.
 */
export interface FindingSink {
  add(code: string, entity: string, reference: string, detail: string): void;
}

export class FindingLog implements FindingSink {
  private readonly items: Finding[] = [];

  add(code: string, entity: string, reference: string, detail: string): void {
    this.items.push({ code, entity, reference, detail });
  }

  all(): readonly Finding[] {
    return this.items;
  }

  countByCode(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const finding of this.items) {
      counts.set(finding.code, (counts.get(finding.code) ?? 0) + 1);
    }
    return counts;
  }

  print(limitPerCode = 5): void {
    const counts = this.countByCode();
    if (counts.size === 0) {
      console.log("\nNenhum finding de qualidade.");
      return;
    }
    console.log("\nFINDINGS");
    for (const [code, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${code}: ${count}`);
      const examples = this.items.filter((finding) => finding.code === code).slice(0, limitPerCode);
      for (const example of examples) {
        console.log(`      ${example.entity} ${example.reference} — ${example.detail}`);
      }
      if (count > limitPerCode) console.log(`      … +${count - limitPerCode}`);
    }
  }
}

/** Normaliza texto do legado: espaços duplicados e caixa preservada. */
export function cleanText(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Decimal tolerante ao legado: a planilha exporta erros do Excel
 * (`#VALUE!`, `#DIV/0!`) e campos vazios. Nada disso pode derrubar a
 * análise — vira `null` e, quando relevante, um finding.
 */
export function safeDecimal(value: string | undefined): import("@prisma/client").Prisma.Decimal | null {
  const text = value?.trim();
  if (!text || text.startsWith("#")) return null;
  try {
    return new PrismaNamespace.Decimal(text);
  } catch {
    return null;
  }
}

/** CNPJ só com dígitos; validação real fica com o dígito verificador. */
export function digitsOnly(value: string | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length === 0 ? null : digits;
}

/** Validação de CNPJ pelos dígitos verificadores — nunca "corrige" o valor. */
export function isValidCnpj(cnpj: string): boolean {
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const digit = (slice: string, weights: number[]): number => {
    const sum = slice
      .split("")
      .reduce((total, char, index) => total + Number(char) * weights[index]!, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const first = digit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = digit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return Number(cnpj[12]) === first && Number(cnpj[13]) === second;
}
