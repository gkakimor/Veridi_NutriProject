/**
 * Documentos controlados (GMP) — apenas revisão/cabeçalho para impressão e
 * histórico. Não é GED, não é workflow documental, não é assinatura
 * digital, e o sistema nunca declara conformidade GMP/ANVISA.
 */

export type ControlledDocumentType = "PRODUCTION_ORDER" | "RECIPE_SHEET";

export const CONTROLLED_DOCUMENT_TYPES: readonly ControlledDocumentType[] = [
  "PRODUCTION_ORDER",
  "RECIPE_SHEET",
];

export const CONTROLLED_DOCUMENT_TYPE_LABELS: Record<ControlledDocumentType, string> = {
  PRODUCTION_ORDER: "Ordem de Produção",
  RECIPE_SHEET: "Folha de Receita",
};

/** Códigos reais da Veridi — nunca inventar outro. */
export const CONTROLLED_DOCUMENT_CODES: Record<ControlledDocumentType, string> = {
  PRODUCTION_ORDER: "R.PRO.002",
  RECIPE_SHEET: "R.COQ.003",
};

export interface ControlledDocumentRevisionDTO {
  id: string;
  type: ControlledDocumentType;
  documentCode: string;
  title: string;
  revision: string;
  revisionDate: string | null;
  preparedByUserId: string | null;
  preparedByName: string | null;
  approvedByUserId: string | null;
  approvedByName: string | null;
  active: boolean;
  createdAt: string;
}

export interface ControlledDocumentRevisionListResponse {
  revisions: ControlledDocumentRevisionDTO[];
}

export interface CreateControlledDocumentRevisionInput {
  type: ControlledDocumentType;
  title?: string;
  revision: string;
  revisionDate?: string;
  preparedByUserId?: string | null;
  approvedByUserId?: string | null;
  /** Ativar já na criação — a revisão ACTIVE anterior do mesmo tipo é inativada. */
  activate?: boolean;
}
