import type { UserRole } from "@veridi/shared";
import { ACQUISITION_COST_ROLES } from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";
import { perfilPermite, perfisPorExtenso } from "../../lib/perfis";

/**
 * Quem informa o custo efetivo de aquisição, do lado da tela —
 * ACQUISITION-COST-PERMISSION-01.
 *
 * A autoridade é a API: o PUT do custo e o recebimento que traz custo são 403
 * para quem não está na lista. Aqui a MESMA lista decide só o que a tela
 * oferece — quem não informa consulta o custo normalmente, sem "Definir custo"
 * no documento e sem o campo de custo em "Receber OC".
 */

/** "Compras ou Administrador" — lido da lista que a API aplica. */
export const QUEM_INFORMA_CUSTO_DE_AQUISICAO = perfisPorExtenso(ACQUISITION_COST_ROLES, "ou");

/** A frase de quem recebe sem o campo de custo: de quem é e onde ele entra. */
export const CUSTO_DE_AQUISICAO_POR_OUTRO_PERFIL = `O custo efetivo de aquisição é informado por ${QUEM_INFORMA_CUSTO_DE_AQUISICAO}, no documento do recebimento.`;

export function podeInformarCustoDeAquisicao(role: UserRole | null | undefined): boolean {
  return perfilPermite(ACQUISITION_COST_ROLES, role);
}

/**
 * O perfil da sessão informa custo de aquisição? Fora do `AuthProvider` (teste de
 * tela isolado) não há sessão para julgar, e a tela se comporta como antes — o
 * mesmo acordo do Cliente, do Item e da relação Item × Fornecedor.
 */
export function usePodeInformarCustoDeAquisicao(): boolean {
  const sessao = useOptionalAuth();
  if (sessao === null) return true;
  return podeInformarCustoDeAquisicao(sessao.user?.role);
}
