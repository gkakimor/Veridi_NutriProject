import type { FindingSink } from "./corpus.js";
import { cleanText, readCorpusCsv } from "./corpus.js";

/**
 * Leitura do pipeline comercial histórico (`projetos.csv` +
 * `dominios_pipeline.csv`).
 *
 * Fato importante do corpus: o export NÃO traz status nem motivo de
 * cancelamento por linha — esses valores existem apenas como vocabulário em
 * `dominios_pipeline.csv`. Nada aqui adivinha o estágio de um projeto: a
 * importação registra o projeto e emite um finding dizendo que o pipeline
 * histórico precisa ser reconciliado com o Product Owner.
 */

export interface LegacyProjectRow {
  entryDate: Date | null;
  channel: string | null;
  customerExternalCode: string;
  customerLegalName: string | null;
  productExternalCode: string;
  productName: string;
  quoteExternalCode: string | null;
  notes: string | null;
}

/** Vocabulário oficial do pipeline, para conferência — não é importado. */
export interface PipelineVocabulary {
  concepts: string[];
  channels: string[];
  statuses: string[];
  cancelReasons: string[];
}

/** Mapa do vocabulário legado para os enums do sistema. */
export const LEGACY_STATUS_MAP: Record<string, string> = {
  AGUARDANDO: "WAITING",
  AMOSTRA: "SAMPLE",
  APROVADO: "APPROVED",
  CANCELADO: "CANCELLED",
  "STAND-BY": "STAND_BY",
};

export const LEGACY_CANCEL_REASON_MAP: Record<string, string> = {
  "PREÇO": "PRICE",
  CONCORRENTE: "COMPETITOR",
  "MUDOU PROJ": "PROJECT_CHANGED",
  "NÃO ATENDEU": "NOT_MET",
};

function parseDate(value: string | undefined): Date | null {
  const text = cleanText(value);
  if (!text) return null;
  const parsed = new Date(`${text}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function readPipelineVocabulary(): PipelineVocabulary {
  const rows = readCorpusCsv("dominios_pipeline.csv").rows;
  const pick = (domain: string): string[] =>
    rows
      .filter((row) => cleanText(row["dominio"]) === domain)
      .map((row) => cleanText(row["valor"]))
      .filter((value): value is string => value !== null)
      .sort();

  return {
    concepts: pick("conceito_produto"),
    channels: pick("canal_cliente"),
    statuses: pick("status_projeto"),
    cancelReasons: pick("motivo_cancelamento"),
  };
}

export function readLegacyProjectRows(findings: FindingSink): LegacyProjectRow[] {
  const rows = readCorpusCsv("projetos.csv").rows;
  const result: LegacyProjectRow[] = [];

  for (const row of rows) {
    const customerExternalCode = cleanText(row["cod_cliente"]);
    const productExternalCode = cleanText(row["cod_produto"]);
    const productName = cleanText(row["produto"]);

    if (!customerExternalCode) {
      findings.add(
        "PROJECT_WITHOUT_CUSTOMER",
        "Project",
        productExternalCode ?? "(sem código)",
        "linha sem código de cliente — projeto private label exige cliente",
      );
      continue;
    }
    if (!productExternalCode) {
      findings.add(
        "PROJECT_WITHOUT_CODE",
        "Project",
        customerExternalCode,
        "linha sem cod_produto — não há chave estável para o projeto",
      );
      continue;
    }

    result.push({
      entryDate: parseDate(row["data_entrada"]),
      channel: cleanText(row["canal_cliente"]),
      customerExternalCode,
      customerLegalName: cleanText(row["razao_social"]),
      productExternalCode,
      productName: productName ?? productExternalCode,
      quoteExternalCode: cleanText(row["cod_orcamento"]),
      notes: cleanText(row["observacao"]),
    });
  }

  return result;
}

export interface LegacyProjectGroup {
  key: string;
  customerExternalCode: string;
  productExternalCode: string;
  rows: LegacyProjectRow[];
}

/**
 * Agrupa por (cliente, cod_produto) — a chave candidata do projeto
 * histórico. O MESMO `cod_produto` aparecendo em clientes diferentes nunca
 * é mesclado: vira finding, porque não há evidência de que seja o mesmo
 * projeto.
 */
export function groupLegacyProjects(
  rows: LegacyProjectRow[],
  findings: FindingSink,
): Map<string, LegacyProjectGroup> {
  const groups = new Map<string, LegacyProjectGroup>();
  const customersByProductCode = new Map<string, Set<string>>();

  for (const row of rows) {
    const key = `${row.customerExternalCode}::${row.productExternalCode}`;
    const group = groups.get(key) ?? {
      key,
      customerExternalCode: row.customerExternalCode,
      productExternalCode: row.productExternalCode,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);

    const customers = customersByProductCode.get(row.productExternalCode) ?? new Set<string>();
    customers.add(row.customerExternalCode);
    customersByProductCode.set(row.productExternalCode, customers);
  }

  for (const [productCode, customers] of customersByProductCode) {
    if (customers.size > 1) {
      findings.add(
        "PROJECT_CODE_ACROSS_CUSTOMERS",
        "Project",
        productCode,
        `mesmo cod_produto em ${customers.size} clientes — projetos NÃO foram mesclados`,
      );
    }
  }

  return groups;
}

/**
 * Versões de orçamento histórico a partir de `cod_orcamento` (V1, V2...).
 * O corpus não traz preço, quantidade nem evidência de envio — por isso
 * essas versões entram como HISTÓRICO (`ARCHIVED`), nunca como enviadas ou
 * aceitas.
 */
export function legacyQuoteVersions(group: LegacyProjectGroup): { externalCode: string; versionNumber: number }[] {
  const codes = new Set<string>();
  for (const row of group.rows) {
    if (row.quoteExternalCode) codes.add(row.quoteExternalCode.toUpperCase());
  }

  return [...codes]
    .map((code) => {
      const match = /^V(\d+)$/.exec(code);
      return { externalCode: code, versionNumber: match ? Number(match[1]) : Number.NaN };
    })
    .filter((version) => Number.isFinite(version.versionNumber))
    .sort((a, b) => a.versionNumber - b.versionNumber);
}
