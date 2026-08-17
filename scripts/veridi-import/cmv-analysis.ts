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
  /**
   * Texto de equipamento que também fala de energia. Equipamento tarifado com
   * energia embutida somado à energia derivada contaria a mesma conta duas
   * vezes — o dado precisa ser lido por gente antes de virar tarifa.
   */
  mayIncludeEnergy: boolean;
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

const ENERGY_TERMS = ["ENERGIA", "ELETRIC", "ELÉTRIC", "KWH", "KW/H", "LUZ"];

/** O texto do equipamento menciona energia junto? */
export function equipmentTextMentionsEnergy(description: string | null): boolean {
  const text = (description ?? "").toUpperCase();
  return ENERGY_TERMS.some((term) => text.includes(term));
}

export function readCmvComponentRows(): CmvComponentRow[] {
  return readCorpusCsv("cmv_componentes.csv").rows.map((row) => {
    const itemExternalCode = cleanText(row["cod_item"]);
    const description = cleanText(row["descricao_mp"]);
    const candidate = classifyCmvComponent(description, itemExternalCode !== null);
    return {
      file: cleanText(row["arquivo"]) ?? "",
      itemExternalCode,
      description,
      family: cleanText(row["familia"]),
      candidate,
      mayIncludeEnergy: candidate === "EQUIPMENT" && equipmentTextMentionsEnergy(description),
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
  /**
   * Candidatos a recurso industrial encontrados no texto legado. `files*`
   * conta as planilhas cujo custo histórico existe mas NÃO detalha nenhum
   * recurso — nelas mão de obra, equipamento e energia estão embutidos no
   * custo unitário e não podem ser separados por leitura de texto.
   */
  resources: {
    labor: number;
    equipment: number;
    energy: number;
    equipmentMaybeWithEnergy: number;
    filesWithHistoricalCost: number;
    filesWithoutResourceDetail: number;
  };
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

  const CANDIDATE_FINDING: Partial<Record<CmvComponentCandidate, string>> = {
    LABOR: "LABOR_RESOURCE_CANDIDATE",
    EQUIPMENT: "EQUIPMENT_RESOURCE_CANDIDATE",
    ENERGY: "ENERGY_RESOURCE_CANDIDATE",
  };

  for (const component of components) {
    const resourceFinding = CANDIDATE_FINDING[component.candidate];
    if (resourceFinding) {
      // O recurso NUNCA é criado a partir do texto: o cadastro é decisão
      // humana, e a tarifa histórica da planilha não é tarifa vigente.
      findings.add(
        resourceFinding,
        "IndustrialResource",
        component.description ?? component.file,
        "candidato a recurso industrial no texto legado — cadastro e tarifa continuam sendo decisao manual",
      );
    }
    if (component.mayIncludeEnergy) {
      findings.add(
        "EQUIPMENT_COST_MAY_INCLUDE_ENERGY",
        "IndustrialResource",
        component.description ?? component.file,
        "custo de equipamento que menciona energia — tarifar assim e somar energia derivada contaria a mesma energia duas vezes",
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

  // Custo histórico existe, mas o CMV legado não separa mão de obra,
  // equipamento e energia: eles estão diluídos no custo unitário. Isso é
  // finding, não estimativa — nada aqui vira tarifa.
  const filesWithResourceDetail = new Set(
    components
      .filter((component) => CANDIDATE_FINDING[component.candidate] !== undefined)
      .map((component) => component.file),
  );
  const pricingFiles = new Set(
    readCorpusCsv("cmv_precificacao.csv")
      .rows.filter(
        (row) => safeDecimal(row["custo_por_unidade"]) || safeDecimal(row["custo_por_1000_unid"]),
      )
      .map((row) => cleanText(row["arquivo"]) ?? ""),
  );
  const filesWithoutResourceDetail = [...pricingFiles].filter(
    (file) => !filesWithResourceDetail.has(file),
  );
  for (const file of filesWithoutResourceDetail) {
    findings.add(
      "UNRESOLVED_RESOURCE_COST",
      "IndustrialResource",
      file,
      "custo historico inclui mao de obra/equipamento/energia sem detalhamento — tarifa nao pode ser derivada da planilha",
    );
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
    resources: {
      labor: byCandidate.LABOR,
      equipment: byCandidate.EQUIPMENT,
      energy: byCandidate.ENERGY,
      equipmentMaybeWithEnergy: components.filter((component) => component.mayIncludeEnergy).length,
      filesWithHistoricalCost: pricingFiles.size,
      filesWithoutResourceDetail: filesWithoutResourceDetail.length,
    },
    historical: {
      unitCostRows: historicalRows.filter((row) => safeDecimal(row["custo_por_unidade"])).length,
      thousandUnitCostRows: historicalRows.filter((row) => safeDecimal(row["custo_por_1000_unid"]))
        .length,
    },
  };
}
