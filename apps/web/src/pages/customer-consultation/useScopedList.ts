import { useFilteredPage, useListQuery } from "../../lib/list-query";

/**
 * Estado das listas da Consulta (Produtos, Projetos, Pedidos, Produção,
 * Estoque e Faturamentos).
 *
 * Todas fazem exatamente a mesma coisa: buscar uma página do endpoint
 * operacional já filtrado por `customerId`, e mostrar erro, vazio ou tabela.
 * O que muda entre elas são as COLUNAS — então o que é comum vive aqui e
 * cada aba fica só com a sua tabela.
 *
 * A paginação dos endpoints é preservada de propósito: a Consulta nunca pede
 * a lista inteira. Um cliente com 500 projetos não pode transformar a aba
 * numa consulta que trava a tela.
 *
 * A consulta é a das listagens (`useListQuery`, LISTS-LOADING-STALE-DATA-02).
 * A resposta atrasada já não sobrescrevia a atual, mas as linhas do cliente
 * anterior ficavam na tabela até o novo responder, a falha limpava as linhas
 * e deixava o "Nenhum … encontrado" junto do alerta, e a página voltava à 1
 * por efeito — o cliente novo saía primeiro com a página do anterior, numa
 * consulta a mais.
 */

export const CONSULTATION_PAGE_SIZE = 20;

export interface ScopedList<T> {
  rows: T[];
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  /**
   * A resposta do cliente atual: `null` antes dela e na falha. Contagem e
   * paginação só existem com ela (`ListStatusRow` lê daqui).
   */
  data: { rows: T[]; total: number } | null;
  setPage: (page: number) => void;
}

interface Consulta {
  customerId: string;
  page: number;
  pageSize: number;
}

/**
 * `load` responde pelo cliente de `customerId`, e só por ele: é o cliente
 * que diz se a consulta é outra. Dependência nova de `load` precisa entrar
 * na chave junto.
 */
export function useScopedList<T>(
  load: (page: number, pageSize: number) => Promise<{ rows: T[]; total: number }>,
  customerId: string,
): ScopedList<T> {
  // Trocar de cliente volta para a primeira página no mesmo render: manter a
  // página 3 do cliente anterior mostraria "nenhum resultado" para um cliente
  // que tem dados, o que parece defeito.
  const [page, setPage] = useFilteredPage({ customerId });

  const consulta = useListQuery(
    (params: Consulta) => load(params.page, params.pageSize),
    { customerId, page, pageSize: CONSULTATION_PAGE_SIZE },
    { fallbackError: "Falha ao carregar" },
  );

  const total = consulta.data?.total ?? 0;
  return {
    rows: consulta.data?.rows ?? [],
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / CONSULTATION_PAGE_SIZE)),
    loading: consulta.loading,
    error: consulta.error,
    data: consulta.data,
    setPage,
  };
}
