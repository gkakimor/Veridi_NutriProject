import { useCallback, useEffect, useState } from "react";

/**
 * Estado das quatro listas da Consulta (Projetos, Pedidos, Materiais,
 * Faturamentos).
 *
 * As quatro fazem exatamente a mesma coisa: buscar uma página do endpoint
 * operacional já filtrado por `customerId`, e mostrar erro, vazio ou tabela.
 * O que muda entre elas são as COLUNAS — então o que é comum vive aqui e
 * cada aba fica só com a sua tabela.
 *
 * A paginação dos endpoints é preservada de propósito: a Consulta nunca pede
 * a lista inteira. Um cliente com 500 projetos não pode transformar a aba
 * numa consulta que trava a tela.
 */

export const CONSULTATION_PAGE_SIZE = 20;

export interface ScopedList<T> {
  rows: T[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  setPage: (page: number) => void;
}

export function useScopedList<T>(
  load: (page: number, pageSize: number) => Promise<{ rows: T[]; total: number }>,
  customerId: string,
): ScopedList<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Trocar de cliente volta para a primeira página: manter a página 3 do
  // cliente anterior mostraria "nenhum resultado" para um cliente que tem
  // dados, o que parece defeito.
  useEffect(() => {
    setPage(1);
  }, [customerId]);

  const run = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    load(page, CONSULTATION_PAGE_SIZE)
      .then((result) => {
        // Resposta de uma busca abandonada (o operador já trocou de página
        // ou de cliente) nunca sobrescreve a atual.
        if (cancelled) return;
        setRows(result.rows);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRows([]);
        setTotal(0);
        setError(err instanceof Error ? err.message : "Falha ao carregar");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [load, page]);

  useEffect(run, [run]);

  return {
    rows,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / CONSULTATION_PAGE_SIZE)),
    loading,
    error,
    setPage,
  };
}
