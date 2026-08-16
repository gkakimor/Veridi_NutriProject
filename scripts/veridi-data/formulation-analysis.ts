import { Prisma } from "@prisma/client";
import type { FindingLog } from "./corpus.js";
import { cleanText, readCorpusCsv, safeDecimal } from "./corpus.js";
import type { FormulationGroup, FormulationRow, MappedItem } from "./mapping.js";

/**
 * Reconstrução da fórmula histórica no modelo da capacidade 34.
 *
 * A planilha guarda apenas o TOTAL final já corrigido
 * (`total_kg_com_pureza_overage`). O modelo do ERP é:
 *
 * ```
 * total = qtdPorDose × dosesPorEmbalagem × unidades ÷ pureza × (1 + overage)
 * ```
 *
 * Duas incógnitas (doses por embalagem e overage) para um único valor
 * observado. Este módulo só reconstrói quando o próprio corpus sustenta a
 * resposta; caso contrário devolve `INSUFFICIENT_INPUTS`. **Nunca** se
 * ajusta pureza ou overage para o número bater com o histórico — divergir é
 * exatamente a informação que queremos enxergar.
 */

const HUNDRED = new Prisma.Decimal(100);
/**
 * Tolerância RELATIVA da comparação com o histórico: 1e-5 (0,001%).
 *
 * Justificativa: a planilha grava o total já arredondado em 8 casas e a
 * conversão mg → kg divide por 1e6, então diferenças na última casa são
 * ruído de arredondamento do Excel, não divergência de fórmula. Qualquer
 * coisa acima disso é diferença real e é reportada — nunca escondida.
 */
export const COMPARISON_TOLERANCE = new Prisma.Decimal("0.00001");

const MG_PER_KG = new Prisma.Decimal(1_000_000);
const G_PER_KG = new Prisma.Decimal(1000);

/** Converte a quantidade por dose para kg — só dimensões de massa. */
export function doseToKg(quantity: Prisma.Decimal, unit: string | null): Prisma.Decimal | null {
  switch (unit) {
    case "MG":
      return quantity.dividedBy(MG_PER_KG);
    case "G":
      return quantity.dividedBy(G_PER_KG);
    case "KG":
      return quantity;
    default:
      return null;
  }
}

export interface CmvProduct {
  name: string;
  capsulesPerDose: number | null;
  overagePercent: Prisma.Decimal | null;
}

/** Lê `cmv_produtos.csv` só como EVIDÊNCIA externa (cápsulas/dose, overage). */
export function readCmvProducts(): CmvProduct[] {
  const file = readCorpusCsv("cmv_produtos.csv");
  return file.rows.map((row) => {
    const capsules = safeDecimal(row["capsulas_por_dose"]);
    const overage = safeDecimal(row["reserva_overage_pct"]);
    return {
      name: (cleanText(row["nome_produto"]) ?? "").toUpperCase(),
      capsulesPerDose: capsules ? capsules.toNumber() : null,
      // CSV guarda fração (0.2 = 20%); o ERP trabalha em porcentagem.
      overagePercent: overage ? overage.times(HUNDRED) : null,
    };
  });
}

/** Cápsulas por embalagem declaradas no próprio nome do produto ("60 CAPS"). */
export function capsulesPerPackageFromName(name: string): number | null {
  const match = /(\d+)\s*CAPS/i.exec(name);
  return match ? Number(match[1]) : null;
}

export type ReconstructionStatus =
  | "PER_DOSE_RECONSTRUCTED"
  | "CONSISTENT_WITHOUT_SPLIT"
  | "INSUFFICIENT_INPUTS";

export interface GroupReconstruction {
  group: FormulationGroup;
  status: ReconstructionStatus;
  /** `dosesPorEmbalagem × (1 + overage)`, observado no próprio grupo. */
  combinedFactor: Prisma.Decimal | null;
  dosesPerPackage: number | null;
  overagePercent: Prisma.Decimal | null;
  comparableRows: number;
  matchedRows: number;
  divergences: Divergence[];
}

export interface Divergence {
  productCode: string;
  lot: string;
  itemCode: string;
  purityPercent: string | null;
  overagePercent: string | null;
  erpQuantity: string;
  historicalQuantity: string;
  absoluteDifference: string;
  percentDifference: string;
}

/**
 * Fator combinado observado por linha: `total × pureza ÷ (dose × unidades)`.
 * Equivale a `dosesPorEmbalagem × (1 + overage)` — um número estrutural do
 * grupo, não um ajuste por linha.
 */
function combinedFactorForRow(
  row: FormulationRow,
  purityPercent: Prisma.Decimal | null,
): Prisma.Decimal | null {
  if (!row.quantityPerDose || !row.batchUnits || !row.legacyTotal) return null;
  if (row.batchUnits.lessThanOrEqualTo(0) || row.quantityPerDose.lessThanOrEqualTo(0)) return null;

  const doseKg = doseToKg(row.quantityPerDose, row.doseUnit);
  if (!doseKg || doseKg.lessThanOrEqualTo(0)) return null;

  const theoretical = doseKg.times(row.batchUnits);
  if (theoretical.lessThanOrEqualTo(0)) return null;

  const purityFactor = purityPercent ? purityPercent.dividedBy(HUNDRED) : new Prisma.Decimal(1);
  return row.legacyTotal.times(purityFactor).dividedBy(theoretical);
}

function relativeDifference(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  if (b.isZero()) return a.isZero() ? new Prisma.Decimal(0) : new Prisma.Decimal(1);
  return a.minus(b).abs().dividedBy(b.abs());
}

/**
 * Reconstrói um grupo (produto + lote) e compara o cálculo do ERP com o
 * total histórico da planilha.
 */
export function reconstructGroup(
  group: FormulationGroup,
  itemsByExternalCode: Map<string, MappedItem>,
  cmvProducts: CmvProduct[],
  findings: FindingLog,
): GroupReconstruction {
  const reference = `${group.productCode}/${group.lot}`;
  const factors: Prisma.Decimal[] = [];

  for (const row of group.rows) {
    const item = itemsByExternalCode.get(row.itemCode);
    // Embalagem não entra na conta de dose: é BOM por unidade acabada.
    if (item?.type === "PACKAGING") continue;
    const factor = combinedFactorForRow(row, item?.defaultPurityPercent
      ? new Prisma.Decimal(item.defaultPurityPercent)
      : null);
    if (factor) factors.push(factor);
  }

  if (factors.length === 0) {
    findings.add("INSUFFICIENT_INPUTS", "Formulation", reference, "nenhuma linha com dose+unidades+total");
    return {
      group,
      status: "INSUFFICIENT_INPUTS",
      combinedFactor: null,
      dosesPerPackage: null,
      overagePercent: null,
      comparableRows: 0,
      matchedRows: 0,
      divergences: [],
    };
  }

  // O grupo só é reconstruível se TODAS as linhas concordarem com o mesmo
  // fator estrutural. Discordância = receita histórica inconsistente.
  const first = factors[0]!;
  const consistent = factors.every((factor) => relativeDifference(factor, first).lessThanOrEqualTo("0.001"));
  if (!consistent) {
    findings.add("FORMULATION_GROUP_INCONSISTENT", "Formulation", reference, "linhas com fatores dose/overage divergentes");
    return {
      group,
      status: "INSUFFICIENT_INPUTS",
      combinedFactor: null,
      dosesPerPackage: null,
      overagePercent: null,
      comparableRows: 0,
      matchedRows: 0,
      divergences: [],
    };
  }

  // Separar o fator em doses × (1 + overage) exige EVIDÊNCIA externa:
  // cápsulas por embalagem (no nome) ÷ cápsulas por dose (CMV).
  const upperName = group.productName.toUpperCase();
  const capsulesPerPackage = capsulesPerPackageFromName(upperName);
  const cmv = cmvProducts.find((candidate) => upperName.includes(candidate.name) || candidate.name.includes(upperName));
  let dosesPerPackage: number | null = null;
  if (capsulesPerPackage && cmv?.capsulesPerDose && cmv.capsulesPerDose > 0) {
    const doses = capsulesPerPackage / cmv.capsulesPerDose;
    if (Number.isInteger(doses) && doses > 0) dosesPerPackage = doses;
  }

  if (!dosesPerPackage) {
    findings.add(
      "INSUFFICIENT_INPUTS",
      "Formulation",
      reference,
      `fator combinado ${first.toFixed(6)} consistente, mas doses/embalagem não são dedutíveis do corpus`,
    );
    return {
      group,
      status: "CONSISTENT_WITHOUT_SPLIT",
      combinedFactor: first,
      dosesPerPackage: null,
      overagePercent: null,
      comparableRows: 0,
      matchedRows: 0,
      divergences: [],
    };
  }

  const overagePercent = first.dividedBy(dosesPerPackage).minus(1).times(HUNDRED);
  // Overage negativo ou absurdo significa que a divisao doses/overage nao
  // explica o historico — nao se grava um numero so para fechar a conta.
  if (overagePercent.lessThan(0) || overagePercent.greaterThan(100)) {
    findings.add(
      "FORMULATION_OVERAGE_IMPLAUSIBLE",
      "Formulation",
      reference,
      `overage derivado fora da faixa plausível (${overagePercent.toFixed(3)}%)`,
    );
    return {
      group,
      status: "CONSISTENT_WITHOUT_SPLIT",
      combinedFactor: first,
      dosesPerPackage: null,
      overagePercent: null,
      comparableRows: 0,
      matchedRows: 0,
      divergences: [],
    };
  }

  // Com doses e overage explicados, recalcula pelo ERP e compara com o
  // total histórico linha a linha.
  let comparableRows = 0;
  let matchedRows = 0;
  const divergences: Divergence[] = [];

  for (const row of group.rows) {
    const item = itemsByExternalCode.get(row.itemCode);
    if (!item || item.type === "PACKAGING") continue;
    if (!row.quantityPerDose || !row.batchUnits || !row.legacyTotal) continue;

    const doseKg = doseToKg(row.quantityPerDose, row.doseUnit);
    if (!doseKg) continue;

    const purity = item.defaultPurityPercent ? new Prisma.Decimal(item.defaultPurityPercent) : null;
    let erp = doseKg.times(dosesPerPackage).times(row.batchUnits);
    if (purity && purity.greaterThan(0)) erp = erp.dividedBy(purity.dividedBy(HUNDRED));
    erp = erp.times(HUNDRED.plus(overagePercent).dividedBy(HUNDRED));

    comparableRows += 1;
    const difference = relativeDifference(erp, row.legacyTotal);
    if (difference.lessThanOrEqualTo(COMPARISON_TOLERANCE)) {
      matchedRows += 1;
    } else {
      divergences.push({
        productCode: row.productCode,
        lot: row.lot,
        itemCode: row.itemCode,
        purityPercent: purity ? purity.toString() : null,
        overagePercent: overagePercent.toFixed(3),
        erpQuantity: erp.toFixed(8),
        historicalQuantity: row.legacyTotal.toString(),
        absoluteDifference: erp.minus(row.legacyTotal).toFixed(8),
        percentDifference: difference.times(HUNDRED).toFixed(4),
      });
      // Divergência NUNCA é "corrigida": é reportada como achado.
      findings.add(
        "GOLDEN_DIVERGENCE",
        "Formulation",
        `${reference}/item ${row.itemCode}`,
        `ERP ${erp.toFixed(6)} × histórico ${row.legacyTotal.toString()}`,
      );
    }
  }

  return {
    group,
    status: "PER_DOSE_RECONSTRUCTED",
    combinedFactor: first,
    dosesPerPackage,
    overagePercent,
    comparableRows,
    matchedRows,
    divergences,
  };
}
