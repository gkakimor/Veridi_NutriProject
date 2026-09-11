import type { ProjectStatus } from "./projects.js";

/**
 * Situação comercial do Cliente — CUSTOMER-COMMERCIAL-STATUS-01, `PRODUCT_RULES.md` §86.
 *
 * LEITURA derivada da história comercial e das datas, nunca campo mantido à
 * mão — e nada a ver com `Customer.active`, que diz se o cadastro pode entrar
 * em documento novo. Os dois coexistem e nenhum substitui o outro.
 *
 * Não é CRM: sem funil, sem etapa, sem atividade agendada. Quem deriva é a
 * API (`customers/commercial-status.ts`); a tela só apresenta.
 */

export const CUSTOMER_COMMERCIAL_STATUSES = ["ACTIVE", "PROSPECT", "INACTIVE"] as const;

export type CustomerCommercialStatus = (typeof CUSTOMER_COMMERCIAL_STATUSES)[number];

export const CUSTOMER_COMMERCIAL_STATUS_LABELS: Record<CustomerCommercialStatus, string> = {
  ACTIVE: "Cliente ativo",
  PROSPECT: "Prospect",
  INACTIVE: "Inativo",
};

/** Dias civis sem oportunidade aberta antes de Inativo — decisão do PO. Não é configuração. */
export const CUSTOMER_INACTIVITY_WINDOW_DAYS = 15;

/**
 * Projeto que mantém o Cliente em Prospect enquanto ele não converteu.
 * `STAND_BY` não conta — a janela corre desde a entrada nele —, e `APPROVED`
 * já é conversão.
 */
export const COMMERCIALLY_OPEN_PROJECT_STATUSES = [
  "WAITING",
  "SAMPLE",
] as const satisfies readonly ProjectStatus[];

export interface CustomerCommercialStatusDTO {
  status: CustomerCommercialStatus;
  /** Por quê, em português de tela — um estado derivado precisa dizer de onde veio. */
  reason: string;
  /**
   * Dia civil da Veridi (`YYYY-MM-DD`) da conversão MAIS ANTIGA: primeiro
   * Projeto aprovado ou primeiro Pedido confirmado. Só em `ACTIVE`; `null`
   * quando a conversão existe mas não tem data registrada (legado).
   */
  customerSince: string | null;
}

/** Projetos do Cliente por situação — o resumo da Consulta. */
export interface CustomerProjectSummaryDTO {
  /** Aguardando ou em amostra: comercialmente abertos. */
  open: number;
  standBy: number;
  approved: number;
  cancelled: number;
}
