/**
 * Exclusão física de cadastro mestre — MASTER-DATA-HARD-DELETE-01, D1–D6 do
 * MASTER-DATA-DELETE-ARCHIVE-DISCOVERY-01.
 *
 * Só existe para cadastro criado por engano, nunca utilizado e sem nenhuma
 * referência real. Qualquer uso, referência ou histórico bloqueia, e a saída
 * normal continua sendo Inativar ou Arquivar. A API é a autoridade: a tela
 * pergunta à prévia (`deletion-check`) e mostra o que ela responde, sem
 * conhecer tabela nem chave estrangeira.
 */

import type { CadastroMestre } from "./master-data-names.js";
import type { UserRole } from "./users.js";

/**
 * Cadastros com exclusão física nesta fatia. Item, Produto e Recurso
 * industrial entram em MASTER-DATA-HARD-DELETE-02, sobre a mesma
 * infraestrutura.
 */
export type MasterDataEntityType = Extract<
  CadastroMestre,
  | "SUPPLIER"
  | "CUSTOMER"
  | "FORMULATION_TEMPLATE"
  | "INDUSTRIAL_COST_TEMPLATE"
  | "PRICING_POLICY_TEMPLATE"
  | "PRODUCTION_PROFILE"
>;

export const MASTER_DATA_ENTITY_TYPES: readonly MasterDataEntityType[] = [
  "SUPPLIER",
  "CUSTOMER",
  "FORMULATION_TEMPLATE",
  "INDUSTRIAL_COST_TEMPLATE",
  "PRICING_POLICY_TEMPLATE",
  "PRODUCTION_PROFILE",
];

/**
 * Onde cada cadastro mora na API. A prévia é `GET <caminho>/:id/deletion-check`
 * e a exclusão é `DELETE <caminho>/:id` — a tela e a rota leem a MESMA tabela.
 */
export const MASTER_DATA_DELETION_PATHS: Record<MasterDataEntityType, string> = {
  SUPPLIER: "/suppliers",
  CUSTOMER: "/customers",
  FORMULATION_TEMPLATE: "/formulation-templates",
  INDUSTRIAL_COST_TEMPLATE: "/cost-templates",
  PRICING_POLICY_TEMPLATE: "/pricing-policies",
  PRODUCTION_PROFILE: "/production-profiles",
};

/**
 * D1: só o Administrador exclui fisicamente — não herda a permissão de criar
 * nem de editar o cadastro. A prévia segue a mesma lista: ninguém mais tem o
 * que fazer com ela.
 */
export const MASTER_DATA_HARD_DELETE_ROLES: readonly UserRole[] = ["ADMIN"];

/** Motivo obrigatório da exclusão, com o mesmo teto do motivo de situação do Cliente. */
export const MASTER_DATA_DELETION_REASON_MAX_LENGTH = 500;

/** A recusa por uso: 409 com a lista de referências que impedem. */
export const MASTER_DATA_IN_USE_ERROR = "master_data_in_use";

/**
 * A exclusão foi desfeita porque a transação mexeu em algo fora do agregado
 * (CASCADE ou SET NULL que o catálogo não previa). Nada foi gravado.
 */
export const MASTER_DATA_DELETE_ABORTED_ERROR = "master_data_delete_aborted";

/** A saída normal quando a exclusão é recusada. */
export type MasterDataDeletionAlternative = "INACTIVATE" | "ARCHIVE";

export const MASTER_DATA_DELETION_ALTERNATIVE_LABELS: Record<MasterDataDeletionAlternative, string> = {
  INACTIVATE: "Inativar",
  ARCHIVE: "Arquivar",
};

/** Uma razão que impede a exclusão, em linguagem de negócio. */
export interface MasterDataDeletionReferenceDTO {
  /** Onde está o uso ("Ordens de compra", "Versão V1 do modelo"). */
  source: string;
  /** Quantas linhas — ou 1 quando a razão é um fato, não uma contagem. */
  count: number;
  /** Por que isso impede a exclusão. */
  reason: string;
}

/** O que sai junto com o cadastro: os filhos técnicos que nasceram com ele. */
export interface MasterDataDeletionRemovedDTO {
  source: string;
  count: number;
}

/** Resposta de `GET <caminho>/:id/deletion-check`. Não grava nada. */
export interface MasterDataDeletionCheckDTO {
  entityType: MasterDataEntityType;
  entityId: string;
  entityCode: string;
  entityName: string;
  canDelete: boolean;
  /** Vazio quando pode excluir. */
  references: MasterDataDeletionReferenceDTO[];
  /** Só quando pode excluir: os filhos técnicos que saem junto (a V1 em rascunho vazia). */
  removedTogether: MasterDataDeletionRemovedDTO[];
  alternative: MasterDataDeletionAlternative;
  /** Falso quando o cadastro já está inativo ou arquivado. */
  alternativeAvailable: boolean;
}

export interface DeleteMasterDataInput {
  reason: string;
}

/** Resposta de `DELETE <caminho>/:id` — o registro do rastro que ficou. */
export interface MasterDataDeletionResultDTO {
  historyId: string;
  entityType: MasterDataEntityType;
  entityId: string;
  entityCode: string;
  entityName: string;
  deletedAt: string;
}
