import type {
  AttachmentDTO,
  AttachmentListResponse,
  AttachmentType,
  CoaReviewResultDTO,
  CoaStatus,
  LotStatus,
  QualityQueueResponse,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export type AttachmentContext = "lots" | "receipts" | "products" | "projects";

export async function listAttachments(
  context: AttachmentContext,
  id: string,
  includeArchived = false,
): Promise<AttachmentListResponse> {
  const query = includeArchived ? "?includeArchived=true" : "";
  const response = await apiFetch(`${API_URL}/${context}/${id}/attachments${query}`);
  return (await parseJsonOrThrow(response)) as AttachmentListResponse;
}

/**
 * Upload multipart. O arquivo nunca vai para um diretório público: o
 * backend guarda sob chave aleatória e o download passa pela API.
 */
export async function uploadAttachment(
  context: AttachmentContext,
  id: string,
  documentType: AttachmentType,
  file: File,
): Promise<AttachmentDTO> {
  const form = new FormData();
  form.append("documentType", documentType);
  form.append("file", file);

  const response = await apiFetch(`${API_URL}/${context}/${id}/attachments`, {
    method: "POST",
    body: form,
  });
  return (await parseJsonOrThrow(response)) as AttachmentDTO;
}

export async function archiveAttachment(id: string): Promise<AttachmentDTO> {
  const response = await apiFetch(`${API_URL}/attachments/${id}/archive`, { method: "POST" });
  return (await parseJsonOrThrow(response)) as AttachmentDTO;
}

export function attachmentDownloadUrl(id: string): string {
  return `${API_URL}/attachments/${id}/download`;
}

export interface QualityQueueParams {
  search?: string;
  itemId?: string;
  supplierId?: string;
  ownerCustomerId?: string;
  coaStatus?: CoaStatus;
  lotStatus?: LotStatus;
  onlyPending?: boolean;
  onlyWithBalance?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listQualityQueue(
  params: QualityQueueParams = {},
): Promise<QualityQueueResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.itemId) query.set("itemId", params.itemId);
  if (params.coaStatus) query.set("coaStatus", params.coaStatus);
  if (params.lotStatus) query.set("lotStatus", params.lotStatus);
  if (params.onlyPending) query.set("onlyPending", "true");
  if (params.onlyWithBalance) query.set("onlyWithBalance", "true");
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/quality/coa-queue?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as QualityQueueResponse;
}

export async function approveCoa(lotId: string, note?: string): Promise<CoaReviewResultDTO> {
  const response = await apiFetch(`${API_URL}/lots/${lotId}/coa/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(note ? { note } : {}),
  });
  return (await parseJsonOrThrow(response)) as CoaReviewResultDTO;
}

export async function rejectCoa(lotId: string, reason: string): Promise<CoaReviewResultDTO> {
  const response = await apiFetch(`${API_URL}/lots/${lotId}/coa/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  return (await parseJsonOrThrow(response)) as CoaReviewResultDTO;
}
