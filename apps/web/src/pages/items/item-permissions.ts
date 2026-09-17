import type { UserRole } from "@veridi/shared";
import {
  ITEM_COST_REFERENCE_ROLES,
  ITEM_DEACTIVATE_ROLES,
  ITEM_EDIT_ROLES,
  ITEM_PRODUCTION_CONSUMPTION_ROLES,
  ITEM_QUALITY_CONTROL_ROLES,
  ITEM_REACTIVATE_ROLES,
} from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";
import { perfilPermite, perfisPorExtenso } from "../../lib/perfis";

/**
 * Quem faz o quê no cadastro do Item, do lado da tela —
 * MASTER-DATA-EDIT-PERMISSIONS-01.
 *
 * A autoridade é a API, que recusa com 403. Aqui as MESMAS listas decidem só o
 * que a tela oferece: quem não cria não vê "+ Novo item de estoque", quem não
 * edita abre o Item em consulta, e dentro do cadastro os controles, a marca de
 * consumo e o custo inicial ficam só com quem os decide — convite que termina
 * em 403 é pior que convite nenhum.
 */

export const QUEM_EDITA_ITEM = perfisPorExtenso(ITEM_EDIT_ROLES, "e");
export const QUEM_ALTERA_CONTROLES_DO_ITEM = perfisPorExtenso(ITEM_QUALITY_CONTROL_ROLES, "ou");
export const QUEM_MARCA_CONSUMO_NA_PRODUCAO = perfisPorExtenso(
  ITEM_PRODUCTION_CONSUMPTION_ROLES,
  "ou",
);

/** O caminho de quem precisa de um Item que ainda não existe e não pode cadastrá-lo. */
export const PEDIR_CADASTRO_DE_ITEM = `Solicite a ${perfisPorExtenso(ITEM_EDIT_ROLES, "ou")} o cadastro do item.`;

/**
 * O seletor de Item para quem não cadastra: sem "+ Novo item de estoque", a
 * busca sem resultado seria um beco sem saída. A ajuda aparece ali — e só ali.
 */
export const SELETOR_DE_ITEM_SEM_CADASTRO = {
  emptyMessage: `Nenhum item encontrado. ${PEDIR_CADASTRO_DE_ITEM}`,
  noOptionsMessage: `Nenhum item disponível. ${PEDIR_CADASTRO_DE_ITEM}`,
} as const;

export interface AutoridadeNoItemDaTela {
  /** Cria e edita identidade, classificação e códigos. */
  editar: boolean;
  /** Altera os quatro controles de rastreabilidade e qualidade. */
  controles: boolean;
  /** Marca e desmarca "Consumido na produção". */
  consumoNaProducao: boolean;
  /** Define referência de custo — inclusive a inicial, na criação. */
  custoDeReferencia: boolean;
  inativar: boolean;
  reativar: boolean;
}

export function autoridadeNoItem(role: UserRole | null | undefined): AutoridadeNoItemDaTela {
  return {
    editar: perfilPermite(ITEM_EDIT_ROLES, role),
    controles: perfilPermite(ITEM_QUALITY_CONTROL_ROLES, role),
    consumoNaProducao: perfilPermite(ITEM_PRODUCTION_CONSUMPTION_ROLES, role),
    custoDeReferencia: perfilPermite(ITEM_COST_REFERENCE_ROLES, role),
    inativar: perfilPermite(ITEM_DEACTIVATE_ROLES, role),
    reativar: perfilPermite(ITEM_REACTIVATE_ROLES, role),
  };
}

const TUDO: AutoridadeNoItemDaTela = {
  editar: true,
  controles: true,
  consumoNaProducao: true,
  custoDeReferencia: true,
  inativar: true,
  reativar: true,
};

/**
 * A autoridade da sessão no Item.
 *
 * Fora do `AuthProvider` (teste de tela isolado, pré-visualização) não há
 * sessão para julgar, e a tela se comporta como antes — o mesmo acordo do
 * Cliente, da Ordem de Produção e do roteiro padrão do Produto.
 */
export function useAutoridadeNoItem(): AutoridadeNoItemDaTela {
  const sessao = useOptionalAuth();
  if (sessao === null) return TUDO;
  return autoridadeNoItem(sessao.user?.role);
}

/** Atalho dos pontos que só perguntam "cadastra Item?" — OC, Formulação, relação. */
export function usePodeCriarItem(): boolean {
  return useAutoridadeNoItem().editar;
}
