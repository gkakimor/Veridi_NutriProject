import type {
  ActivatePricingVersionInput,
  CreatePricingTierInput,
  CreatePricingVersionInput,
  PricingVersionDTO,
  PricingVersionListResponse,
  ProductPricingResponse,
  UpdatePricingTierInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/**
 * Precificação — o frontend só envia inputs e desenha o resultado.
 *
 * Preço, margem, markup e contribuição são calculados no backend, inclusive
 * na pré-visualização do rascunho: qualquer conta feita aqui viraria uma
 * segunda verdade econômica.
 */
export async function listPricingVersions(params: {
  search?: string;
  status?: string;
  quality?: string;
  page?: number;
  pageSize?: number;
}): Promise<PricingVersionListResponse> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    query.set(key, String(value));
  }
  const response = await apiFetch(`${API_URL}/pricing-versions?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as PricingVersionListResponse;
}

export async function getPricingVersion(id: string): Promise<PricingVersionDTO> {
  const response = await apiFetch(`${API_URL}/pricing-versions/${id}`);
  return (await parseJsonOrThrow(response)) as PricingVersionDTO;
}

export async function getProductPricing(productId: string): Promise<ProductPricingResponse> {
  const response = await apiFetch(`${API_URL}/products/${productId}/pricing`);
  return (await parseJsonOrThrow(response)) as ProductPricingResponse;
}

async function send(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<PricingVersionDTO> {
  const response = await apiFetch(`${API_URL}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return (await parseJsonOrThrow(response)) as PricingVersionDTO;
}

export async function createPricingVersion(
  productId: string,
  input: CreatePricingVersionInput,
): Promise<PricingVersionDTO> {
  return send(`/products/${productId}/pricing`, "POST", input);
}

export async function createPricingTier(
  pricingVersionId: string,
  input: CreatePricingTierInput,
): Promise<PricingVersionDTO> {
  return send(`/pricing-versions/${pricingVersionId}/tiers`, "POST", input);
}

export async function updatePricingTier(
  tierId: string,
  input: UpdatePricingTierInput,
): Promise<PricingVersionDTO> {
  return send(`/pricing-tiers/${tierId}`, "PATCH", input);
}

export async function deletePricingTier(tierId: string): Promise<PricingVersionDTO> {
  return send(`/pricing-tiers/${tierId}`, "DELETE");
}

export async function activatePricingVersion(
  id: string,
  input: ActivatePricingVersionInput = {},
): Promise<PricingVersionDTO> {
  return send(`/pricing-versions/${id}/activate`, "POST", input);
}
