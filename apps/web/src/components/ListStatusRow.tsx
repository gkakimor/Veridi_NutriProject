import type { ReactNode } from "react";
import { TABELA_COM_PERIODO_RECUSADO } from "../lib/list-period";

/** O que a tabela diz antes da primeira resposta do recorte. */
export const LISTA_CARREGANDO = "Carregando…";

/**
 * A linha de estado de uma tabela de listagem, lida da consulta
 * (`useListQuery`, LISTS-LOADING-STALE-DATA-01).
 *
 * Tabela sem linhas quer dizer coisas diferentes, e só uma delas é "nenhum
 * registro":
 *
 *   - período recusado — a pergunta não vale, e nada foi consultado;
 *   - recorte ainda sem resposta — ainda não se sabe;
 *   - consulta que falhou — o alerta acima da tabela diz o que houve, e a
 *     frase de vazio seria uma resposta que o servidor não deu;
 *   - resposta do recorte atual sem linhas — aí sim, o vazio da tela.
 */
export function ListStatusRow({
  colSpan,
  query,
  rowCount,
  periodRefused = false,
  children,
}: {
  colSpan: number;
  query: { data: unknown; loading: boolean };
  /** Linhas à vista na tabela. */
  rowCount: number;
  periodRefused?: boolean;
  /** O vazio da tela, com a saída que ela oferece. */
  children: ReactNode;
}) {
  let conteudo: ReactNode = null;
  if (periodRefused) conteudo = TABELA_COM_PERIODO_RECUSADO;
  else if (query.data === null) conteudo = query.loading ? LISTA_CARREGANDO : null;
  else if (rowCount === 0) conteudo = children;
  if (conteudo === null) return null;
  return (
    <tr>
      <td colSpan={colSpan} className="table__empty">
        {conteudo}
      </td>
    </tr>
  );
}
