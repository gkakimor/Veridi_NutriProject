/**
 * Paginação das consultas.
 *
 * Filtro e paginação são conceitos separados: o filtro define o CONJUNTO, a
 * paginação apenas a fatia devolvida à tela. A exportação usa exatamente os
 * mesmos filtros pedindo `ALL_ROWS` — nunca um `pageSize` gigante como
 * gambiarra, nunca uma segunda construção de query.
 */

export const ALL_ROWS = "ALL" as const;

export type Pagination = typeof ALL_ROWS | { page: number; pageSize: number };

/** `skip`/`take` do Prisma; vazio quando o pedido é o resultado completo. */
export function pageArgs(pagination: Pagination): { skip?: number; take?: number } {
  if (pagination === ALL_ROWS) return {};
  return {
    skip: (pagination.page - 1) * pagination.pageSize,
    take: pagination.pageSize,
  };
}

/** Fatia em memória, para read models que só conseguem paginar depois de montar. */
export function slicePage<T>(rows: T[], pagination: Pagination): T[] {
  if (pagination === ALL_ROWS) return rows;
  return rows.slice(
    (pagination.page - 1) * pagination.pageSize,
    pagination.page * pagination.pageSize,
  );
}

/** Metadados coerentes: exportando, a "página" é o resultado inteiro. */
export function pageMeta(
  pagination: Pagination,
  total: number,
): { page: number; pageSize: number; total: number } {
  if (pagination === ALL_ROWS) return { page: 1, pageSize: total, total };
  return { page: pagination.page, pageSize: pagination.pageSize, total };
}
