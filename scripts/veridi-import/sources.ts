import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CORPUS_DIR, parseCsv } from "../veridi-data/corpus.js";

/**
 * Fonte da migração: os CSVs reais da Veridi.
 *
 * O manifesto guarda SHA-256 de cada arquivo. O APPLY recalcula os hashes e
 * recusa aplicar um plano gerado sobre uma fonte diferente — aplicar plano
 * velho em planilha nova é a forma clássica de importar coisa errada com
 * confiança total.
 */

/** Arquivos que a migração lê. `imported=false` = validado, nunca persistido. */
export const SOURCE_FILES: { name: string; imported: boolean; note: string }[] = [
  { name: "fornecedores.csv", imported: true, note: "Fornecedores" },
  { name: "clientes.csv", imported: true, note: "Clientes" },
  { name: "itens.csv", imported: true, note: "Itens" },
  { name: "itens_enriquecimento.csv", imported: true, note: "Enriquecimento dos itens" },
  { name: "formulacoes.csv", imported: true, note: "Formulações e produtos" },
  { name: "projetos.csv", imported: true, note: "Projetos e orçamentos legados" },
  { name: "dominios_pipeline.csv", imported: false, note: "Vocabulário do pipeline (conferência)" },
  { name: "amostras.csv", imported: true, note: "Amostras (só as resolvíveis)" },
  { name: "precos_fornecedores.csv", imported: true, note: "Item × Fornecedor e ofertas" },
  {
    name: "estoque_saldos.csv",
    imported: false,
    note: "Saldos legados — viram template de abertura, nunca movimento automático",
  },
  {
    name: "compras_recebimentos.csv",
    imported: false,
    note: "Histórico de compras — EXCLUDED_BY_POLICY (ver runbook)",
  },
  { name: "cmv_produtos.csv", imported: false, note: "CMV — adiado para o Bloco G" },
  { name: "cmv_componentes.csv", imported: false, note: "CMV — adiado para o Bloco G" },
  { name: "cmv_precificacao.csv", imported: false, note: "CMV — adiado para o Bloco G" },
  { name: "in28_limites.csv", imported: false, note: "IN28 — adiado para o Bloco H (gate)" },
];

export interface SourceFileManifest {
  name: string;
  imported: boolean;
  note: string;
  present: boolean;
  sha256: string | null;
  sizeBytes: number | null;
  rowCount: number | null;
}

export const OUT_DIR = path.resolve(CORPUS_DIR, "..", "out");
export const OVERRIDES_DIR = path.resolve(CORPUS_DIR, "..", "overrides");
export const PLAN_FILE = path.join(OUT_DIR, "import-plan.json");

export function ensureOutputDirs(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(OVERRIDES_DIR, { recursive: true });
}

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function buildSourceManifest(): SourceFileManifest[] {
  return SOURCE_FILES.map((file) => {
    const full = path.join(CORPUS_DIR, file.name);
    if (!fs.existsSync(full)) {
      return { ...file, present: false, sha256: null, sizeBytes: null, rowCount: null };
    }
    const content = fs.readFileSync(full, "utf8");
    const parsed = parseCsv(content);
    return {
      ...file,
      present: true,
      sha256: sha256(full),
      sizeBytes: fs.statSync(full).size,
      // Sem o cabeçalho — é a contagem que o relatório compara.
      rowCount: Math.max(parsed.length - 1, 0),
    };
  });
}

/** Diferenças entre o manifesto do plano e a fonte atual. Vazio = idêntico. */
export function diffManifests(
  planned: SourceFileManifest[],
  current: SourceFileManifest[],
): string[] {
  const differences: string[] = [];
  const currentByName = new Map(current.map((file) => [file.name, file]));

  for (const file of planned) {
    const now = currentByName.get(file.name);
    if (!now) {
      differences.push(`${file.name}: ausente na execução atual`);
      continue;
    }
    if (file.present !== now.present) {
      differences.push(`${file.name}: presença mudou (${file.present} → ${now.present})`);
      continue;
    }
    if (file.sha256 !== now.sha256) {
      differences.push(`${file.name}: conteúdo mudou desde o PLAN`);
    }
  }
  return differences;
}

/** Escreve CSV local (`.local-data`) — nunca versionado, nunca público. */
export function writeCsv(
  filePath: string,
  header: string[],
  rows: (string | null)[][],
): void {
  const cell = (value: string | null): string => {
    const text = value ?? "";
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const content = [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  fs.writeFileSync(filePath, `${content}\r\n`, "utf8");
}
