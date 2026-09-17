import type { UserRole } from "@veridi/shared";
import { STOCK_COUNT_WRITE_ROLES, USER_ROLE_LABELS } from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";

/**
 * Quem opera o Inventário Físico, do lado da tela — INVENTORY-PHYSICAL-COUNT-01, Fatia 2A.
 *
 * A autoridade é a API, que recusa os outros perfis com 403. Aqui a MESMA
 * lista (`STOCK_COUNT_WRITE_ROLES`) só decide o que a tela oferece: o menu e as
 * leituras continuam de todos, e quem não opera não vê "Novo inventário",
 * "Contagem rápida", "Contar", nem ação nenhuma que terminaria em recusa.
 */

/** "Administrador, Produção ou Qualidade" — lido da mesma lista que a API aplica. */
export const QUEM_OPERA_INVENTARIO = (() => {
  const nomes = STOCK_COUNT_WRITE_ROLES.map((role) => USER_ROLE_LABELS[role]);
  return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} ou ${nomes[nomes.length - 1]}`;
})();

export function podeOperarInventario(role: UserRole | null | undefined): boolean {
  return role !== null && role !== undefined && STOCK_COUNT_WRITE_ROLES.includes(role);
}

/**
 * O perfil da sessão opera inventário?
 *
 * Fora do `AuthProvider` (teste de tela isolado) não há sessão para julgar, e a
 * tela se comporta como para quem opera — o mesmo acordo do Cliente e da
 * Ordem de Produção. Com provider e sem usuário (sessão ainda carregando ou
 * caída), não opera.
 */
export function usePodeOperarInventario(): boolean {
  const sessao = useOptionalAuth();
  if (sessao === null) return true;
  return podeOperarInventario(sessao.user?.role);
}
