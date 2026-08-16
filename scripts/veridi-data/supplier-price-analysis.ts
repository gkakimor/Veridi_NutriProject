import { Prisma as PrismaNamespace } from "@prisma/client";
import { createHash } from "node:crypto";
import { FindingLog, cleanText, readCorpusCsv, safeDecimal } from "./corpus.js";

/**
 * Leitura de `precos_fornecedores.csv` — preços de fornecedor do histórico.
 *
 * Fatos do corpus que decidem o desenho da importação:
 * - o header do preço é `preco_brl_kg`: moeda BRL e preço POR QUILO. Não há
 *   coluna de moeda nem de unidade alternativa;
 * - **não existe data** de cotação/vigência em lugar nenhum. Portanto toda
 *   oferta legada entra com `effectiveAt = null` (observação histórica) e
 *   nunca vira preço vigente — usar a data de extração seria inventar
 *   vigência;
 * - `homologado` só aparece como "SIM"; ausência é desconhecimento, nunca
 *   bloqueio;
 * - `melhor_preco` é um indicador de snapshot de CMV, NÃO fornecedor
 *   preferencial oficial: é apenas contabilizado, jamais importado como
 *   `preferred`;
 * - o mesmo par item+fornecedor aparece várias vezes com preços diferentes.
 *   Cada observação é preservada como uma oferta própria.
 */

export interface LegacySupplierPriceRow {
  /** Índice da linha no arquivo (1-based, sem cabeçalho) — só para diagnóstico. */
  lineNumber: number;
  itemExternalCode: string;
  supplierName: string;
  sourceName: string | null;
  nutrient: string | null;
  rawPrice: string;
  price: PrismaNamespace.Decimal | null;
  rawMinimumOrder: string | null;
  qualified: boolean;
  bestPriceFlag: boolean;
}

export interface ParsedMinimumOrder {
  quantity: PrismaNamespace.Decimal;
  /** `null` quando o número veio sem unidade: assume-se a unidade do item. */
  uomCode: string | null;
}

/** Sufixos aceitos no MOQ, mapeados para o registro de UOM do sistema. */
const MOQ_UNIT_ALIASES: Record<string, string> = {
  MG: "mg",
  G: "g",
  KG: "kg",
  UN: "un",
  UNI: "un",
  UNID: "un",
  ML: "mL",
  L: "L",
};

/**
 * Parser conservador de pedido mínimo.
 *
 * Aceita `25`, `0.25`, `500G`, `1 KG`, `1000UNI`. Recusa qualquer coisa que
 * exija interpretação (`1mil`, `KG`, `-`): nesses casos devolve `null` e a
 * oferta é criada SEM MOQ estruturado, com o valor original registrado em
 * finding. Inventar 1000 a partir de "1mil" seria adivinhar quantidade de
 * compra.
 */
export function parseMinimumOrder(raw: string | null): ParsedMinimumOrder | null {
  const text = cleanText(raw);
  if (!text) return null;

  const match = /^(\d+(?:[.,]\d+)?)\s*([A-Za-z]*)$/.exec(text);
  if (!match) return null;

  const quantity = safeDecimal(match[1]!.replace(",", "."));
  if (!quantity || quantity.lessThanOrEqualTo(0)) return null;

  const suffix = (match[2] ?? "").toUpperCase();
  if (suffix.length === 0) return { quantity, uomCode: null };

  const uomCode = MOQ_UNIT_ALIASES[suffix];
  return uomCode ? { quantity, uomCode } : null;
}

function isAffirmative(value: string | null): boolean {
  return value !== null && ["SIM", "S", "OK", "TRUE", "1"].includes(value.toUpperCase());
}

export function readLegacySupplierPriceRows(findings: FindingLog): LegacySupplierPriceRow[] {
  const rows = readCorpusCsv("precos_fornecedores.csv").rows;
  const result: LegacySupplierPriceRow[] = [];

  rows.forEach((row, index) => {
    const lineNumber = index + 1;
    const itemExternalCode = cleanText(row["cod_item"]);
    const supplierName = cleanText(row["fornecedor"]);

    if (!itemExternalCode) {
      findings.add(
        "SUPPLIER_PRICE_WITHOUT_ITEM",
        "SupplierItem",
        `linha ${lineNumber}`,
        "linha sem cod_item — não há como saber de que item é o preço",
      );
      return;
    }
    if (!supplierName) {
      findings.add(
        "SUPPLIER_PRICE_WITHOUT_SUPPLIER",
        "SupplierItem",
        itemExternalCode,
        "linha sem fornecedor — relação não pode ser criada",
      );
      return;
    }

    const rawPrice = cleanText(row["preco_brl_kg"]) ?? "";
    result.push({
      lineNumber,
      itemExternalCode,
      supplierName,
      sourceName: cleanText(row["materia_prima_fonte"]),
      nutrient: cleanText(row["nutriente"]),
      rawPrice,
      price: safeDecimal(rawPrice),
      rawMinimumOrder: cleanText(row["pedido_minimo"]),
      qualified: isAffirmative(cleanText(row["homologado"])),
      bestPriceFlag: isAffirmative(cleanText(row["melhor_preco"])),
    });
  });

  return result;
}

/** Normalização usada só para casar nome de fornecedor — nunca fuzzy match. */
export function normalizeSupplierName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * Chave estável da observação legada — idempotência do importador.
 *
 * Deriva do CONTEÚDO (item, fornecedor, preço, MOQ original), nunca do
 * número da linha: reordenar a planilha não pode duplicar ofertas. Linhas
 * legadas idênticas colapsam de propósito — são a mesma observação.
 */
export function legacyOfferSourceKey(row: LegacySupplierPriceRow): string {
  const payload = [
    "precos_fornecedores",
    row.itemExternalCode,
    normalizeSupplierName(row.supplierName),
    row.rawPrice,
    row.rawMinimumOrder ?? "",
  ].join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}
