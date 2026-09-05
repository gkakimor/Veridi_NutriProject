import type {
  CreateItemCostReferenceInput,
  CreateItemInput,
  ItemCostReferencesResponse,
  ItemDTO,
  ItemListResponse,
  ItemType,
  UpdateItemInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListItemsParams {
  /** Conjunto explícito de ids — link contextual e exportação da seleção. */
  ids?: string[];
  search?: string;
  type?: ItemType;
  active?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listItems(
  params: ListItemsParams = {},
): Promise<ItemListResponse> {
  const query = new URLSearchParams();
  if (params.ids && params.ids.length > 0) query.set("ids", params.ids.join(","));
  if (params.search) query.set("search", params.search);
  if (params.type) query.set("type", params.type);
  if (params.active !== undefined) query.set("active", String(params.active));
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/items?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as ItemListResponse;
}

export async function getItem(id: string): Promise<ItemDTO> {
  const response = await apiFetch(`${API_URL}/items/${id}`);
  return (await parseJsonOrThrow(response)) as ItemDTO;
}

export async function createItem(input: CreateItemInput): Promise<ItemDTO> {
  const response = await apiFetch(`${API_URL}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ItemDTO;
}

export async function updateItem(
  id: string,
  input: UpdateItemInput,
): Promise<ItemDTO> {
  const response = await apiFetch(`${API_URL}/items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ItemDTO;
}

/** Vigência atual, histórico e a fonte que a seleção automática usa hoje. */
export async function getItemCostReferences(id: string): Promise<ItemCostReferencesResponse> {
  const response = await apiFetch(`${API_URL}/items/${id}/cost-references`);
  return (await parseJsonOrThrow(response)) as ItemCostReferencesResponse;
}

/** Cria uma vigência NOVA — a anterior fica no histórico. */
export async function createItemCostReference(
  id: string,
  input: CreateItemCostReferenceInput,
): Promise<ItemCostReferencesResponse> {
  const response = await apiFetch(`${API_URL}/items/${id}/cost-references`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ItemCostReferencesResponse;
}

export async function setItemActive(
  id: string,
  active: boolean,
): Promise<ItemDTO> {
  const response = await apiFetch(
    `${API_URL}/items/${id}/${active ? "activate" : "deactivate"}`,
    { method: "POST" },
  );
  return (await parseJsonOrThrow(response)) as ItemDTO;
}
