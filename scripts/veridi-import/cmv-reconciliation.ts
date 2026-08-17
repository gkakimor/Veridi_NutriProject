import { Prisma } from "@prisma/client";
import type { FindingSink } from "../veridi-data/corpus.js";
import { cleanText, readCorpusCsv, safeDecimal } from "../veridi-data/corpus.js";
import { readFormulationRows, selectLatestGroups } from "../veridi-data/mapping.js";

/**
 * Reconciliação do CMV histórico (capacidade 45).
 *
 * Objetivo: validar o MOTOR com entradas historicamente conhecidas, não
 * alimentar o custo atual. Nada aqui vira preço vigente, oferta ou custo de
 * item — os valores da planilha são evidência do passado.
 *
 * A comparação só existe onde o corpus sustenta a resposta: quantidade por
 * lote reconstruída da formulação × preço histórico da própria planilha. Se
 * a linha não tem contrapartida na formulação ou não tem preço, ela é
 * declarada INSUFICIENTE em vez de forçada a bater.
 */

/** Divergência de quantidade acima disso é diferença real, não arredondamento. */
const QUANTITY_TOLERANCE = new Prisma.Decimal("0.00001");
/** Dinheiro: um centavo por MIL unidades — a escala em que a planilha decide preço. */
const CURRENCY_TOLERANCE = new Prisma.Decimal("0.01");
const THOUSAND = new Prisma.Decimal(1000);

export interface CmvComponentReconciliation {
  file: string;
  itemExternalCode: string;
  description: string | null;
  /** Quantidade da planilha de CMV, por unidade acabada (kg). */
  legacyQuantityKg: Prisma.Decimal | null;
  /** Quantidade equivalente na formulação histórica, por unidade (kg). */
  formulationQuantityKg: Prisma.Decimal | null;
  unitPriceBrlKg: Prisma.Decimal | null;
  legacyMaterialCost: Prisma.Decimal | null;
  formulationMaterialCost: Prisma.Decimal | null;
  status: "MATCHED" | "DIVERGENT" | "INSUFFICIENT_INPUTS";
}

export interface CmvProductReconciliation {
  file: string;
  productName: string;
  components: number;
  comparable: number;
  matched: number;
  divergent: number;
  insufficient: number;
  /** Custo de material por MIL unidades — comparável entre as duas planilhas. */
  legacyMaterialCost: Prisma.Decimal | null;
  formulationMaterialCost: Prisma.Decimal | null;
  /** Custo histórico total do lote (materiais + tudo o mais). */
  historicalTotalCost: Prisma.Decimal | null;
  minimumBatch: Prisma.Decimal | null;
  decomposable: boolean;
}

export interface CmvReconciliationSummary {
  products: number;
  productsComparable: number;
  components: number;
  comparable: number;
  matched: number;
  divergent: number;
  insufficient: number;
  historicalTotalsDecomposable: number;
  historicalTotalsNotDecomposable: number;
  rows: CmvProductReconciliation[];
}

/** Normaliza nome para comparação: sem acento, sem pontuação, maiúsculo. */
function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * Resolve o produto do CMV dentro do corpus de formulações.
 *
 * O CMV não carrega `cod_produto`, só o nome do arquivo/produto — e os nomes
 * não coincidem com o cadastro ("CREATINA PT 300g" x seis formulações de
 * creatina). Casa por nome normalizado exato, depois por prefixo ÚNICO.
 * Ambiguidade não vira escolha: vira finding.
 */
function resolveFormulationProduct<G extends { productName: string }>(
  cmvName: string,
  groups: G[],
): { group: G | null; reason: "EXACT" | "UNIQUE_PREFIX" | "AMBIGUOUS" | "NOT_FOUND" } {
  const target = normalizeName(cmvName);
  if (!target) return { group: null, reason: "NOT_FOUND" };

  const exact = groups.filter((group) => normalizeName(group.productName) === target);
  if (exact.length === 1) return { group: exact[0]!, reason: "EXACT" };
  if (exact.length > 1) return { group: null, reason: "AMBIGUOUS" };

  const prefix = groups.filter((group) => {
    const candidate = normalizeName(group.productName);
    return candidate.startsWith(target) || target.startsWith(candidate);
  });
  if (prefix.length === 1) return { group: prefix[0]!, reason: "UNIQUE_PREFIX" };
  if (prefix.length > 1) return { group: null, reason: "AMBIGUOUS" };

  return { group: null, reason: "NOT_FOUND" };
}

function relativeDifference(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  if (b.isZero()) return a.isZero() ? new Prisma.Decimal(0) : new Prisma.Decimal(1);
  return a.minus(b).abs().dividedBy(b.abs());
}

/**
 * Reconciliação por produto do CMV.
 *
 * O casamento é por `cod_item` (Item.externalCode) — descrição só entra como
 * texto do finding, nunca como chave: nomes iguais em produtos diferentes
 * não são o mesmo insumo.
 */
export function reconcileCmv(findings: FindingSink): CmvReconciliationSummary {
  const cmvProducts = readCorpusCsv("cmv_produtos.csv").rows;
  const cmvComponents = readCorpusCsv("cmv_componentes.csv").rows;
  const pricing = readCorpusCsv("cmv_precificacao.csv").rows;

  const formulationGroups = selectLatestGroups(readFormulationRows(findings), findings);

  const groups = [...formulationGroups.values()];

  // O custo unitário histórico do export é idêntico em todas as planilhas —
  // a extração perdeu o valor por produto. Isso é dado suspeito, não base de
  // comparação: reportado uma vez e nunca usado como golden de total.
  const unitCosts = new Set(
    pricing
      .map((row) => cleanText(row["custo_por_unidade"]))
      .filter((value): value is string => value !== null),
  );
  const unitCostTrustworthy = unitCosts.size > 1;
  if (!unitCostTrustworthy) {
    findings.add(
      "HISTORICAL_UNIT_COST_NOT_TRUSTWORTHY",
      "IndustrialCost",
      "cmv_precificacao.csv",
      `custo_por_unidade identico em todas as ${pricing.length} linhas — o export nao preservou o custo por produto`,
    );
  }

  const rows: CmvProductReconciliation[] = [];
  const summary: CmvReconciliationSummary = {
    products: cmvProducts.length,
    productsComparable: 0,
    components: 0,
    comparable: 0,
    matched: 0,
    divergent: 0,
    insufficient: 0,
    historicalTotalsDecomposable: 0,
    historicalTotalsNotDecomposable: 0,
    rows,
  };

  for (const product of cmvProducts) {
    const file = cleanText(product["arquivo"]) ?? "";
    const productName = cleanText(product["nome_produto"]) ?? "";
    const minimumBatch = safeDecimal(product["lote_minimo"]);
    const resolution = resolveFormulationProduct(productName, groups);
    const formulation = resolution.group;
    if (!formulation) {
      findings.add(
        "CMV_PRODUCT_NOT_RESOLVED",
        "IndustrialCost",
        file,
        resolution.reason === "AMBIGUOUS"
          ? `nome "${productName}" corresponde a mais de uma formulacao — nenhuma escolhida automaticamente`
          : `nome "${productName}" nao encontrado no corpus de formulacoes`,
      );
    }

    const components = cmvComponents.filter((row) => cleanText(row["arquivo"]) === file);
    let legacyMaterialCost: Prisma.Decimal | null = new Prisma.Decimal(0);
    let formulationMaterialCost: Prisma.Decimal | null = new Prisma.Decimal(0);
    let comparable = 0;
    let matched = 0;
    let divergent = 0;
    let insufficient = 0;

    for (const component of components) {
      summary.components += 1;
      const itemCode = cleanText(component["cod_item"]);
      const legacyQuantity = safeDecimal(component["kg_lote"]);
      const price = safeDecimal(component["preco_brl_kg"]);
      const description = cleanText(component["descricao_mp"]);

      const formulationRow =
        itemCode && formulation
          ? (formulation.rows.find((row) => row.itemCode === itemCode) ?? null)
          : null;

      // As duas planilhas usam lotes DIFERENTES (o CMV usa `lote_minimo`, a
      // formulação usa `lote_qtd_unidades`). Comparar kg de lote com kg de
      // lote seria comparar bases distintas: normaliza-se por unidade
      // acabada, que é o que os dois têm em comum.
      const batchUnits = formulationRow?.batchUnits ?? null;
      const formulationQuantity =
        formulationRow?.legacyTotal && batchUnits && batchUnits.greaterThan(0)
          ? formulationRow.legacyTotal.dividedBy(batchUnits)
          : null;
      const legacyQuantityPerUnit =
        legacyQuantity && minimumBatch && minimumBatch.greaterThan(0)
          ? legacyQuantity.dividedBy(minimumBatch)
          : null;

      if (!itemCode || !legacyQuantityPerUnit || !price || !formulationQuantity) {
        insufficient += 1;
        summary.insufficient += 1;
        legacyMaterialCost = null;
        formulationMaterialCost = null;
        findings.add(
          "CMV_MATERIAL_INSUFFICIENT_INPUTS",
          "IndustrialCost",
          `${file} / ${description ?? itemCode ?? "sem código"}`,
          !itemCode
            ? "linha de CMV sem cod_item — nao casada por descricao"
            : !formulationQuantity
              ? "sem contrapartida na formulacao historica do mesmo produto"
              : "sem quantidade ou preco historico utilizavel",
        );
        continue;
      }

      comparable += 1;
      summary.comparable += 1;

      // Custo por MIL unidades acabadas — a visão que as planilhas usam.
      const legacyCost = legacyQuantityPerUnit.times(price).times(THOUSAND);
      const engineCost = formulationQuantity.times(price).times(THOUSAND);
      if (legacyMaterialCost) legacyMaterialCost = legacyMaterialCost.plus(legacyCost);
      if (formulationMaterialCost) formulationMaterialCost = formulationMaterialCost.plus(engineCost);

      const quantityDifference = relativeDifference(formulationQuantity, legacyQuantityPerUnit);
      const costDifference = engineCost.minus(legacyCost).abs();

      if (
        quantityDifference.lessThanOrEqualTo(QUANTITY_TOLERANCE) &&
        costDifference.lessThanOrEqualTo(CURRENCY_TOLERANCE)
      ) {
        matched += 1;
        summary.matched += 1;
        continue;
      }

      divergent += 1;
      summary.divergent += 1;
      // Divergência é informação: nada de ajustar fórmula ou preço para bater.
      findings.add(
        "CMV_MATERIAL_DIVERGENCE",
        "IndustrialCost",
        `${file} / ${description ?? itemCode}`,
        `por unidade: CMV ${legacyQuantityPerUnit.toString()} kg x formulacao ${formulationQuantity.toString()} kg — custo/1000 ${legacyCost.toFixed(2)} x ${engineCost.toFixed(2)} (preco historico ${price.toString()}/kg)`,
      );
    }

    const pricingRow = pricing.find((row) => cleanText(row["arquivo"]) === file);
    const unitCost =
      unitCostTrustworthy && pricingRow ? safeDecimal(pricingRow["custo_por_unidade"]) : null;
    const historicalTotalCost = unitCost && minimumBatch ? unitCost.times(minimumBatch) : null;

    // O total histórico só é decomponível quando os materiais explicam a
    // maior parte dele e o restante não some: recursos industriais estão
    // diluídos e continuam sem detalhamento (conclusão da capacidade 44).
    const decomposable =
      historicalTotalCost !== null &&
      legacyMaterialCost !== null &&
      insufficient === 0 &&
      historicalTotalCost.greaterThan(0);

    if (decomposable) summary.historicalTotalsDecomposable += 1;
    else {
      summary.historicalTotalsNotDecomposable += 1;
      findings.add(
        "HISTORICAL_TOTAL_NOT_DECOMPOSABLE",
        "IndustrialCost",
        file,
        historicalTotalCost === null
          ? "planilha sem custo unitario/lote minimo utilizavel — total historico nao reconstruivel"
          : "componentes de material incompletos — total historico nao explicavel linha a linha",
      );
    }

    if (comparable > 0) summary.productsComparable += 1;

    rows.push({
      file,
      productName,
      components: components.length,
      comparable,
      matched,
      divergent,
      insufficient,
      legacyMaterialCost,
      formulationMaterialCost,
      historicalTotalCost,
      minimumBatch,
      decomposable,
    });
  }

  return summary;
}
