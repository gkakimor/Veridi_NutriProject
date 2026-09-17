import type {
  ItemQualityControlField,
  ItemQualityControls,
  UserRole,
} from "@veridi/shared";
import {
  ITEM_COST_REFERENCE_ROLES,
  ITEM_PRODUCTION_CONSUMPTION_ROLES,
  ITEM_QUALITY_CONTROL_FIELDS,
  ITEM_QUALITY_CONTROL_LABELS,
  ITEM_QUALITY_CONTROL_ROLES,
  USER_ROLE_LABELS,
} from "@veridi/shared";
import { ForbiddenError } from "../auth/auth.errors.js";

/**
 * O que o perfil decide DENTRO do cadastro do Item — MASTER-DATA-EDIT-PERMISSIONS-01.
 *
 * Criar e editar o Item é conferido na rota, antes do corpo
 * (`ITEM_EDIT_ROLES`). Três partes do cadastro têm dono mais estreito, e só dá
 * para julgá-las lendo o pedido — e, na edição, o registro gravado:
 *
 * - os quatro controles de rastreabilidade e qualidade (Qualidade e ADMIN);
 * - a marca "Consumido na produção" (Produção e ADMIN);
 * - a referência de custo inicial (Comercial e ADMIN).
 *
 * O gate é pela MUDANÇA, nunca pela presença da chave: a tela do Item manda os
 * quatro controles em todo salvamento, e quem não pode alterá-los precisa
 * continuar salvando o resto do cadastro com os valores que já estão lá.
 */
export interface AutoridadeNoItem {
  controles: boolean;
  consumoNaProducao: boolean;
  custoDeReferencia: boolean;
}

export function autoridadeNoItem(role: UserRole): AutoridadeNoItem {
  return {
    controles: ITEM_QUALITY_CONTROL_ROLES.includes(role),
    consumoNaProducao: ITEM_PRODUCTION_CONSUMPTION_ROLES.includes(role),
    custoDeReferencia: ITEM_COST_REFERENCE_ROLES.includes(role),
  };
}

/** "Qualidade ou Administrador" — lido da mesma lista que o gate aplica. */
function quem(roles: readonly UserRole[]): string {
  return roles.map((role) => USER_ROLE_LABELS[role]).join(" ou ");
}

/**
 * Os controles que o pedido MUDA em relação à base — o valor gravado, na
 * edição; o padrão canônico do tipo, na criação. Chave ausente não muda nada.
 */
export function controlesAlterados(
  base: ItemQualityControls,
  pedido: Partial<Record<ItemQualityControlField, boolean | undefined>>,
): ItemQualityControlField[] {
  return ITEM_QUALITY_CONTROL_FIELDS.filter(
    (campo) => pedido[campo] !== undefined && pedido[campo] !== base[campo],
  );
}

/**
 * Recusa de controle alterado por quem não é da Qualidade. Diz QUAIS controles,
 * com os rótulos da tela, e o caminho: na criação, os padrões do tipo.
 */
export function recusaDosControles(
  campos: readonly ItemQualityControlField[],
  momento: "criacao" | "edicao",
): ForbiddenError {
  const nomes = campos.map((campo) => ITEM_QUALITY_CONTROL_LABELS[campo]).join(", ");
  const donos = quem(ITEM_QUALITY_CONTROL_ROLES);
  return new ForbiddenError(
    momento === "criacao"
      ? `Controles de rastreabilidade fora do padrão do tipo (${nomes}) só podem ser definidos por ${donos}. Crie o item com os controles padrão.`
      : `Seu perfil não altera os controles de rastreabilidade do item (${nomes}) — só ${donos}.`,
  );
}

export function recusaDoConsumoNaProducao(): ForbiddenError {
  return new ForbiddenError(
    `Seu perfil não altera "Consumido na produção" — só ${quem(ITEM_PRODUCTION_CONSUMPTION_ROLES)}.`,
  );
}

/**
 * Pedir referência de custo sem ser do custeio é recusado, nunca ignorado: o
 * item criado sem o custo pedido deixaria quem cadastrou achando que ele tem
 * custo.
 */
export function recusaDoCustoInicial(): ForbiddenError {
  return new ForbiddenError(
    `Seu perfil não define custo de referência — só ${quem(ITEM_COST_REFERENCE_ROLES)}. Crie o item sem o custo de referência inicial.`,
  );
}
