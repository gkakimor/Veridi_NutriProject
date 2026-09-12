import { API_URL } from "../lib/api";

/**
 * Baixa o CSV da listagem/relatório atual.
 *
 * O arquivo é gerado NO SERVIDOR a partir do mesmo read model e dos mesmos
 * filtros da tela — nunca a partir das linhas já renderizadas e nunca só da
 * página aberta. Por isso o link carrega os filtros, mas nenhum parâmetro
 * de paginação.
 */
export function ExportCsvButton({
  path,
  filters,
  label = "Exportar CSV",
}: {
  /** Rota explícita, ex.: `/customers/export.csv`. */
  path: string;
  /**
   * O MESMO objeto de filtros que a tela manda para a listagem.
   *
   * Lista de valores (a situação "Em aberto" é um conjunto de status) viaja
   * separada por vírgula, que é como a API a lê na listagem e no CSV — sem
   * isto a tela teria de montar uma segunda versão do filtro só para o botão.
   */
  filters?: Record<string, string | number | boolean | readonly string[] | undefined>;
  label?: string;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value === undefined || value === "") continue;
    // Paginação nunca vai para a exportação: o CSV é o resultado completo.
    if (key === "page" || key === "pageSize") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) query.set(key, value.join(","));
      continue;
    }
    query.set(key, String(value));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";

  return (
    <a className="btn btn--secondary btn--sm" href={`${API_URL}${path}${suffix}`} download>
      {label}
    </a>
  );
}
