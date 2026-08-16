import type { ZodTypeAny } from "zod";
import type { CsvColumn } from "../../lib/csv.js";
import { buildCsv, csvFileName } from "../../lib/csv.js";

/**
 * Definição de uma exportação CSV.
 *
 * O contrato é sempre o mesmo: MESMO schema de filtros da tela, MESMO
 * serviço/read model, resultado completo (`ALL_ROWS`) e um mapeamento de
 * colunas legível. Não existe endpoint genérico recebendo nome de
 * tabela/consulta arbitrária.
 */
export interface CsvExportDefinition<TQuery, TRow> {
  /** Rota explícita, no padrão `.../export.csv`. */
  path: string;
  /** Base do nome do arquivo (`veridi_<slug>_<data>.csv`). */
  slug: string;
  schema: ZodTypeAny;
  fetch: (query: TQuery) => Promise<TRow[]>;
  columns: CsvColumn<TRow>[];
  /** Período aplicado, quando existir — entra no nome do arquivo. */
  period?: (query: TQuery) => { from?: Date; to?: Date };
}

/**
 * Exportação já com os tipos fechados dentro do closure — o registro de
 * rotas manipula só `path`/`schema`/`build`, sem precisar de `any`.
 */
export interface CsvExportRoute {
  path: string;
  slug: string;
  schema: ZodTypeAny;
  build: (query: unknown) => Promise<string>;
  fileName: (query: unknown) => string;
}

export function defineCsvExport<TQuery, TRow>(
  definition: CsvExportDefinition<TQuery, TRow>,
): CsvExportRoute {
  return {
    path: definition.path,
    slug: definition.slug,
    schema: definition.schema,
    build: async (query) => buildCsv(definition.columns, await definition.fetch(query as TQuery)),
    fileName: (query) => csvFileName(definition.slug, definition.period?.(query as TQuery)),
  };
}
