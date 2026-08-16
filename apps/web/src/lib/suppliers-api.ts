import type {
  CreateSupplierInput,
  SupplierDTO,
  SupplierListResponse,
  UpdateSupplierInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListSuppliersParams {
  search?: string;
  active?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listSuppliers(
  params: ListSuppliersParams = {},
): Promise<SupplierListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.active !== undefined) query.set("active", String(params.active));
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/suppliers?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as SupplierListResponse;
}

export async function createSupplier(
  input: CreateSupplierInput,
): Promise<SupplierDTO> {
  const response = await apiFetch(`${API_URL}/suppliers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as SupplierDTO;
}

export async function updateSupplier(
  id: string,
  input: UpdateSupplierInput,
): Promise<SupplierDTO> {
  const response = await apiFetch(`${API_URL}/suppliers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as SupplierDTO;
}

export async function setSupplierActive(
  id: string,
  active: boolean,
): Promise<SupplierDTO> {
  const response = await apiFetch(
    `${API_URL}/suppliers/${id}/${active ? "activate" : "deactivate"}`,
    { method: "POST" },
  );
  return (await parseJsonOrThrow(response)) as SupplierDTO;
}
