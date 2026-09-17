import type { UserRole } from "@veridi/shared";
import { INTERNAL_CONSUMPTION_WRITE_ROLES, USER_ROLE_LABELS } from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";

/**
 * Quem registra consumo interno, do lado da tela — INTERNAL-CONSUMPTION-01.
 *
 * A autoridade é a API, que recusa os outros perfis com 403. Aqui a MESMA
 * lista só decide o que a tela oferece: a leitura do histórico continua de
 * todos, e quem não registra não vê um formulário que terminaria em recusa.
 */

/** "Administrador, Compras, Produção ou Qualidade" — lido da lista que a API aplica. */
export const QUEM_REGISTRA_CONSUMO_INTERNO = (() => {
  const nomes = INTERNAL_CONSUMPTION_WRITE_ROLES.map((role) => USER_ROLE_LABELS[role]);
  return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} ou ${nomes[nomes.length - 1]}`;
})();

export function podeRegistrarConsumo(role: UserRole | null | undefined): boolean {
  return role !== null && role !== undefined && INTERNAL_CONSUMPTION_WRITE_ROLES.includes(role);
}

/**
 * O perfil da sessão registra consumo interno?
 *
 * Fora do `AuthProvider` (teste de tela isolado) não há sessão para julgar, e
 * a tela se comporta como para quem registra — o mesmo acordo do Inventário
 * Físico. Com provider e sem usuário, não registra.
 */
export function usePodeRegistrarConsumo(): boolean {
  const sessao = useOptionalAuth();
  if (sessao === null) return true;
  return podeRegistrarConsumo(sessao.user?.role);
}
