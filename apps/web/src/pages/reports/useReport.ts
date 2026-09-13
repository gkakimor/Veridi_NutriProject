import { useEffect, useState } from "react";
import type { ReportFilters } from "../../lib/reports-api";

/**
 * Carrega um relatório sempre que os filtros mudam. Filtros e paginação são
 * enviados ao servidor — nunca se carrega tudo para filtrar no browser.
 *
 * A impressão NÃO acontece aqui: ela vive numa rota dedicada
 * (`/print/relatorios/:code`), que busca o resultado filtrado COMPLETO pelo
 * mesmo read model. A tela operacional nunca é impressa.
 *
 * Resposta de OUTRO recorte não fica à vista enquanto o novo carrega
 * (SMALL-UX-CLEANUP-WAVE-01): a tabela, o resumo e a paginação do filtro
 * anterior, debaixo de um "Carregando…", se liam como o resultado do filtro
 * que a pessoa acabou de escolher. Trocar de PÁGINA é outra coisa — o recorte
 * é o mesmo, e a página aberta continua até a próxima chegar, sem esvaziar a
 * tabela a cada "Próxima".
 */
export function useReport<T>(
  fetcher: (filters: ReportFilters) => Promise<T>,
  filters: ReportFilters,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const key = JSON.stringify(filters);
  /** A última resposta que chegou, com a chave da consulta que a pediu. */
  const [resposta, setResposta] = useState<{ key: string; data: T | null; error: string | null } | null>(
    null,
  );

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetcher(JSON.parse(key) as ReportFilters)
      .then((result) => {
        if (active) setResposta({ key, data: result, error: null });
      })
      .catch((err: unknown) => {
        if (!active) return;
        setResposta({ key, data: null, error: err instanceof Error ? err.message : "Erro desconhecido" });
      });
    return () => {
      active = false;
    };
    // `fetcher` é estável (função de módulo); a chave serializada cobre os filtros.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  if (!enabled) return { data: null, loading: false, error: null };

  // Derivado no próprio render, e não marcado por efeito: no quadro entre o
  // filtro novo e o efeito, a tela não mostra a resposta velha sem o
  // "Carregando…", nem a tabela vazia como se o recorte não tivesse registros.
  const loading = resposta?.key !== key;
  const mesmoRecorte = resposta !== null && recorteDe(resposta.key) === recorteDe(key);
  return {
    data: mesmoRecorte ? resposta.data : null,
    loading,
    error: loading ? null : (resposta?.error ?? null),
  };
}

/** A consulta sem a paginação: o mesmo recorte, em qualquer página. */
function recorteDe(key: string): string {
  const { page: _pagina, pageSize: _tamanho, ...recorte } = JSON.parse(key) as ReportFilters;
  return JSON.stringify(recorte);
}
