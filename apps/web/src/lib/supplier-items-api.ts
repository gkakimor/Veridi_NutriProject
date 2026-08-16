import type {
  ChangeSupplierItemQualificationInput,
  CreateSupplierItemInput,
  CreateSupplierItemOfferInput,
  SupplierItemDetailDTO,
  SupplierItemListResponse,
  SupplierItemQualificationStatus,
  UpdateSupplierItemInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListSupplierItemsParams {
  search?: string;
  itemId?: string;
  supplierId?: string;
  qualificationStatus?: SupplierItemQualificationStatus;
  preferred?: boolean;
  active?: boolean;
  itemFamily?: string;
  itemType?: string;
  page?: number;
  pageSize?: number;
}

export async function listSupplierItems(
  params: ListSupplierItemsParams = {},
): Promise<SupplierItemListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.itemId) query.set("itemId", params.itemId);
  if (params.supplierId) query.set("supplierId", params.supplierId);
  if (params.qualificationStatus) query.set("qualificationStatus", params.qualificationStatus);
  if (params.preferred !== undefined) query.set("preferred", String(params.preferred));
  if (params.active !== undefined) query.set("active", String(params.active));
  if (params.itemFamily) query.set("itemFamily", params.itemFamily);
  if (params.itemType) query.set("itemType", params.itemType);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/supplier-items?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as SupplierItemListResponse;
}

export async function getSupplierItem(id: string): Promise<SupplierItemDetailDTO> {
  const response = await apiFetch(`${API_URL}/supplier-items/${id}`);
  return (await parseJsonOrThrow(response)) as SupplierItemDetailDTO;
}

async function postJson(path: string, body?: unknown): Promise<SupplierItemDetailDTO> {
  const response = await apiFetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return (await parseJsonOrThrow(response)) as SupplierItemDetailDTO;
}

export async function createSupplierItem(
  input: CreateSupplierItemInput,
): Promise<SupplierItemDetailDTO> {
  return postJson("/supplier-items", input);
}

export async function updateSupplierItem(
  id: string,
  input: UpdateSupplierItemInput,
): Promise<SupplierItemDetailDTO> {
  const response = await apiFetch(`${API_URL}/supplier-items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as SupplierItemDetailDTO;
}

export async function changeSupplierItemQualification(
  id: string,
  input: ChangeSupplierItemQualificationInput,
): Promise<SupplierItemDetailDTO> {
  return postJson(`/supplier-items/${id}/qualification`, input);
}

export async function setSupplierItemPreferred(
  id: string,
  preferred: boolean,
): Promise<SupplierItemDetailDTO> {
  return postJson(`/supplier-items/${id}/preferred`, { preferred });
}

export async function createSupplierItemOffer(
  id: string,
  input: CreateSupplierItemOfferInput,
): Promise<SupplierItemDetailDTO> {
  return postJson(`/supplier-items/${id}/offers`, input);
}
