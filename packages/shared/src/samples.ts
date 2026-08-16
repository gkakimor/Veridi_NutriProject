/**
 * Amostras / pilotos / testes Tn.
 *
 * Uma amostra NÃO é lote nem Ordem de Produção: o projeto pode entrar em
 * amostra antes de existir Produto, item de produto acabado ou formulação
 * operacional. Ela tem identidade própria (`AM-000001`), QR próprio
 * (`SAMPLE:AM-000001`) e nunca entra no estoque comercial de produto
 * acabado.
 */

import type { InventoryOwnerType } from "./ownership.js";

export const SAMPLE_CODE_PREFIX = "AM";

/** Prefixo do QR da amostra — deliberadamente diferente de `LOT:`. */
export const SAMPLE_QR_PREFIX = "SAMPLE:";

/** Aceita `AM-000001` ou o payload completo `SAMPLE:AM-000001`. */
export function normalizeSampleLookupCode(raw: string): string {
  const trimmed = raw.trim();
  const withoutPrefix = trimmed.toUpperCase().startsWith(SAMPLE_QR_PREFIX)
    ? trimmed.slice(SAMPLE_QR_PREFIX.length)
    : trimmed;
  return withoutPrefix.trim().toUpperCase();
}

export type ProjectSampleStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "PRODUCED"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

export const PROJECT_SAMPLE_STATUSES: readonly ProjectSampleStatus[] = [
  "DRAFT",
  "IN_PROGRESS",
  "PRODUCED",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
];

export const PROJECT_SAMPLE_STATUS_LABELS: Record<ProjectSampleStatus, string> = {
  DRAFT: "Rascunho",
  IN_PROGRESS: "Em preparação",
  PRODUCED: "Produzida",
  APPROVED: "Aprovada",
  REJECTED: "Reprovada",
  CANCELLED: "Cancelada",
};

export type ProjectSampleSource = "MANUAL" | "LEGACY_IMPORT";

export interface SampleConsumptionDTO {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  lotId: string | null;
  lotCode: string | null;
  supplierLot: string | null;
  ownerType: InventoryOwnerType;
  ownerCustomerName: string | null;
  quantity: string;
  uomCode: string;
  executedAt: string;
  executedByName: string;
  notes: string | null;
}

export interface ProjectSampleDTO {
  id: string;
  code: string;
  externalCode: string | null;
  projectId: string;
  projectCode: string;
  projectName: string;
  customerId: string;
  customerName: string;
  testSequence: number;
  /** Rótulo de apresentação: "T3". */
  testLabel: string;
  status: ProjectSampleStatus;
  source: ProjectSampleSource;
  description: string | null;
  productionNotes: string | null;
  decisionNotes: string | null;
  /** Quantidade produzida da amostra — nunca estoque comercial. */
  outputQuantity: string | null;
  outputUomCode: string | null;
  /** Snapshot congelado na produção — a etiqueta histórica não muda depois. */
  customerNameSnapshot: string | null;
  projectCodeSnapshot: string | null;
  projectNameSnapshot: string | null;
  /** `SAMPLE:AM-000001` — nunca `LOT:`, porque amostra não é lote. */
  qrPayload: string;
  consumptions: SampleConsumptionDTO[];
  createdAt: string;
  createdByName: string | null;
  startedAt: string | null;
  startedByName: string | null;
  producedAt: string | null;
  producedByName: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  rejectedAt: string | null;
  rejectedByName: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
}

export interface ProjectSampleListResponse {
  samples: ProjectSampleDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateProjectSampleInput {
  description?: string | null;
  productionNotes?: string | null;
  outputUomCode?: string | null;
}

export interface RegisterSampleConsumptionInput {
  itemId: string;
  /** Aceita `LT-…` ou o payload do QR do lote. */
  lotCode?: string;
  quantity: string;
  notes?: string;
}

export interface ProduceSampleInput {
  outputQuantity: string;
  outputUomCode: string;
  productionNotes?: string | null;
  /** Confirmação explícita quando nenhum consumo foi registrado. */
  confirmWithoutConsumption?: boolean;
}

export interface SampleDecisionInput {
  decisionNotes?: string;
}
