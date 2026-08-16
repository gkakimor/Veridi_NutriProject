import type {
  CreateCustomerInput,
  CustomerDTO,
  CustomerListResponse,
  UpdateCustomerInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListCustomersParams {
  search?: string;
  state?: string;
  active?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listCustomers(
  params: ListCustomersParams = {},
): Promise<CustomerListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.state) query.set("state", params.state);
  if (params.active !== undefined) query.set("active", String(params.active));
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/customers?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as CustomerListResponse;
}

export async function createCustomer(
  input: CreateCustomerInput,
): Promise<CustomerDTO> {
  const response = await apiFetch(`${API_URL}/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerDTO;
}

export async function updateCustomer(
  id: string,
  input: UpdateCustomerInput,
): Promise<CustomerDTO> {
  const response = await apiFetch(`${API_URL}/customers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerDTO;
}

export async function setCustomerActive(
  id: string,
  active: boolean,
): Promise<CustomerDTO> {
  const response = await apiFetch(
    `${API_URL}/customers/${id}/${active ? "activate" : "deactivate"}`,
    { method: "POST" },
  );
  return (await parseJsonOrThrow(response)) as CustomerDTO;
}
