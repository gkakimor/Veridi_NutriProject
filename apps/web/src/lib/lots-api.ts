import type {
  BlockLotInput,
  InventoryOwnerType,
  LotDTO,
  LotListResponse,
  LotStatus,
  LotTraceabilityDTO,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListLotsParams {
  search?: string;
  itemId?: string;
  supplierId?: string;
  status?: LotStatus;
  ownerType?: InventoryOwnerType;
  ownerCustomerId?: string;
  page?: number;
  pageSize?: number;
}

export async function listLots(params: ListLotsParams = {}): Promise<LotListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.itemId) query.set("itemId", params.itemId);
  if (params.supplierId) query.set("supplierId", params.supplierId);
  if (params.status) query.set("status", params.status);
  if (params.ownerType) query.set("ownerType", params.ownerType);
  if (params.ownerCustomerId) query.set("ownerCustomerId", params.ownerCustomerId);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/lots?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as LotListResponse;
}

export async function getLot(id: string): Promise<LotDTO> {
  const response = await apiFetch(`${API_URL}/lots/${id}`);
  return (await parseJsonOrThrow(response)) as LotDTO;
}

/** Resolve um código escaneado/digitado (puro ou `LOT:<codigo>`). `null` se não encontrado. */
export async function lookupLot(code: string): Promise<LotDTO | null> {
  const response = await apiFetch(`${API_URL}/lots/lookup?code=${encodeURIComponent(code)}`);
  if (response.status === 404) return null;
  return (await parseJsonOrThrow(response)) as LotDTO;
}

export async function releaseLot(id: string): Promise<LotDTO> {
  const response = await apiFetch(`${API_URL}/lots/${id}/release`, { method: "POST" });
  return (await parseJsonOrThrow(response)) as LotDTO;
}

/** Desbloquear devolve o lote à fila da Qualidade, nunca ao estoque. */
export async function unblockLot(id: string, input: BlockLotInput): Promise<LotDTO> {
  const response = await apiFetch(`${API_URL}/lots/${id}/unblock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as LotDTO;
}

export async function blockLot(id: string, input: BlockLotInput): Promise<LotDTO> {
  const response = await apiFetch(`${API_URL}/lots/${id}/block`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as LotDTO;
}

export async function getLotTraceability(id: string): Promise<LotTraceabilityDTO> {
  const response = await apiFetch(`${API_URL}/lots/${id}/traceability`);
  return (await parseJsonOrThrow(response)) as LotTraceabilityDTO;
}
