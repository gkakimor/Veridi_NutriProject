import type { UserRole } from "@veridi/shared";
import { CUSTOMER_EDIT_ROLES, USER_ROLE_LABELS } from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";

/**
 * Quem cria e edita o cadastro do Cliente, do lado da tela —
 * CUSTOMER-EDIT-PERMISSIONS-01.
 *
 * A autoridade é a API, que recusa os outros perfis com 403. Aqui a MESMA
 * lista (`CUSTOMER_EDIT_ROLES`) só decide o que a tela oferece: quem não pode
 * cadastrar não vê "+ Novo cliente", e quem não pode editar abre o Cliente em
 * consulta, sem campo editável nem "Salvar alterações" — convite que termina
 * em 403 é pior que convite nenhum.
 */

/** "Comercial ou Administrador" — lido da mesma lista que a API aplica. */
const QUEM_CADASTRA = CUSTOMER_EDIT_ROLES.map((role) => USER_ROLE_LABELS[role]).join(" ou ");

/** O caminho de quem precisa de um Cliente que ainda não existe e não pode cadastrá-lo. */
export const PEDIR_CADASTRO_DE_CLIENTE = `Solicite ao ${QUEM_CADASTRA} o cadastro do cliente.`;

export function podeEditarCliente(role: UserRole | null | undefined): boolean {
  return role !== null && role !== undefined && CUSTOMER_EDIT_ROLES.includes(role);
}

/**
 * O perfil da sessão cria e edita Cliente?
 *
 * Fora do `AuthProvider` (teste de tela isolado, pré-visualização) não há
 * sessão para julgar, e a tela se comporta como antes — o mesmo acordo da
 * Ordem de Produção e do roteiro padrão do Produto.
 */
export function usePodeEditarCliente(): boolean {
  const sessao = useOptionalAuth();
  if (sessao === null) return true;
  return podeEditarCliente(sessao.user?.role);
}

/**
 * O seletor de Cliente para quem não cadastra: sem "+ Novo cliente", a lista
 * sem resultado seria um beco sem saída. A ajuda aparece ali, no ponto em que
 * o cliente procurado não existe — e só ali.
 */
export const SELETOR_DE_CLIENTE_SEM_CADASTRO = {
  emptyMessage: `Nenhum cliente encontrado. ${PEDIR_CADASTRO_DE_CLIENTE}`,
  noOptionsMessage: `Nenhum cliente disponível. ${PEDIR_CADASTRO_DE_CLIENTE}`,
} as const;
