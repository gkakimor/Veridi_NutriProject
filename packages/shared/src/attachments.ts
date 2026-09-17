/**
 * Documentos anexados — laudo/CoA do lote, NF do recebimento, arte e ficha
 * técnica do produto.
 *
 * Não é GED: não há versionamento formal, aprovação de arte nem workflow
 * documental. O arquivo nunca é público — o download passa pela API
 * autenticada — e nunca é excluído pela operação: arquiva-se.
 */

import type { UserRole } from "./users.js";

export type AttachmentType =
  | "COA"
  | "INVOICE"
  | "LABEL_ART"
  | "TECHNICAL_SHEET"
  | "BRIEFING"
  | "SAMPLE_RESULT"
  | "OTHER";

export const ATTACHMENT_TYPE_LABELS: Record<AttachmentType, string> = {
  COA: "Laudo / CoA",
  INVOICE: "Nota fiscal",
  LABEL_ART: "Arte de rótulo",
  TECHNICAL_SHEET: "Ficha técnica",
  BRIEFING: "Briefing",
  SAMPLE_RESULT: "Resultado de amostra",
  OTHER: "Outro",
};

/**
 * Quem ANEXA documento ao Produto (arte de rótulo, ficha técnica). Seção com
 * permissão própria dentro do cadastro do Produto: a Qualidade anexa mesmo sem
 * editar o cadastro, e a Produção consulta (MASTER-DATA-EDIT-PERMISSIONS-01).
 */
export const PRODUCT_DOCUMENT_UPLOAD_ROLES: readonly UserRole[] = ["COMMERCIAL", "QUALITY", "ADMIN"];

/**
 * Quem ARQUIVA documento anexado, em qualquer contexto: documento é evidência,
 * e tirá-lo de circulação é decisão da Qualidade.
 */
export const ATTACHMENT_ARCHIVE_ROLES: readonly UserRole[] = ["QUALITY", "ADMIN"];

/** Tipos aceitos por contexto — CoA só existe em lote, arte só em produto. */
export const LOT_ATTACHMENT_TYPES: readonly AttachmentType[] = ["COA", "OTHER"];
export const RECEIPT_ATTACHMENT_TYPES: readonly AttachmentType[] = ["INVOICE", "OTHER"];
export const PRODUCT_ATTACHMENT_TYPES: readonly AttachmentType[] = [
  "LABEL_ART",
  "TECHNICAL_SHEET",
  "OTHER",
];
/** Amostra aceita resultado de teste e material técnico — nunca laudo nem nota. */
export const SAMPLE_ATTACHMENT_TYPES: readonly AttachmentType[] = [
  "SAMPLE_RESULT",
  "LABEL_ART",
  "TECHNICAL_SHEET",
  "OTHER",
];

/** Projeto aceita briefing e material técnico — nunca laudo nem nota fiscal. */
export const PROJECT_ATTACHMENT_TYPES: readonly AttachmentType[] = [
  "BRIEFING",
  "LABEL_ART",
  "TECHNICAL_SHEET",
  "OTHER",
];

/** Formatos aceitos nesta fase: laudo, NF escaneada, arte e ficha técnica. */
export const ALLOWED_ATTACHMENT_MIME_TYPES: readonly string[] = [
  "application/pdf",
  "image/png",
  "image/jpeg",
];

export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;

export interface AttachmentDTO {
  id: string;
  documentType: AttachmentType;
  lotId: string | null;
  receiptId: string | null;
  productId: string | null;
  projectId: string | null;
  projectSampleId: string | null;
  /** Nome sanitizado só para exibição/download — nunca é caminho de arquivo. */
  originalFileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByUserId: string;
  /** Nome no momento do envio — renomear/inativar o usuário não reescreve o histórico. */
  uploadedByName: string;
  archivedAt: string | null;
  archivedByName: string | null;
  active: boolean;
}

export interface AttachmentListResponse {
  attachments: AttachmentDTO[];
}
