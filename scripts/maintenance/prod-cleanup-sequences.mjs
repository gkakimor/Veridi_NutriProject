/**
 * Classificação das sequences do Postgres para `prod-cleanup.mjs`.
 *
 * Módulo puro — sem Prisma, sem ambiente, sem efeito ao importar — para o
 * script e a suíte de scripts lerem as MESMAS listas. O cleanup aborta, até em
 * dry-run, quando o banco tem sequence fora das duas: por isso toda sequence
 * que uma migration cria entra aqui, em exatamente uma lista.
 * `prod-cleanup-sequences.test.ts` confere essa paridade contra os
 * `migration.sql` versionados e reprova a migration nova sem classificação.
 */

/** Nunca reiniciada, com ou sem a flag. */
export const SEQUENCES_PRESERVADAS = ["user_code_seq"];

/**
 * Numeração de negócio. Reiniciadas só com `--reset-sequences` — seguro porque
 * a tabela dona do código é esvaziada na mesma transação: sequence que entra
 * aqui pede o model dela entre os ALVOS de `prod-cleanup-models.mjs`.
 */
export const SEQUENCES_DE_NEGOCIO = [
  "billing_code_seq",
  "customer_code_seq",
  "customer_order_code_seq",
  "formulation_template_code_seq",
  "industrial_cost_calculation_code_seq",
  "industrial_cost_code_seq",
  "industrial_cost_template_code_seq",
  "industrial_resource_code_seq",
  "item_code_finished_product_seq",
  "item_code_packaging_seq",
  "item_code_raw_material_seq",
  "lot_code_seq",
  "pricing_policy_template_code_seq",
  "pricing_version_code_seq",
  "product_code_seq",
  "production_order_code_seq",
  "production_profile_code_seq",
  "project_code_seq",
  "project_sample_code_seq",
  "purchase_order_code_seq",
  "quote_code_seq",
  "receipt_code_seq",
  "shipment_code_seq",
  "stock_count_code_seq",
  "supplier_code_seq",
];
