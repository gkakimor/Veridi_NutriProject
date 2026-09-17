import type { UserRole } from "@veridi/shared";
import {
  ATTACHMENT_ARCHIVE_ROLES,
  PRODUCT_DOCUMENT_UPLOAD_ROLES,
  PRODUCT_EDIT_ROLES,
  PRODUCT_STATUS_CHANGE_ROLES,
} from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";
import { perfilPermite, perfisPorExtenso } from "../../lib/perfis";

/**
 * Quem cria, edita, inativa e reativa o Produto, do lado da tela —
 * MASTER-DATA-EDIT-PERMISSIONS-01.
 *
 * A autoridade é a API, que recusa com 403. Aqui as MESMAS listas decidem só o
 * que a tela oferece: quem não cadastra não vê "+ Novo produto", e quem não
 * edita abre o Produto em consulta. As seções com permissão própria — Roteiro
 * padrão, documentos, custos — continuam decidindo por si: permissão do
 * cadastro não é permissão da seção.
 */

export const QUEM_EDITA_PRODUTO = perfisPorExtenso(PRODUCT_EDIT_ROLES, "e");

/** O caminho de quem precisa de um Produto que ainda não existe e não pode cadastrá-lo. */
export const PEDIR_CADASTRO_DE_PRODUTO = `Solicite ao ${perfisPorExtenso(PRODUCT_EDIT_ROLES, "ou")} o cadastro do produto.`;

/** O seletor de Produto para quem não cadastra: a busca vazia diz a quem pedir. */
export const SELETOR_DE_PRODUTO_SEM_CADASTRO = {
  emptyMessage: `Nenhum produto encontrado. ${PEDIR_CADASTRO_DE_PRODUTO}`,
  noOptionsMessage: `Nenhum produto disponível. ${PEDIR_CADASTRO_DE_PRODUTO}`,
} as const;

export function podeEditarProduto(role: UserRole | null | undefined): boolean {
  return perfilPermite(PRODUCT_EDIT_ROLES, role);
}

export function podeMudarSituacaoDoProduto(role: UserRole | null | undefined): boolean {
  return perfilPermite(PRODUCT_STATUS_CHANGE_ROLES, role);
}

/**
 * O perfil da sessão cria e edita Produto? Fora do `AuthProvider` não há
 * sessão para julgar, e a tela se comporta como antes.
 */
export function usePodeEditarProduto(): boolean {
  const sessao = useOptionalAuth();
  if (sessao === null) return true;
  return podeEditarProduto(sessao.user?.role);
}

export interface AutoridadeNosDocumentosDoProduto {
  /** Anexar arte e ficha técnica — a Qualidade anexa sem editar o cadastro. */
  anexar: boolean;
  /** Arquivar documento — só Qualidade e Administrador. */
  arquivar: boolean;
}

/**
 * A seção Documentos do Produto tem permissão própria, com as MESMAS listas da
 * API: botão de anexar ou arquivar que terminaria em 403 não aparece. Fora do
 * `AuthProvider`, o comportamento de antes.
 */
export function useAutoridadeNosDocumentosDoProduto(): AutoridadeNosDocumentosDoProduto {
  const sessao = useOptionalAuth();
  if (sessao === null) return { anexar: true, arquivar: true };
  return {
    anexar: perfilPermite(PRODUCT_DOCUMENT_UPLOAD_ROLES, sessao.user?.role),
    arquivar: perfilPermite(ATTACHMENT_ARCHIVE_ROLES, sessao.user?.role),
  };
}
