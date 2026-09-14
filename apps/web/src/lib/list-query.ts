import { useCallback, useEffect, useState } from "react";

/**
 * Consulta de uma listagem paginada — resposta, carregando e erro
 * (LISTS-LOADING-STALE-DATA-01).
 *
 * Cada lista guardava linhas, total, `loading` e erro em `useState` soltos e
 * trocava tudo quando uma resposta chegava. Três defeitos saíam daí juntos:
 *
 *   - no filtro novo, a tabela, o total e as páginas do filtro ANTERIOR
 *     ficavam à vista até a resposta chegar, e se liam como o resultado do
 *     que a pessoa acabou de escolher;
 *   - a última resposta a CHEGAR virava a tela, não a última pedida: filtro A,
 *     depois B, depois C, com as respostas chegando C, B, A, deixava A à vista
 *     debaixo dos filtros de C;
 *   - a falha aparecia junto das linhas de antes — e, na primeira carga, junto
 *     do "Nenhum … encontrado".
 *
 * O mesmo padrão do `useReport`: a resposta guarda a chave da consulta que a
 * pediu, e o que a tela mostra é derivado no próprio render. Trocar de PÁGINA
 * é outra coisa — o recorte é o mesmo, e a página aberta continua até a
 * próxima chegar, sem esvaziar a tabela a cada "Próxima".
 */

export interface ListQuery<T> {
  /**
   * A resposta do recorte atual. `null` antes da primeira resposta dele, com o
   * recorte recusado e quando a consulta falhou — nunca a de outro recorte.
   */
  data: T | null;
  /** Consulta em curso: recorte novo, página nova ou recarga. */
  loading: boolean;
  /** A falha da consulta atual. Some enquanto outra consulta carrega. */
  error: string | null;
  /** Consulta de novo o mesmo recorte e a mesma página (depois de uma ação na lista). */
  reload: () => void;
}

export interface ListQueryOptions {
  /**
   * `false` não consulta — o período recusado, por exemplo. Sem resposta, sem
   * carregando e sem erro: a tela diz por que não há consulta.
   */
  enabled?: boolean;
  /** A frase quando a falha não traz a sua. */
  fallbackError?: string;
}

interface Resposta<T> {
  key: string;
  recarga: number;
  data: T | null;
  error: string | null;
}

export function useListQuery<P extends object, T>(
  fetcher: (params: P) => Promise<T>,
  params: P,
  options: ListQueryOptions = {},
): ListQuery<T> {
  const enabled = options.enabled ?? true;
  const fallbackError = options.fallbackError ?? "Falha ao carregar a lista";
  const key = JSON.stringify(params);
  const [recarga, setRecarga] = useState(0);
  const [resposta, setResposta] = useState<Resposta<T> | null>(null);

  /*
   * Desligada, a lista esquece a resposta que tinha. Quem recusa o período e
   * volta ao recorte de antes vê a consulta sair de novo — não a resposta de
   * antes da recusa servida como se fosse agora. Ajuste no render, e não em
   * efeito: no quadro seguinte ao religar, a tela já não tem o que esconder.
   */
  const [ligada, setLigada] = useState(enabled);
  if (ligada !== enabled) {
    setLigada(enabled);
    if (!enabled) setResposta(null);
  }

  useEffect(() => {
    if (!enabled) return;
    let ativa = true;
    fetcher(JSON.parse(key) as P)
      .then((data) => {
        if (ativa) setResposta({ key, recarga, data, error: null });
      })
      .catch((err: unknown) => {
        if (!ativa) return;
        setResposta({
          key,
          recarga,
          data: null,
          error: err instanceof Error ? err.message : fallbackError,
        });
      });
    /*
     * A consulta que deixou de ser a atual — outro filtro, outra página, a
     * tela fechada — não escreve mais nada quando responder.
     */
    return () => {
      ativa = false;
    };
    // `fetcher` é função de módulo e `fallbackError` é texto fixo da tela; a
    // chave serializada cobre os filtros e a página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, recarga, enabled]);

  const reload = useCallback(() => setRecarga((atual) => atual + 1), []);

  if (!enabled) return { data: null, loading: false, error: null, reload };

  const loading = resposta === null || resposta.key !== key || resposta.recarga !== recarga;
  const mesmoRecorte = resposta !== null && recorteDe(resposta.key) === recorteDe(key);
  return {
    data: mesmoRecorte ? resposta.data : null,
    loading,
    error: loading ? null : (resposta?.error ?? null),
    reload,
  };
}

/** A consulta sem a paginação: o mesmo recorte, em qualquer página. */
function recorteDe(key: string): string {
  const { page: _pagina, pageSize: _tamanho, ...recorte } = JSON.parse(key) as Record<string, unknown>;
  return JSON.stringify(recorte);
}

/**
 * A página de uma lista que guarda os filtros em estado (e não na URL).
 *
 * Voltar para a página 1 por efeito — `useEffect(() => setPage(1), [filtros])`
 * — consultava DUAS vezes a cada filtro trocado fora da primeira página: o
 * render do filtro novo ainda levava a página antiga, e só o seguinte levava
 * a 1. A página aqui pertence ao recorte em que foi escolhida: filtro novo é
 * página 1 no mesmo render, e sai uma consulta só.
 */
export function useFilteredPage(filters: object): [number, (page: number) => void] {
  const recorte = JSON.stringify(filters);
  const [guardada, setGuardada] = useState({ recorte, page: 1 });
  /* Esquece a página do recorte que saiu: voltar a ele não reabre a página 3. */
  if (guardada.recorte !== recorte) setGuardada({ recorte, page: 1 });
  const page = guardada.recorte === recorte ? guardada.page : 1;
  const setPage = useCallback((proxima: number) => setGuardada({ recorte, page: proxima }), [recorte]);
  return [page, setPage];
}
