/** Contratos do módulo de Formulações/Versionamento, consumidos por `apps/api` e `apps/web`. */

import type { ItemType } from "./items.js";

export type FormulationVersionStatus = "DRAFT" | "ACTIVE" | "INACTIVE";

export const FORMULATION_VERSION_STATUSES: readonly FormulationVersionStatus[] = [
  "DRAFT",
  "ACTIVE",
  "INACTIVE",
];

export const FORMULATION_VERSION_STATUS_LABELS: Record<FormulationVersionStatus, string> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativa",
  INACTIVE: "Inativa",
};

export interface FormulationComponentDTO {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  itemActive: boolean;
  /** Decimal como string — nunca float JS. */
  quantity: string;
  unitCode: string;
  /** Só exibição — equivalente na unidade de estoque do Item; nunca fonte de verdade. */
  stockEquivalentQuantity: string;
  stockUnitCode: string;
  notes: string | null;
  position: number;
}

export interface FormulationVersionDTO {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  versionNumber: number;
  /** Rótulo de apresentação — "V1", "V2"... nunca persistido separadamente. */
  versionLabel: string;
  status: FormulationVersionStatus;
  basisQuantity: string;
  outputItemId: string;
  outputItemCode: string;
  outputItemName: string;
  outputUnitCode: string;
  notes: string | null;
  components: FormulationComponentDTO[];
  createdAt: string;
  createdBy: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  inactivatedAt: string | null;
  inactivatedBy: string | null;
}

export interface FormulationSummaryDTO {
  productId: string;
  productCode: string;
  productName: string;
  customerName: string | null;
  finishedProductItemId: string | null;
  finishedProductItemCode: string | null;
  activeVersionId: string | null;
  activeVersionLabel: string | null;
  /** `true` se existe ao menos uma versão (DRAFT/ACTIVE/INACTIVE) para o produto. */
  hasFormulation: boolean;
  updatedAt: string | null;
}

export interface FormulationListResponse {
  formulations: FormulationSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface FormulationVersionListResponse {
  versions: FormulationVersionDTO[];
}

export interface FormulationComponentInput {
  itemId: string;
  quantity: string;
  unitCode: string;
  notes?: string;
}

export interface CreateFormulationVersionInput {
  notes?: string;
}

export interface UpdateFormulationVersionInput {
  basisQuantity?: string;
  notes?: string;
  components?: FormulationComponentInput[];
}
