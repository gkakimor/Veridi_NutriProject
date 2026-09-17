/**
 * Classificação das sequences do Postgres para `prod-cleanup.mjs`.
 *
 * Módulo puro — sem Prisma, sem ambiente, sem efeito ao importar — para o
 * script e a suíte de scripts lerem as MESMAS listas e a MESMA conferência. O
 * cleanup aborta, até em dry-run, quando `conferirSequences()` acusa qualquer
 * coisa: por isso toda sequence que uma migration cria entra aqui, em
 * exatamente uma lista. `prod-cleanup-sequences.test.ts` confere essa paridade
 * contra os `migration.sql` versionados e reprova a migration nova sem
 * classificação.
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
  "internal_consumption_code_seq",
  "item_code_finished_product_seq",
  "item_code_internal_consumable_seq",
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

/**
 * Confere as sequences que o banco tem contra as duas listas. Tudo vazio =
 * pode seguir; qualquer nome em qualquer campo aborta a limpeza.
 *
 * - `sequences`: `{ schema, nome }` de TODOS os schemas (`pg_sequences`);
 * - `colunasNumeradas`: `tabela.coluna` serial, identity ou com
 *   `DEFAULT nextval(...)` — a numeração de código é por `nextval` explícito,
 *   e nenhuma coluna se numera sozinha;
 * - `sequencesComDono`: sequence presa a uma coluna (serial, identity ou
 *   `OWNED BY`), que some ou muda junto com a tabela sem `DROP SEQUENCE`.
 *
 * Sequence renomeada aparece duas vezes: sem classificação (o nome novo) e
 * fantasma (o antigo). Apagada, só fantasma.
 *
 * @param {{ sequences: Array<{ schema: string, nome: string }>, colunasNumeradas?: string[], sequencesComDono?: string[] }} banco
 * @param {{ SEQUENCES_PRESERVADAS: string[], SEQUENCES_DE_NEGOCIO: string[] }} [listas]
 */
export function conferirSequences(
  { sequences, colunasNumeradas = [], sequencesComDono = [] },
  listas = { SEQUENCES_PRESERVADAS, SEQUENCES_DE_NEGOCIO },
) {
  const { SEQUENCES_PRESERVADAS: preservadas, SEQUENCES_DE_NEGOCIO: negocio } = listas;
  const repetidas = (lista) => lista.filter((n, i) => lista.indexOf(n) !== i);
  const classificadas = new Set([...preservadas, ...negocio]);
  const noPublic = new Set(sequences.filter((s) => s.schema === "public").map((s) => s.nome));
  return {
    semClassificacao: [...noPublic].filter((n) => !classificadas.has(n)).sort(),
    nasDuasListas: [...new Set(preservadas.filter((n) => negocio.includes(n)))].sort(),
    repetidasNaLista: [...new Set([...repetidas(preservadas), ...repetidas(negocio)])].sort(),
    fantasmas: [...classificadas].filter((n) => !noPublic.has(n)).sort(),
    foraDoPublic: sequences
      .filter((s) => s.schema !== "public")
      .map((s) => `${s.schema}.${s.nome}`)
      .sort(),
    colunasNumeradas: [...colunasNumeradas].sort(),
    sequencesComDono: [...sequencesComDono].sort(),
  };
}
