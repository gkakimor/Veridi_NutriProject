import type {
  CreateProductionProfileInput,
  ProductProductionProfileDTO,
  ProductionProfileDTO,
  ProductionProfileListResponse,
  ProductionProfileVersionDTO,
  UpdateProductionProfileIdentityInput,
  UpdateProductionProfileVersionInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/**
 * Planejamento → Perfis de Produção.
 *
 * A simulação não passa por aqui: é a conta de `planProductionProfile`, do
 * `@veridi/shared` — o mesmo motor do servidor —, feita na tela e nunca
 * gravada.
 */

async function send<T>(path: string, method: "POST" | "PATCH" | "PUT", body?: unknown): Promise<T> {
  const response = await apiFetch(`${API_URL}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return (await parseJsonOrThrow(response)) as T;
}

async function read<T>(path: string): Promise<T> {
  return (await parseJsonOrThrow(await apiFetch(`${API_URL}${path}`))) as T;
}

export interface ProductionProfileListParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

export function listProductionProfiles(
  params: ProductionProfileListParams = {},
): Promise<ProductionProfileListResponse> {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  q.set("page", String(params.page ?? 1));
  q.set("pageSize", String(params.pageSize ?? 20));
  return read<ProductionProfileListResponse>(`/production-profiles?${q.toString()}`);
}

export const getProductionProfile = (id: string) =>
  read<ProductionProfileDTO>(`/production-profiles/${id}`);

export const createProductionProfile = (input: CreateProductionProfileInput) =>
  send<ProductionProfileDTO>("/production-profiles", "POST", input);

export const updateProductionProfile = (id: string, input: UpdateProductionProfileIdentityInput) =>
  send<ProductionProfileDTO>(`/production-profiles/${id}`, "PATCH", input);

export const updateProductionProfileVersion = (
  id: string,
  input: UpdateProductionProfileVersionInput,
) => send<ProductionProfileVersionDTO>(`/production-profile-versions/${id}`, "PATCH", input);

export const activateProductionProfileVersion = (id: string) =>
  send<ProductionProfileVersionDTO>(`/production-profile-versions/${id}/activate`, "POST", {});

export const createProductionProfileVersionFrom = (id: string) =>
  send<ProductionProfileVersionDTO>(`/production-profile-versions/${id}/new-version`, "POST", {});

/** `null` tira o padrão: produto sem perfil continua válido. */
export const setProductProductionProfile = (
  productId: string,
  productionProfileVersionId: string | null,
) =>
  send<ProductProductionProfileDTO>(`/products/${productId}/production-profile`, "PUT", {
    productionProfileVersionId,
  });
