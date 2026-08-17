import type { FindingSink } from "./corpus.js";
import { cleanText, readCorpusCsv } from "./corpus.js";

/**
 * Leitura das amostras históricas (`amostras.csv`).
 *
 * Fato central do corpus: o export NÃO traz código de cliente nem código de
 * produto/projeto — só um número interno de amostra, a série, um texto
 * livre de descrição e (às vezes) o número do teste. Ou seja, NÃO existe
 * chave para ligar a amostra ao projeto.
 *
 * A única ligação aceita aqui é a igualdade EXATA (normalizada) entre a
 * descrição da amostra, sem o sufixo `Tn`, e o nome de um único projeto
 * histórico. Qualquer coisa além disso — prefixo, semelhança, "parece o
 * mesmo produto" — seria adivinhação: vira finding, não importação.
 */

export interface LegacySampleRow {
  /** `lote_interno` da planilha — a chave estável do de-para. */
  externalCode: string;
  series: string | null;
  description: string | null;
  /** Nome do produto sem o sufixo `Tn`, base da resolução por nome. */
  descriptionBase: string | null;
  /** Tn preservado do legado; `null` quando o export não traz. */
  testSequence: number | null;
}

/** Normalização para comparação: sem acento, sem pontuação, caixa alta. */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** Remove o sufixo de teste (`… T6`, `… T`) do texto da descrição. */
function stripTestSuffix(description: string): string {
  return description.replace(/\s*T\s*\d*\s*$/i, "").trim();
}

function parseTestSequence(row: Record<string, string>): number | null {
  const explicit = cleanText(row["numero_teste"]);
  if (explicit && /^\d+$/.test(explicit)) return Number(explicit);

  // Fallback: o Tn escrito no próprio texto ("… BLISS T6").
  const description = cleanText(row["descricao"]);
  const match = description ? /\bT\s*(\d+)\s*$/i.exec(description) : null;
  return match ? Number(match[1]) : null;
}

export function readLegacySampleRows(findings: FindingSink): LegacySampleRow[] {
  const rows = readCorpusCsv("amostras.csv").rows;
  const result: LegacySampleRow[] = [];

  for (const row of rows) {
    const externalCode = cleanText(row["lote_interno"]);
    if (!externalCode) {
      findings.add(
        "SAMPLE_WITHOUT_CODE",
        "ProjectSample",
        "(sem lote_interno)",
        "linha sem número interno — não há chave estável para a amostra",
      );
      continue;
    }

    const description = cleanText(row["descricao"]);
    if (!description) {
      findings.add(
        "SAMPLE_WITHOUT_DESCRIPTION",
        "ProjectSample",
        externalCode,
        "linha sem descrição — impossível saber a que projeto pertence",
      );
    }

    result.push({
      externalCode,
      series: cleanText(row["serie"]),
      description,
      descriptionBase: description ? stripTestSuffix(description) : null,
      testSequence: parseTestSequence(row),
    });
  }

  return result;
}

export interface SampleResolution {
  row: LegacySampleRow;
  /** `null` quando a amostra não pôde ser ligada a um projeto sem adivinhar. */
  projectId: string | null;
  reason: "RESOLVED" | "NO_DESCRIPTION" | "NO_MATCH" | "AMBIGUOUS" | "NO_TEST_SEQUENCE";
}

/**
 * Resolve amostra → projeto por igualdade exata de nome normalizado.
 *
 * `projectsByName` mapeia nome normalizado do projeto para os ids que o
 * usam. Mais de um id com o mesmo nome = ambíguo: nenhuma escolha é feita.
 */
export function resolveSamples(
  rows: readonly LegacySampleRow[],
  projectsByName: ReadonlyMap<string, string[]>,
  findings: FindingSink,
): SampleResolution[] {
  return rows.map((row): SampleResolution => {
    if (!row.descriptionBase) {
      return { row, projectId: null, reason: "NO_DESCRIPTION" };
    }

    // Sem Tn não há como preservar a numeração histórica do teste, e
    // inventar um número reescreveria o histórico de desenvolvimento.
    if (row.testSequence === null) {
      findings.add(
        "SAMPLE_WITHOUT_TEST_NUMBER",
        "ProjectSample",
        row.externalCode,
        "export sem número do teste — Tn histórico não pode ser inventado",
      );
      return { row, projectId: null, reason: "NO_TEST_SEQUENCE" };
    }

    const candidates = projectsByName.get(normalizeName(row.descriptionBase)) ?? [];
    if (candidates.length === 0) {
      findings.add(
        "SAMPLE_PROJECT_UNRESOLVED",
        "ProjectSample",
        row.externalCode,
        `nenhum projeto com o nome "${row.descriptionBase}" — amostra não importada`,
      );
      return { row, projectId: null, reason: "NO_MATCH" };
    }
    if (candidates.length > 1) {
      findings.add(
        "SAMPLE_PROJECT_AMBIGUOUS",
        "ProjectSample",
        row.externalCode,
        `${candidates.length} projetos com o mesmo nome — amostra não importada`,
      );
      return { row, projectId: null, reason: "AMBIGUOUS" };
    }

    return { row, projectId: candidates[0]!, reason: "RESOLVED" };
  });
}
