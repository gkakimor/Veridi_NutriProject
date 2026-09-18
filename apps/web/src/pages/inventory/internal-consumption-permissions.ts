import type { UserRole } from "@veridi/shared";
import {
  INTERNAL_CONSUMPTION_REVERSAL_ROLES,
  INTERNAL_CONSUMPTION_WRITE_ROLES,
  USER_ROLE_LABELS,
} from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";

/**
 * Quem registra consumo interno, do lado da tela — INTERNAL-CONSUMPTION-01.
 *
 * A autoridade é a API, que recusa os outros perfis com 403. Aqui a MESMA
 * lista só decide o que a tela oferece: a leitura do histórico continua de
 * todos, e quem não registra não vê um formulário que terminaria em recusa.
 */

/** "A, B ou C" com os nomes dos perfis, na ordem da lista que a API aplica. */
function perfisPorExtenso(roles: readonly UserRole[]): string {
  const nomes = roles.map((role) => USER_ROLE_LABELS[role]);
  return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} ou ${nomes[nomes.length - 1]}`;
}

/** "Administrador, Compras, Produção ou Qualidade" — lido da lista que a API aplica. */
export const QUEM_REGISTRA_CONSUMO_INTERNO = perfisPorExtenso(INTERNAL_CONSUMPTION_WRITE_ROLES);

/** "Administrador ou Qualidade" — quem estorna (INTERNAL-CONSUMPTION-REVERSAL-01). */
export const QUEM_ESTORNA_CONSUMO_INTERNO = perfisPorExtenso(INTERNAL_CONSUMPTION_REVERSAL_ROLES);

export function podeRegistrarConsumo(role: UserRole | null | undefined): boolean {
  return role !== null && role !== undefined && INTERNAL_CONSUMPTION_WRITE_ROLES.includes(role);
}

/** Estornar é lista PRÓPRIA: registrar consumo não dá direito a desfazê-lo. */
export function podeEstornarConsumo(role: UserRole | null | undefined): boolean {
  return role !== null && role !== undefined && INTERNAL_CONSUMPTION_REVERSAL_ROLES.includes(role);
}

/** O perfil da sessão estorna consumo interno? Mesmo acordo de `usePodeRegistrarConsumo`. */
export function usePodeEstornarConsumo(): boolean {
  const sessao = useOptionalAuth();
  if (sessao === null) return true;
  return podeEstornarConsumo(sessao.user?.role);
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
