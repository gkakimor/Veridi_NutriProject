import { useEffect, useState } from "react";
import type { ReportFilters } from "../../lib/reports-api";

/**
 * Carrega um relatório sempre que os filtros mudam. Filtros e paginação são
 * enviados ao servidor — nunca se carrega tudo para filtrar no browser.
 */
export function useReport<T>(
  fetcher: (filters: ReportFilters) => Promise<T>,
  filters: ReportFilters,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(filters);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    fetcher(JSON.parse(key) as ReportFilters)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Erro desconhecido");
        setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // `fetcher` é estável (função de módulo); a chave serializada cobre os filtros.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return { data, loading, error };
}
