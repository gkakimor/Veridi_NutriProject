import type {
  CreateProductInput,
  ProductDTO,
  ProductListResponse,
  UpdateProductInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListProductsParams {
  search?: string;
  active?: boolean;
  customerId?: string;
  lifecycle?: "DEVELOPMENT" | "APPROVED";
  page?: number;
  pageSize?: number;
}

export async function listProducts(
  params: ListProductsParams = {},
): Promise<ProductListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.active !== undefined) query.set("active", String(params.active));
  if (params.customerId) query.set("customerId", params.customerId);
  if (params.lifecycle) query.set("lifecycle", params.lifecycle);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/products?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as ProductListResponse;
}

export async function getProduct(id: string): Promise<ProductDTO> {
  const response = await apiFetch(`${API_URL}/products/${id}`);
  return (await parseJsonOrThrow(response)) as ProductDTO;
}

export async function createProduct(input: CreateProductInput): Promise<ProductDTO> {
  const response = await apiFetch(`${API_URL}/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ProductDTO;
}

export async function updateProduct(
  id: string,
  input: UpdateProductInput,
): Promise<ProductDTO> {
  const response = await apiFetch(`${API_URL}/products/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ProductDTO;
}

export async function setProductActive(
  id: string,
  active: boolean,
): Promise<ProductDTO> {
  const response = await apiFetch(
    `${API_URL}/products/${id}/${active ? "activate" : "deactivate"}`,
    { method: "POST" },
  );
  return (await parseJsonOrThrow(response)) as ProductDTO;
}
