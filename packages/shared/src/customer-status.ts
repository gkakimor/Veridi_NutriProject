/**
 * Situação cadastral do Cliente — CUSTOMER-STATUS-LIFECYCLE-01, `PRODUCT_RULES.md` §95.
 *
 * Responde "posso abrir operação comercial NOVA com este cliente?". Não é a
 * situação comercial (§86, `customer-commercial-status.ts`), que é leitura
 * derivada da história: um Cliente ativo comercialmente pode estar bloqueado,
 * e um Prospect pode estar inativo. As duas convivem em filtros e colunas
 * separados, e nenhuma decide a outra.
 *
 * Persistência: `Customer.active` (arquivado ou não) + `Customer.blocked`
 * (bloqueio vigente). A situação é derivada dos dois por `situacaoCadastral`,
 * e toda mudança grava um evento no histórico append-only — situação
 * anterior, nova, motivo, usuário e data/hora. O motivo nunca vive no
 * cadastro: o próximo evento o sobrescreveria.
 */

export const CUSTOMER_STATUSES = ["ACTIVE", "BLOCKED", "INACTIVE"] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  ACTIVE: "Ativo",
  BLOCKED: "Bloqueado",
  INACTIVE: "Inativo",
};

/** Opções do filtro da lista de Clientes, no plural. */
export const CUSTOMER_STATUS_FILTER_LABELS: Record<CustomerStatus, string> = {
  ACTIVE: "Ativos",
  BLOCKED: "Bloqueados",
  INACTIVE: "Inativos",
};

/**
 * Padrão da lista de Clientes — pedido da Veridi: bloqueados e inativos ficam
 * arquivados fora da abertura, a um filtro de distância. A API sem o filtro
 * devolve todos; quem abre em "Ativos" é a tela.
 */
export const DEFAULT_CUSTOMER_STATUS_FILTER: CustomerStatus = "ACTIVE";

/** Teto do motivo — frase de registro, não documento. */
export const CUSTOMER_STATUS_REASON_MAX_LENGTH = 500;

/**
 * A situação exibida, dos dois fatos persistidos. Inativo prevalece: o
 * bloqueio de um cliente arquivado fica latente e volta com a reativação.
 */
export function situacaoCadastral(cliente: { active: boolean; blocked: boolean }): CustomerStatus {
  if (!cliente.active) return "INACTIVE";
  return cliente.blocked ? "BLOCKED" : "ACTIVE";
}

/**
 * As quatro mudanças. Não existe "trocar para X": cada ação parte de uma
 * situação permitida e tem efeito próprio, e a API recusa (409) a que não
 * parte da situação atual.
 */
export const CUSTOMER_STATUS_ACTIONS = ["BLOCK", "UNBLOCK", "DEACTIVATE", "ACTIVATE"] as const;

export type CustomerStatusAction = (typeof CUSTOMER_STATUS_ACTIONS)[number];

/** O que cada situação permite — a lista de ações da tela e a regra da API. */
export const CUSTOMER_STATUS_ACTIONS_BY_STATUS: Record<
  CustomerStatus,
  readonly CustomerStatusAction[]
> = {
  ACTIVE: ["BLOCK", "DEACTIVATE"],
  BLOCKED: ["UNBLOCK", "DEACTIVATE"],
  INACTIVE: ["ACTIVATE"],
};

export const CUSTOMER_STATUS_ACTION_LABELS: Record<CustomerStatusAction, string> = {
  BLOCK: "Bloquear",
  UNBLOCK: "Desbloquear",
  DEACTIVATE: "Inativar",
  ACTIVATE: "Reativar",
};

/** Recusa de operação comercial nova — a mesma frase em todo fluxo. */
export const CUSTOMER_BLOCKED_FOR_SALES_MESSAGE = "Cliente bloqueado para novas vendas.";
export const CUSTOMER_INACTIVE_FOR_SALES_MESSAGE = "Cliente inativo.";

/**
 * O bloqueio vigente, lido do evento que bloqueou — nunca de um campo do
 * cadastro. Reativar um cliente arquivado bloqueado não é bloquear de novo: o
 * motivo continua sendo o do Bloquear.
 */
export interface CustomerBlockDTO {
  reason: string;
  blockedAt: string;
  /** Nome congelado no evento; `null` só em registro sem autor conhecido. */
  blockedByName: string | null;
}

/** Um evento do histórico da situação cadastral. Nunca muda depois de gravado. */
export interface CustomerStatusEventDTO {
  id: string;
  fromStatus: CustomerStatus;
  toStatus: CustomerStatus;
  reason: string;
  changedAt: string;
  changedByName: string | null;
}

export interface CustomerStatusHistoryResponse {
  events: CustomerStatusEventDTO[];
}

/** Corpo das quatro ações: o motivo é obrigatório em todas. */
export interface CustomerStatusChangeInput {
  reason: string;
}
