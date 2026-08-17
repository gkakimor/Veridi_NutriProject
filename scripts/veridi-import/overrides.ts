import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "../veridi-data/corpus.js";
import { OVERRIDES_DIR, writeCsv } from "./sources.js";

/**
 * Decisões humanas sobre dados legados ambíguos.
 *
 * Overrides existem justamente porque o importador NÃO adivinha. São
 * arquivos CSV simples em `.local-data/veridi/overrides/` (fora do
 * repositório): sem tela, sem banco, sem estado escondido — a decisão fica
 * legível e revisável em texto.
 *
 * Nenhum override cria master data: o máximo que fazem é apontar para algo
 * que já existe (`MAP`) ou mandar ignorar (`IGNORE`).
 */

export const ITEM_MAP_FILE = "item-map-overrides.csv";
export const PRICE_UOM_FILE = "supplier-price-uom-overrides.csv";
export const SAMPLE_FILE = "sample-project-overrides.csv";

function readOverrideCsv(fileName: string): Record<string, string>[] {
  const full = path.join(OVERRIDES_DIR, fileName);
  if (!fs.existsSync(full)) return [];

  const parsed = parseCsv(fs.readFileSync(full, "utf8"));
  const [header, ...body] = parsed;
  if (!header) return [];

  return body
    .filter((cells) => cells.some((cell) => cell.trim().length > 0))
    .map((cells) => {
      const record: Record<string, string> = {};
      header.forEach((column, index) => {
        record[column.trim()] = (cells[index] ?? "").trim();
      });
      return record;
    });
}

export interface ItemMapOverride {
  legacyItemCode: string;
  action: "MAP" | "IGNORE";
  /** Código interno (MP-…/ME-…) do Item existente. Obrigatório em `MAP`. */
  targetItemCode: string | null;
  note: string | null;
}

export interface PriceUomOverride {
  sourceKey: string;
  action: "MAP_UOM" | "IGNORE_PRICE";
  /** Unidade a que o preço legado realmente se refere. Obrigatório em `MAP_UOM`. */
  overridePriceUom: string | null;
  note: string | null;
}

export interface SampleOverride {
  legacySample: string;
  action: "MAP" | "IGNORE";
  /** Código do projeto (PROJ-…) existente. Obrigatório em `MAP`. */
  targetProjectCode: string | null;
  note: string | null;
}

export interface Overrides {
  items: Map<string, ItemMapOverride>;
  priceUoms: Map<string, PriceUomOverride>;
  samples: Map<string, SampleOverride>;
}

function normalizeAction(value: string | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

export function readOverrides(): Overrides {
  const items = new Map<string, ItemMapOverride>();
  for (const row of readOverrideCsv(ITEM_MAP_FILE)) {
    const legacyItemCode = row["legacy_item_code"]?.trim();
    const action = normalizeAction(row["action"]);
    if (!legacyItemCode || (action !== "MAP" && action !== "IGNORE")) continue;
    items.set(legacyItemCode, {
      legacyItemCode,
      action,
      targetItemCode: row["target_item_code"]?.trim() || null,
      note: row["note"]?.trim() || null,
    });
  }

  const priceUoms = new Map<string, PriceUomOverride>();
  for (const row of readOverrideCsv(PRICE_UOM_FILE)) {
    const sourceKey = row["sourceKey"]?.trim();
    const action = normalizeAction(row["action"]);
    if (!sourceKey || (action !== "MAP_UOM" && action !== "IGNORE_PRICE")) continue;
    priceUoms.set(sourceKey, {
      sourceKey,
      action,
      overridePriceUom: row["overridePriceUom"]?.trim() || null,
      note: row["note"]?.trim() || null,
    });
  }

  const samples = new Map<string, SampleOverride>();
  for (const row of readOverrideCsv(SAMPLE_FILE)) {
    const legacySample = row["legacySample"]?.trim();
    const action = normalizeAction(row["action"]);
    if (!legacySample || (action !== "MAP" && action !== "IGNORE")) continue;
    samples.set(legacySample, {
      legacySample,
      action,
      targetProjectCode: row["targetProjectCode"]?.trim() || null,
      note: row["note"]?.trim() || null,
    });
  }

  return { items, priceUoms, samples };
}

/**
 * Escreve o template de override quando ele ainda não existe. Nunca
 * sobrescreve: o arquivo pode já conter decisões humanas.
 */
export function writeOverrideTemplate(
  fileName: string,
  header: string[],
  rows: (string | null)[][],
): { written: boolean; filePath: string } {
  const filePath = path.join(OVERRIDES_DIR, fileName);
  if (fs.existsSync(filePath)) return { written: false, filePath };
  writeCsv(filePath, header, rows);
  return { written: true, filePath };
}
