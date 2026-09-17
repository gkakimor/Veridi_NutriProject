import type { UserRole } from "@veridi/shared";
import { SUPPLIER_EDIT_ROLES, SUPPLIER_STATUS_CHANGE_ROLES } from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";
import { perfilPermite, perfisPorExtenso } from "../../lib/perfis";

/**
 * Quem cria, edita, inativa e reativa o Fornecedor, do lado da tela —
 * MASTER-DATA-EDIT-PERMISSIONS-01.
 *
 * A autoridade é a API, que recusa com 403. Aqui as MESMAS listas decidem só o
 * que a tela oferece: quem não cadastra não vê "+ Novo fornecedor", e quem não
 * edita abre o Fornecedor em consulta. A homologação continua na relação Item ×
 * Fornecedor, com regra própria.
 */

export const QUEM_EDITA_FORNECEDOR = perfisPorExtenso(SUPPLIER_EDIT_ROLES, "e");

/** O caminho de quem precisa de um Fornecedor que ainda não existe e não pode cadastrá-lo. */
export const PEDIR_CADASTRO_DE_FORNECEDOR = `Solicite a ${perfisPorExtenso(SUPPLIER_EDIT_ROLES, "ou")} o cadastro do fornecedor.`;

/** O seletor de Fornecedor para quem não cadastra: a busca vazia diz a quem pedir. */
export const SELETOR_DE_FORNECEDOR_SEM_CADASTRO = {
  emptyMessage: `Nenhum fornecedor encontrado. ${PEDIR_CADASTRO_DE_FORNECEDOR}`,
  noOptionsMessage: `Nenhum fornecedor disponível. ${PEDIR_CADASTRO_DE_FORNECEDOR}`,
} as const;

export function podeEditarFornecedor(role: UserRole | null | undefined): boolean {
  return perfilPermite(SUPPLIER_EDIT_ROLES, role);
}

export function podeMudarSituacaoDoFornecedor(role: UserRole | null | undefined): boolean {
  return perfilPermite(SUPPLIER_STATUS_CHANGE_ROLES, role);
}

/**
 * O perfil da sessão cria e edita Fornecedor? Fora do `AuthProvider` não há
 * sessão para julgar, e a tela se comporta como antes.
 */
export function usePodeEditarFornecedor(): boolean {
  const sessao = useOptionalAuth();
  if (sessao === null) return true;
  return podeEditarFornecedor(sessao.user?.role);
}
