import type {
  CreateItemInput,
  ItemDTO,
  ItemListResponse,
  ItemType,
  UpdateItemInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListItemsParams {
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
