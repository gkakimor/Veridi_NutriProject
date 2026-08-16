import { useCallback, useEffect, useState } from "react";
import type { ReportFilters } from "../../lib/reports-api";

/** Acima disso a impressão avisa antes de gerar (pode virar muitas páginas). */
export const LARGE_REPORT_THRESHOLD = 500;

/**
 * Carrega um relatório sempre que os filtros mudam. Filtros e paginação são
 * enviados ao servidor — nunca se carrega tudo para filtrar no browser.
 *
 * A impressão usa o MESMO read model com `all=true`: o papel recebe o
 * resultado filtrado COMPLETO, nunca apenas a página aberta na tela.
 */
export function useReport<T>(
  fetcher: (filters: ReportFilters) => Promise<T>,
  filters: ReportFilters,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [printData, setPrintData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [preparingPrint, setPreparingPrint] = useState(false);
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

  /** Busca o resultado completo e dispara a impressão do navegador. */
  const print = useCallback(async () => {
    setPreparingPrint(true);
    setError(null);
    try {
      const full = await fetcher({ ...(JSON.parse(key) as ReportFilters), all: true, page: 1 });
      setPrintData(full);
      // Deixa o React pintar o conteúdo completo antes de abrir o diálogo.
      await new Promise((resolve) => setTimeout(resolve, 50));
      window.print();
      setPrintData(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Falha ao preparar a impressão");
    } finally {
      setPreparingPrint(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return {
    /** Enquanto imprime, os dados são o resultado completo. */
    data: printData ?? data,
    loading,
    error,
    print,
    preparingPrint,
    printing: printData !== null,
  };
}
