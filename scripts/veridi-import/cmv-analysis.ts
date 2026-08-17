import type { FindingSink } from "../veridi-data/corpus.js";
import { cleanText, readCorpusCsv, safeDecimal } from "../veridi-data/corpus.js";

/**
 * Análise dos arquivos de CMV (`cmv_produtos`, `cmv_componentes`,
 * `cmv_precificacao`).
 *
 * SOMENTE LEITURA nesta capacidade. A estrutura de custos industriais
 * acabou de nascer; recursos (mão de obra, equipamento, energia) chegam na
 * capacidade seguinte e preço/margem/comissão depois disso. Importar agora
 * significaria deformar o modelo para caber na planilha — que é evidência
 * do negócio, não schema oficial.
 */

export interface CmvProductRow {
  file: string;
  productName: string;
  presentation: string | null;
  commissioned: boolean;
  minimumBatch: string | null;
  unitsPerBox: string | null;
}

export interface CmvComponentRow {
  file: string;
  itemExternalCode: string | null;
  description: string | null;
  family: string | null;
  /** Classificação do que a linha representa — nunca inferida no import. */
  candidate: CmvComponentCandidate;
}

/**
 * O que a linha de componente parece ser. Serve para dizer PARA QUAL
 * capacidade aquele custo vai — nunca para criar linha manual agora.
 */
export type CmvComponentCandidate =
  | "FORMULATION_MATERIAL"
  | "SECONDARY_PACKAGING"
  | "LABOR"
  | "EQUIPMENT"
  | "ENERGY"
  | "OVERHEAD"
  | "UNKNOWN";

const CANDIDATE_HINTS: { candidate: CmvComponentCandidate; terms: string[] }[] = [
  { candidate: "LABOR", terms: ["MAO DE OBRA", "MÃO DE OBRA", "OPERADOR", "SALARIO", "SALÁRIO"] },
  { candidate: "EQUIPMENT", terms: ["EQUIPAMENTO", "MAQUINA", "MÁQUINA", "DEPRECIA"] },
  { candidate: "ENERGY", terms: ["ENERGIA", "ELETRIC", "ELÉTRIC", "KWH"] },
  {
    candidate: "SECONDARY_PACKAGING",
    terms: ["CAIXA", "CX ", "EXPEDI", "PALETE", "FILME", "DIVISORIA", "DIVISÓRIA"],
  },
  { candidate: "OVERHEAD", terms: ["RATEIO", "OVERHEAD", "DESPESA", "ADMINISTRA"] },
];

/**
 * Classificação por PALAVRA-CHAVE do texto legado, usada só para relatório.
 * Nada disso vira dado: uma heurística de texto não decide categoria de
 * custo — ela só aponta para onde olhar.
 */
export function classifyCmvComponent(
  description: string | null,
  hasItemCode: boolean,
): CmvComponentCandidate {
  const text = (description ?? "").toUpperCase();
  for (const hint of CANDIDATE_HINTS) {
    if (hint.terms.some((term) => text.includes(term))) return hint.candidate;
  }
  // Linha com código de item é candidata a componente de formulação.
  return hasItemCode ? "FORMULATION_MATERIAL" : "UNKNOWN";
}

function isAffirmative(value: string | null): boolean {
  return value !== null && ["SIM", "S", "TRUE", "1"].includes(value.toUpperCase());
}

export function readCmvProductRows(): CmvProductRow[] {
  return readCorpusCsv("cmv_produtos.csv").rows.map((row) => ({
    file: cleanText(row["arquivo"]) ?? "",
    productName: cleanText(row["nome_produto"]) ?? "",
    presentation: cleanText(row["sub_tipo"]),
    commissioned: isAffirmative(cleanText(row["comissionado"])),
    minimumBatch: cleanText(row["lote_minimo"]),
    unitsPerBox: cleanText(row["embalagens_por_cx"]),
  }));
}

export function readCmvComponentRows(): CmvComponentRow[] {
  return readCorpusCsv("cmv_componentes.csv").rows.map((row) => {
    const itemExternalCode = cleanText(row["cod_item"]);
    const description = cleanText(row["descricao_mp"]);
    return {
      file: cleanText(row["arquivo"]) ?? "",
      itemExternalCode,
      description,
      family: cleanText(row["familia"]),
      candidate: classifyCmvComponent(description, itemExternalCode !== null),
    };
  });
}

export interface CmvPricingStats {
  rows: number;
  files: number;
  quantityBands: number;
  withPrice: number;
  withMargin: number;
  withCommission: number;
}

export function readCmvPricingStats(): CmvPricingStats {
  const rows = readCorpusCsv("cmv_precificacao.csv").rows;
  const bands = new Set<string>();
  let withPrice = 0;
  let withMargin = 0;
  let withCommission = 0;

  for (const row of rows) {
    const band = cleanText(row["qtd_venda"]);
    if (band) bands.add(band);
    if (safeDecimal(row["preco_unit"])) withPrice += 1;
    if (safeDecimal(row["margem_pct"])) withMargin += 1;
    if (safeDecimal(row["comissao_pct"])) withCommission += 1;
  }

  return {
    rows: rows.length,
    files: new Set(rows.map((row) => cleanText(row["arquivo"]) ?? "")).size,
    quantityBands: bands.size,
    withPrice,
    withMargin,
    withCommission,
  };
}

export interface CmvAnalysis {
  products: {
    rows: number;
    distinctNames: number;
    withMinimumBatch: number;
    withUnitsPerBox: number;
    commissioned: number;
  };
  components: {
    rows: number;
    withItemCode: number;
    byCandidate: Record<CmvComponentCandidate, number>;
    distinctFamilies: number;
  };
  pricing: CmvPricingStats;
  /** Valores históricos disponíveis — referência, sem exigência de match. */
  historical: { unitCostRows: number; thousandUnitCostRows: number };
}

/**
 * Estatística do CMV histórico + findings de escopo.
 *
 * Cada bloco declara para qual capacidade ele vai. Nada é persistido aqui:
 * o objetivo é enxergar o que existe antes de decidir como calcular.
 */
export function analyzeCmv(findings: FindingSink): CmvAnalysis {
  const products = readCmvProductRows();
  const components = readCmvComponentRows();
  const pricing = readCmvPricingStats();

  const byCandidate: Record<CmvComponentCandidate, number> = {
    FORMULATION_MATERIAL: 0,
    SECONDARY_PACKAGING: 0,
    LABOR: 0,
    EQUIPMENT: 0,
    ENERGY: 0,
    OVERHEAD: 0,
    UNKNOWN: 0,
  };
  for (const component of components) byCandidate[component.candidate] += 1;

  for (const component of components) {
    if (
      component.candidate === "LABOR" ||
      component.candidate === "EQUIPMENT" ||
      component.candidate === "ENERGY"
    ) {
      findings.add(
        "DEFERRED_INDUSTRIAL_RESOURCE",
        "IndustrialCost",
        component.description ?? component.file,
        "custo de recurso industrial — modelagem propria na proxima capacidade, nunca linha manual agora",
      );
    }
    if (component.candidate === "SECONDARY_PACKAGING") {
      findings.add(
        "COST_STRUCTURE_CANDIDATE",
        "IndustrialCost",
        component.description ?? component.file,
        "candidato a embalagem secundaria/expedicao — base e significado precisam ser confirmados antes de importar",
      );
    }
    if (component.candidate === "UNKNOWN") {
      findings.add(
        "CMV_COMPONENT_UNCLASSIFIED",
        "IndustrialCost",
        component.description ?? component.file,
        "linha de CMV sem categoria reconhecida — nao classificada automaticamente",
      );
    }
  }

  findings.add(
    "DEFERRED_PRICING",
    "Pricing",
    "cmv_precificacao.csv",
    `${pricing.rows} linhas com preco/margem/comissao — precificacao e capacidade propria; nada persistido`,
  );

  const historicalRows = readCorpusCsv("cmv_precificacao.csv").rows;
  return {
    products: {
      rows: products.length,
      distinctNames: new Set(products.map((row) => row.productName)).size,
      withMinimumBatch: products.filter((row) => row.minimumBatch !== null).length,
      withUnitsPerBox: products.filter((row) => row.unitsPerBox !== null).length,
      commissioned: products.filter((row) => row.commissioned).length,
    },
    components: {
      rows: components.length,
      withItemCode: components.filter((row) => row.itemExternalCode !== null).length,
      byCandidate,
      distinctFamilies: new Set(
        components.map((row) => row.family).filter((family): family is string => family !== null),
      ).size,
    },
    pricing,
    historical: {
      unitCostRows: historicalRows.filter((row) => safeDecimal(row["custo_por_unidade"])).length,
      thousandUnitCostRows: historicalRows.filter((row) => safeDecimal(row["custo_por_1000_unid"]))
        .length,
    },
  };
}
