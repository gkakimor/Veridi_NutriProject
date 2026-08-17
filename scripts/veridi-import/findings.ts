/**
 * Findings da migração Veridi, com severidade.
 *
 * Um finding NÃO é bug do importador: é o retrato de um dado legado que o
 * ERP se recusa a adivinhar. A severidade diz o que acontece com aquela
 * linha, não o quanto o dado é "feio".
 */

export type FindingSeverity =
  /** A linha/entidade não entra. O resto da migração continua. */
  | "BLOCKING"
  /** Entrou o que era seguro; alguém precisa revisar depois. */
  | "REVIEW"
  /** Transformação conhecida e aceita — só rastreabilidade. */
  | "INFO"
  /** Deliberadamente fora do escopo desta migração. */
  | "EXCLUDED_BY_POLICY";

export const SEVERITY_ORDER: readonly FindingSeverity[] = [
  "BLOCKING",
  "REVIEW",
  "INFO",
  "EXCLUDED_BY_POLICY",
];

/**
 * Severidade por código de finding.
 *
 * Mantido como tabela explícita (e não inferido por prefixo) porque a
 * decisão de cada caso é de produto, não de convenção de nome.
 */
export const SEVERITY_BY_CODE: Record<string, FindingSeverity> = {
  // ── Clientes ──────────────────────────────────────────────
  CUSTOMER_WITHOUT_CODE: "BLOCKING",
  CUSTOMER_WITHOUT_NAME: "BLOCKING",
  CUSTOMER_CNPJ_INVALID: "REVIEW",
  CUSTOMER_CNPJ_DUPLICATE: "REVIEW",
  CUSTOMER_INCOMPLETE: "REVIEW",
  CUSTOMER_ADDRESS_UNSTRUCTURED: "INFO",

  // ── Fornecedores ──────────────────────────────────────────
  SUPPLIER_WITHOUT_NAME: "BLOCKING",

  // ── Itens ─────────────────────────────────────────────────
  ITEM_WITHOUT_CODE: "BLOCKING",
  ITEM_WITHOUT_NAME: "BLOCKING",
  ITEM_TYPE_AMBIGUOUS: "REVIEW",
  ITEM_FAMILY_UNMAPPED: "REVIEW",
  ITEM_PURITY_INVALID: "REVIEW",
  ITEM_ENRICHMENT_UNMATCHED: "INFO",

  // ── Formulações ───────────────────────────────────────────
  FORMULATION_ITEM_UNRESOLVED: "REVIEW",
  FORMULATION_GROUP_INCONSISTENT: "REVIEW",
  FORMULATION_OVERAGE_IMPLAUSIBLE: "REVIEW",
  FORMULATION_LOT_NOT_CHRONOLOGICAL: "INFO",
  INSUFFICIENT_INPUTS: "REVIEW",
  PRODUCT_WITHOUT_CUSTOMER: "REVIEW",

  // ── Projetos ──────────────────────────────────────────────
  PROJECT_WITHOUT_CUSTOMER: "BLOCKING",
  PROJECT_WITHOUT_CODE: "BLOCKING",
  PROJECT_CUSTOMER_UNRESOLVED: "BLOCKING",
  PROJECT_PRODUCT_CUSTOMER_MISMATCH: "REVIEW",
  PROJECT_CODE_ACROSS_CUSTOMERS: "REVIEW",
  PROJECT_LEGACY_STATUS_NOT_EXPORTED: "REVIEW",

  // ── Amostras ──────────────────────────────────────────────
  SAMPLE_WITHOUT_CODE: "BLOCKING",
  SAMPLE_WITHOUT_DESCRIPTION: "BLOCKING",
  SAMPLE_WITHOUT_TEST_NUMBER: "BLOCKING",
  SAMPLE_PROJECT_UNRESOLVED: "BLOCKING",
  SAMPLE_PROJECT_AMBIGUOUS: "BLOCKING",
  SAMPLE_TEST_NUMBER_CLASH: "BLOCKING",
  SAMPLE_LEGACY_OUTCOME_UNKNOWN: "INFO",
  SAMPLE_MAPPED_BY_OVERRIDE: "INFO",
  SAMPLE_OVERRIDE_PROJECT_UNKNOWN: "BLOCKING",

  // ── Item × Fornecedor ─────────────────────────────────────
  SUPPLIER_PRICE_WITHOUT_ITEM: "BLOCKING",
  SUPPLIER_PRICE_WITHOUT_SUPPLIER: "BLOCKING",
  SUPPLIER_ITEM_ITEM_UNRESOLVED: "BLOCKING",
  SUPPLIER_ITEM_SUPPLIER_UNRESOLVED: "BLOCKING",
  SUPPLIER_ITEM_MAPPED_BY_OVERRIDE: "INFO",
  SUPPLIER_ITEM_OVERRIDE_TARGET_UNKNOWN: "BLOCKING",
  SUPPLIER_PRICE_INVALID: "BLOCKING",
  SUPPLIER_PRICE_UOM_INCOMPATIBLE: "BLOCKING",
  SUPPLIER_PRICE_UOM_BY_OVERRIDE: "INFO",
  SUPPLIER_MOQ_AMBIGUOUS: "REVIEW",
  SUPPLIER_MOQ_UOM_INCOMPATIBLE: "REVIEW",
  MOQ_ASSUMED_ITEM_UOM: "INFO",

  // ── Estoque ───────────────────────────────────────────────
  NEGATIVE_LEGACY_STOCK: "EXCLUDED_BY_POLICY",
  UNREADABLE_STOCK: "EXCLUDED_BY_POLICY",
  STOCK_NEEDS_LOT_RECONCILIATION: "REVIEW",

  // ── Fora de escopo por decisão ────────────────────────────
  EXISTING_MANUAL_RECORD: "REVIEW",
  NON_PERCENT_POTENCY: "REVIEW",
  DEFERRED_RECEIPT_HISTORY: "EXCLUDED_BY_POLICY",
  DEFERRED_CMV: "EXCLUDED_BY_POLICY",
  DEFERRED_PRICING: "EXCLUDED_BY_POLICY",
  DEFERRED_INDUSTRIAL_RESOURCE: "EXCLUDED_BY_POLICY",
  // Candidato a recurso: quem cadastra é gente, então isto é REVIEW.
  LABOR_RESOURCE_CANDIDATE: "REVIEW",
  EQUIPMENT_RESOURCE_CANDIDATE: "REVIEW",
  ENERGY_RESOURCE_CANDIDATE: "REVIEW",
  EQUIPMENT_COST_MAY_INCLUDE_ENERGY: "REVIEW",
  UNRESOLVED_RESOURCE_COST: "REVIEW",
  // Reconciliacao do CMV historico: divergencia e informacao, nunca ajuste.
  CMV_MATERIAL_DIVERGENCE: "REVIEW",
  CMV_MATERIAL_INSUFFICIENT_INPUTS: "INFO",
  HISTORICAL_TOTAL_NOT_DECOMPOSABLE: "INFO",
  HISTORICAL_UNIT_COST_NOT_TRUSTWORTHY: "REVIEW",
  CMV_PRODUCT_NOT_RESOLVED: "REVIEW",
  // Precificacao historica: observacao comercial, nunca preco importado.
  PRICING_VALUE_UNREADABLE: "REVIEW",
  PRICING_DUPLICATE_QUANTITY: "REVIEW",
  PRICING_PRICE_NOT_DECREASING: "INFO",
  PRICING_COMMISSION_VARIES: "INFO",
  HISTORICAL_MARGIN_FORMULA_UNVERIFIABLE: "REVIEW",
  DEFERRED_PRICING_IMPORT: "EXCLUDED_BY_POLICY",
  COST_STRUCTURE_CANDIDATE: "REVIEW",
  CMV_COMPONENT_UNCLASSIFIED: "REVIEW",
  DEFERRED_IN28: "EXCLUDED_BY_POLICY",
};

/** Severidade padrão para código novo: exige revisão, nunca some. */
export const DEFAULT_SEVERITY: FindingSeverity = "REVIEW";

export function severityOf(code: string): FindingSeverity {
  return SEVERITY_BY_CODE[code] ?? DEFAULT_SEVERITY;
}

export interface ImportFinding {
  code: string;
  severity: FindingSeverity;
  entity: string;
  reference: string;
  detail: string;
}

/**
 * Log compatível com o `FindingLog` do harness de dados (mesma assinatura
 * `add`), mas classificando severidade e permitindo relatório agrupado.
 */
export class ImportFindingLog {
  private readonly items: ImportFinding[] = [];

  add(code: string, entity: string, reference: string, detail: string): void {
    this.items.push({ code, severity: severityOf(code), entity, reference, detail });
  }

  all(): readonly ImportFinding[] {
    return this.items;
  }

  countBySeverity(): Record<FindingSeverity, number> {
    const counts: Record<FindingSeverity, number> = {
      BLOCKING: 0,
      REVIEW: 0,
      INFO: 0,
      EXCLUDED_BY_POLICY: 0,
    };
    for (const finding of this.items) counts[finding.severity] += 1;
    return counts;
  }

  summary(): { code: string; severity: FindingSeverity; count: number }[] {
    const map = new Map<string, { code: string; severity: FindingSeverity; count: number }>();
    for (const finding of this.items) {
      const current = map.get(finding.code) ?? {
        code: finding.code,
        severity: finding.severity,
        count: 0,
      };
      current.count += 1;
      map.set(finding.code, current);
    }
    return [...map.values()].sort((a, b) => {
      const bySeverity =
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
      return bySeverity !== 0 ? bySeverity : b.count - a.count;
    });
  }

  print(limitPerCode = 3): void {
    const summary = this.summary();
    if (summary.length === 0) {
      console.log("\nNenhum finding.");
      return;
    }
    console.log("\nFINDINGS");
    for (const row of summary) {
      console.log(`  [${row.severity}] ${row.code}: ${row.count}`);
      const examples = this.items.filter((finding) => finding.code === row.code).slice(0, limitPerCode);
      for (const example of examples) {
        console.log(`      ${example.entity} ${example.reference} — ${example.detail}`);
      }
      if (row.count > limitPerCode) console.log(`      … +${row.count - limitPerCode}`);
    }
  }
}
