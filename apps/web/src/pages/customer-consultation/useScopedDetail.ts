import { useEffect, useState } from "react";
import { NotFoundApiError } from "../../lib/api-errors";

/**
 * Carga de um detalhe consultivo.
 *
 * O ponto sensível é o 404. `/consultas/clientes/CLI-A/projetos/PROJ-B` é um
 * endereço bem formado, e PROJ-B pode existir — pertencendo ao Cliente B. A
 * API responde 404 nesse caso (ela não confirma nem que a entidade existe),
 * e aqui isso vira um ESTADO da tela — "não encontrado neste cliente" — e
 * não um alerta de falha. Erro de verdade continua sendo erro.
 */
export interface ScopedDetail<T> {
  data: T | null;
  loading: boolean;
  /** A entidade não é deste Cliente, ou não existe. Mesma resposta nos dois casos. */
  notFound: boolean;
  error: string | null;
}

export function useScopedDetail<T>(
  load: () => Promise<T>,
  key: string,
): ScopedDetail<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setError(null);
    // O registro anterior sai da tela antes do novo chegar: sem isso, trocar
    // de PROJ-001 para PROJ-002 mostraria o projeto antigo sob o código novo.
    setData(null);

    load()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof NotFoundApiError) {
          setNotFound(true);
          return;
        }
        setError(err instanceof Error ? err.message : "Falha ao carregar");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `key` identifica o que está sendo carregado (cliente + entidade);
    // `load` é recriado a cada render e não serve como dependência.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, loading, notFound, error };
}
