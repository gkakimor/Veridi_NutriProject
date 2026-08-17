import { Prisma } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import type { FindingSink } from "../veridi-data/corpus.js";
import { CORPUS_DIR, cleanText, readCorpusCsv, safeDecimal } from "../veridi-data/corpus.js";

/**
 * Precificação histórica (capacidade 46) — SOMENTE LEITURA.
 *
 * A planilha traz faixas de quantidade, preço, margem e comissão por
 * produto. Nada disso vira `PricingVersion`: o custo unitário exportado é
 * comprovadamente não confiável (capacidade 45), e preço sem custo confiável
 * não pode ser reconstruído nem conferido. O que este módulo faz é
 * DESCREVER o que existe e apontar o que impede a importação.
 */

export interface PricingBandObservation {
  file: string;
  quantity: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  marginPercent: Prisma.Decimal | null;
  commissionPercent: Prisma.Decimal | null;
}

export interface PricingCorpusAnalysis {
  rows: number;
  files: number;
  withQuantity: number;
  withPrice: number;
  withMargin: number;
  withCommission: number;
  duplicateQuantities: number;
  invalidDecimals: number;
  filesWithThreeBands: number;
  priceDecreasingFiles: number;
  priceNonMonotonicFiles: number;
  constantCommissionFiles: number;
  varyingCommissionFiles: number;
  resolvedProducts: number;
  unresolvedProducts: number;
}

const OVERRIDE_FILE = "cmv-product-overrides.csv";

/**
 * Template LOCAL de mapeamento produto legado → produto do sistema.
 *
 * Fica em `.local-data/` (fora do repositório, como todo dado real) e é
 * criado vazio quando não existe. Mapear é decisão humana: nada aqui casa
 * nome por aproximação.
 */
export function ensureProductOverrideTemplate(): { path: string; mapped: number } {
  const filePath = path.join(CORPUS_DIR, "..", OVERRIDE_FILE);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      "legacyProduct,legacyDescription,action,targetProductCode,note\n",
      "utf8",
    );
    return { path: filePath, mapped: 0 };
  }

  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim().length > 0);
  const mapped = lines.filter((line) => line.split(",")[2]?.trim().toUpperCase() === "MAP").length;
  return { path: filePath, mapped };
}

/**
 * Estatística da precificação legada + findings de escopo.
 *
 * A verificação de monotonicidade de preço e de constância da comissão é
 * OBSERVAÇÃO: preço que sobe com a quantidade pode ser erro de planilha ou
 * condição comercial real — quem decide é gente.
 */
export function analyzePricingCorpus(
  findings: FindingSink,
  resolution: { resolved: number; unresolved: number },
): PricingCorpusAnalysis {
  const rows = readCorpusCsv("cmv_precificacao.csv").rows;
  const byFile = new Map<string, PricingBandObservation[]>();

  let withQuantity = 0;
  let withPrice = 0;
  let withMargin = 0;
  let withCommission = 0;
  let invalidDecimals = 0;

  for (const row of rows) {
    const file = cleanText(row["arquivo"]) ?? "";
    const rawQuantity = cleanText(row["qtd_venda"]);
    const rawPrice = cleanText(row["preco_unit"]);

    const observation: PricingBandObservation = {
      file,
      quantity: safeDecimal(row["qtd_venda"]),
      unitPrice: safeDecimal(row["preco_unit"]),
      marginPercent: safeDecimal(row["margem_pct"]),
      commissionPercent: safeDecimal(row["comissao_pct"]),
    };

    if (observation.quantity) withQuantity += 1;
    if (observation.unitPrice) withPrice += 1;
    if (observation.marginPercent) withMargin += 1;
    if (observation.commissionPercent) withCommission += 1;
    if ((rawQuantity && !observation.quantity) || (rawPrice && !observation.unitPrice)) {
      invalidDecimals += 1;
      findings.add(
        "PRICING_VALUE_UNREADABLE",
        "Pricing",
        `${file} / ${rawQuantity ?? "?"}`,
        "quantidade ou preco historico ilegivel no export",
      );
    }

    byFile.set(file, [...(byFile.get(file) ?? []), observation]);
  }

  let duplicateQuantities = 0;
  let filesWithThreeBands = 0;
  let priceDecreasingFiles = 0;
  let priceNonMonotonicFiles = 0;
  let constantCommissionFiles = 0;
  let varyingCommissionFiles = 0;

  for (const [file, bands] of byFile) {
    const quantities = bands.map((band) => band.quantity?.toString()).filter(Boolean);
    if (new Set(quantities).size !== quantities.length) {
      duplicateQuantities += 1;
      findings.add(
        "PRICING_DUPLICATE_QUANTITY",
        "Pricing",
        file,
        "mesma quantidade aparece em mais de uma faixa",
      );
    }
    if (bands.length === 3) filesWithThreeBands += 1;

    const sorted = bands
      .filter((band) => band.quantity && band.unitPrice)
      .sort((a, b) => a.quantity!.comparedTo(b.quantity!));
    if (sorted.length >= 2) {
      const decreasing = sorted.every(
        (band, index) => index === 0 || band.unitPrice!.lessThanOrEqualTo(sorted[index - 1]!.unitPrice!),
      );
      if (decreasing) priceDecreasingFiles += 1;
      else {
        priceNonMonotonicFiles += 1;
        // Não se corrige: pode ser condição comercial real.
        findings.add(
          "PRICING_PRICE_NOT_DECREASING",
          "Pricing",
          file,
          "preco unitario nao cai conforme a quantidade aumenta — observacao, nao correcao",
        );
      }
    }

    const commissions = new Set(
      bands.map((band) => band.commissionPercent?.toString()).filter(Boolean),
    );
    if (commissions.size <= 1) constantCommissionFiles += 1;
    else {
      varyingCommissionFiles += 1;
      findings.add(
        "PRICING_COMMISSION_VARIES",
        "Pricing",
        file,
        `comissao varia entre as faixas (${[...commissions].join(", ")})`,
      );
    }
  }

  // O custo unitário exportado não é confiável (capacidade 45), então a
  // fórmula histórica de margem não pode ser verificada — dizer que "bate"
  // seria validar contra um número que já sabemos estar errado.
  findings.add(
    "HISTORICAL_MARGIN_FORMULA_UNVERIFIABLE",
    "Pricing",
    "cmv_precificacao.csv",
    "custo unitario historico nao confiavel: margem/markup historicos nao sao verificaveis",
  );

  findings.add(
    "DEFERRED_PRICING_IMPORT",
    "Pricing",
    "cmv_precificacao.csv",
    `${rows.length} linhas de precificacao permanecem apenas como observacao comercial — nenhuma PricingVersion e criada`,
  );

  return {
    rows: rows.length,
    files: byFile.size,
    withQuantity,
    withPrice,
    withMargin,
    withCommission,
    duplicateQuantities,
    invalidDecimals,
    filesWithThreeBands,
    priceDecreasingFiles,
    priceNonMonotonicFiles,
    constantCommissionFiles,
    varyingCommissionFiles,
    resolvedProducts: resolution.resolved,
    unresolvedProducts: resolution.unresolved,
  };
}
