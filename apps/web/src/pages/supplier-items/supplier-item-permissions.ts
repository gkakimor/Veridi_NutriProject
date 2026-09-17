import type { UserRole } from "@veridi/shared";
import { SUPPLIER_ITEM_EDIT_ROLES, SUPPLIER_ITEM_QUALIFICATION_ROLES } from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";
import { perfilPermite, perfisPorExtenso } from "../../lib/perfis";

/**
 * Quem decide a homologação da relação Item × Fornecedor, do lado da tela —
 * ITEM-SUPPLIER-QUALIFICATION-PERMISSION-01.
 *
 * A autoridade é a API: homologar e bloquear, na rota de homologação ou já na
 * criação, são 403 para quem não está na lista. Aqui a MESMA lista decide só o
 * que a tela oferece — quem não decide cria a relação Pendente, sem seletor de
 * situação que terminaria em recusa.
 */

/** "Qualidade ou Administrador" — lido da lista que a API aplica. */
export const QUEM_HOMOLOGA_A_RELACAO = perfisPorExtenso(SUPPLIER_ITEM_QUALIFICATION_ROLES, "ou");

export function podeDecidirHomologacao(role: UserRole | null | undefined): boolean {
  return perfilPermite(SUPPLIER_ITEM_QUALIFICATION_ROLES, role);
}

/**
 * O perfil da sessão homologa e bloqueia? Fora do `AuthProvider` não há sessão
 * para julgar, e a tela se comporta como antes.
 */
export function usePodeDecidirHomologacao(): boolean {
  const sessao = useOptionalAuth();
  if (sessao === null) return true;
  return podeDecidirHomologacao(sessao.user?.role);
}

/** "Compras ou Administrador" — quem cria a relação e define o preferencial, lido da lista da API. */
export const QUEM_MANTEM_A_RELACAO = perfisPorExtenso(SUPPLIER_ITEM_EDIT_ROLES, "ou");

/**
 * Cria a relação, altera os dados comerciais, registra oferta e define o
 * preferencial (`SUPPLIER_ITEM_EDIT_ROLES`) — ITEM-SUPPLIER-UX-01 usa a mesma
 * lista no cadastro do Item.
 */
export function podeManterRelacao(role: UserRole | null | undefined): boolean {
  return perfilPermite(SUPPLIER_ITEM_EDIT_ROLES, role);
}

/** O perfil da sessão mantém a relação? Fora do `AuthProvider`, como os demais: sem sessão para julgar. */
export function usePodeManterRelacao(): boolean {
  const sessao = useOptionalAuth();
  if (sessao === null) return true;
  return podeManterRelacao(sessao.user?.role);
}
