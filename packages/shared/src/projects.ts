/**
 * Projetos private label e orçamentos versionados.
 *
 * `Project` é o funil comercial ANTES do produto existir; `Product` é o
 * produto aprovado e operacional. A aprovação do projeto é exatamente o
 * momento em que um vira o outro — nunca uma conversão automática no
 * cadastro inicial.
 */

import type { DosageForm, PresentationType, TargetAgeGroup } from "./products.js";

export const PROJECT_CODE_PREFIX = "PROJ";
export const QUOTE_CODE_PREFIX = "ORC";

export type ProjectStatus = "WAITING" | "SAMPLE" | "APPROVED" | "CANCELLED" | "STAND_BY";

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  "WAITING",
  "SAMPLE",
  "APPROVED",
  "CANCELLED",
  "STAND_BY",
];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  WAITING: "Aguardando",
  SAMPLE: "Amostra",
  APPROVED: "Aprovado",
  CANCELLED: "Cancelado",
  STAND_BY: "Stand-by",
};

export type ProjectCancelReason =
  | "PRICE"
  | "COMPETITOR"
  | "PROJECT_CHANGED"
  | "NOT_MET"
  | "OTHER";

export const PROJECT_CANCEL_REASONS: readonly ProjectCancelReason[] = [
  "PRICE",
  "COMPETITOR",
  "PROJECT_CHANGED",
  "NOT_MET",
  "OTHER",
];

export const PROJECT_CANCEL_REASON_LABELS: Record<ProjectCancelReason, string> = {
  PRICE: "Preço",
  COMPETITOR: "Concorrente",
  PROJECT_CHANGED: "Mudou o projeto",
  NOT_MET: "Não atendeu",
  OTHER: "Outro",
};

/** `LEGACY_IMPORT` explica estados históricos incompletos sem afrouxar o fluxo novo. */
export type ProjectSource = "MANUAL" | "LEGACY_IMPORT";

export const PROJECT_SOURCE_LABELS: Record<ProjectSource, string> = {
  MANUAL: "Cadastrado no sistema",
  LEGACY_IMPORT: "Importado da planilha",
};

export type QuoteStatus = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "SUPERSEDED" | "ARCHIVED";

export const QUOTE_STATUSES: readonly QuoteStatus[] = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "SUPERSEDED",
  "ARCHIVED",
];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: "Rascunho",
  SENT: "Enviado",
  ACCEPTED: "Aceito",
  REJECTED: "Recusado",
  SUPERSEDED: "Substituído",
  ARCHIVED: "Histórico",
};

export interface ProjectStatusHistoryDTO {
  id: string;
  fromStatus: ProjectStatus | null;
  toStatus: ProjectStatus;
  reason: string | null;
  changedAt: string;
  changedByName: string | null;
}

export interface QuoteVersionDTO {
  id: string;
  code: string;
  projectId: string;
  versionNumber: number;
  /** Rótulo de apresentação: "ORC-000123 · V2". */
  versionLabel: string;
  externalCode: string | null;
  status: QuoteStatus;
  source: ProjectSource;
  quoteDate: string;
  validUntil: string | null;
  /** Decimal como string — nunca float. */
  quotedQuantity: string | null;
  uomCode: string | null;
  /** `null` = ainda não precificado; `"0"` é preço zero explícito. */
  unitPrice: string | null;
  currencyCode: string;
  /** `quotedQuantity × unitPrice`, derivado — nunca persistido. */
  total: string | null;
  commercialNotes: string | null;
  paymentTerms: string | null;
  leadTimeDays: number | null;
  sentAt: string | null;
  sentByName: string | null;
  acceptedAt: string | null;
  acceptedByName: string | null;
  rejectedAt: string | null;
  rejectedByName: string | null;
  rejectionReason: string | null;
  /** Snapshot congelado no envio — a impressão não depende do cadastro atual. */
  customerCode: string | null;
  customerName: string | null;
  customerTradeName: string | null;
  customerCnpj: string | null;
  customerZipCode: string | null;
  customerStreet: string | null;
  customerNumber: string | null;
  customerComplement: string | null;
  customerDistrict: string | null;
  customerCity: string | null;
  customerState: string | null;
  projectCode: string | null;
  projectName: string | null;
  projectConcept: string | null;
  projectChannel: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface ProjectDTO {
  id: string;
  code: string;
  externalCode: string | null;
  customerId: string;
  customerCode: string;
  customerName: string;
  name: string;
  concept: string | null;
  channel: string | null;
  status: ProjectStatus;
  source: ProjectSource;
  responsibleUserId: string | null;
  responsibleUserName: string | null;
  entryDate: string;
  notes: string | null;
  cancelReason: ProjectCancelReason | null;
  cancelReasonDetails: string | null;
  cancelledAt: string | null;
  approvedAt: string | null;
  /** Perfil técnico pretendido — brief, ainda não é Product. */
  dosageForm: DosageForm | null;
  presentationType: PresentationType | null;
  doseAmount: string | null;
  doseUomCode: string | null;
  dosesPerPackage: number | null;
  targetAgeGroup: TargetAgeGroup | null;
  minimumBatchQuantity: string | null;
  shelfLifeMonths: number | null;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  /** Última versão de orçamento (qualquer status). */
  latestQuoteLabel: string | null;
  latestQuoteStatus: QuoteStatus | null;
  /** Versão aceita vigente, quando existir. */
  acceptedQuoteLabel: string | null;
  quoteVersions: QuoteVersionDTO[];
  statusHistory: ProjectStatusHistoryDTO[];
  createdAt: string;
  createdByName: string | null;
  updatedAt: string;
}

export interface ProjectListResponse {
  projects: ProjectDTO[];
  page: number;
  pageSize: number;
  total: number;
}

/** Vocabulário já usado na base — sugestão, nunca lista fechada. */
export interface ProjectVocabularyResponse {
  concepts: string[];
  channels: string[];
}

export interface CreateProjectInput {
  customerId: string;
  name: string;
  concept?: string | null;
  channel?: string | null;
  externalCode?: string | null;
  responsibleUserId?: string | null;
  entryDate?: string;
  notes?: string | null;
  dosageForm?: DosageForm | null;
  presentationType?: PresentationType | null;
  doseAmount?: string | null;
  doseUomCode?: string | null;
  dosesPerPackage?: number | null;
  targetAgeGroup?: TargetAgeGroup | null;
  minimumBatchQuantity?: string | null;
  shelfLifeMonths?: number | null;
}

export type UpdateProjectInput = Partial<CreateProjectInput>;

export interface ChangeProjectStatusInput {
  status: ProjectStatus;
  reason?: string;
}

export interface CancelProjectInput {
  cancelReason: ProjectCancelReason;
  cancelReasonDetails?: string;
}

/** UOM do produto acabado quando o projeto ainda não tem Product. */
export interface ApproveProjectInput {
  finishedUnitCode?: string;
}

export interface UpdateQuoteVersionInput {
  quoteDate?: string;
  validUntil?: string | null;
  quotedQuantity?: string | null;
  uomCode?: string | null;
  unitPrice?: string | null;
  currencyCode?: string;
  commercialNotes?: string | null;
  paymentTerms?: string | null;
  leadTimeDays?: number | null;
}

export interface RejectQuoteInput {
  reason?: string;
}
