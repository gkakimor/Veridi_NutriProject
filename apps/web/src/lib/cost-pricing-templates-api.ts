import type {
  CostTemplateDTO,
  CostTemplateListResponse,
  CostTemplateVersionDTO,
  CreateCostTemplateInput,
  CreatePricingPolicyInput,
  IndustrialCostVersionDTO,
  PricingPolicyDTO,
  PricingPolicyListResponse,
  PricingPolicyPreviewDTO,
  PricingPolicyVersionDTO,
  PricingVersionDTO,
  TemplateDiffDTO,
  TemplateUpdateAvailableDTO,
  UpdateCostTemplateVersionInput,
  UpdatePricingPolicyVersionInput,
  UpdateTemplateIdentityInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/** Bibliotecas de Estrutura de Custos (TEC) e Política de Precificação (TPP). */

async function send<T>(path: string, method: "POST" | "PATCH", body?: unknown): Promise<T> {
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

export interface ListParams {
  search?: string;
  archived?: boolean;
  page?: number;
  pageSize?: number;
}

function query(params: ListParams): string {
  const q = new URLSearchParams();
  if (params.search) q.set("search", params.search);
  if (params.archived !== undefined) q.set("archived", String(params.archived));
  q.set("page", String(params.page ?? 1));
  q.set("pageSize", String(params.pageSize ?? 20));
  return q.toString();
}

// ───────────────────────────────────────────── Templates de Estrutura

export const listCostTemplates = (params: ListParams = {}) =>
  read<CostTemplateListResponse>(`/cost-templates?${query(params)}`);

export const getCostTemplate = (id: string) => read<CostTemplateDTO>(`/cost-templates/${id}`);

export const createCostTemplate = (input: CreateCostTemplateInput) =>
  send<CostTemplateDTO>("/cost-templates", "POST", input);

export const updateCostTemplate = (id: string, input: UpdateTemplateIdentityInput) =>
  send<CostTemplateDTO>(`/cost-templates/${id}`, "PATCH", input);

export const setCostTemplateArchived = (id: string, archived: boolean) =>
  send<CostTemplateDTO>(`/cost-templates/${id}/archive`, "POST", { archived });

export const updateCostTemplateVersion = (id: string, input: UpdateCostTemplateVersionInput) =>
  send<CostTemplateVersionDTO>(`/cost-template-versions/${id}`, "PATCH", input);

export const activateCostTemplateVersion = (id: string) =>
  send<CostTemplateVersionDTO>(`/cost-template-versions/${id}/activate`, "POST", {});

export const createCostTemplateVersionFrom = (id: string) =>
  send<CostTemplateVersionDTO>(`/cost-template-versions/${id}/new-version`, "POST", {});

export const compareCostTemplateVersions = (fromId: string, againstId: string) =>
  read<TemplateDiffDTO>(`/cost-template-versions/${fromId}/compare?against=${againstId}`);

/** Aplica ao produto: copia a CONFIGURAÇÃO, nunca a tarifa. */
export const applyCostTemplateToProduct = (productId: string, costTemplateVersionId: string) =>
  send<IndustrialCostVersionDTO>(
    `/products/${productId}/industrial-costs/from-template`,
    "POST",
    { costTemplateVersionId },
  );

export const getCostTemplateUpdate = async (costVersionId: string) =>
  (await read<{ update: TemplateUpdateAvailableDTO | null }>(
    `/industrial-costs/${costVersionId}/template-update`,
  )).update;

export const compareCostVersionWithTemplate = (costVersionId: string, againstId?: string) =>
  read<TemplateDiffDTO>(
    `/industrial-costs/${costVersionId}/template-diff${againstId ? `?against=${againstId}` : ""}`,
  );

export const createCostTemplateFromVersion = (
  costVersionId: string,
  input: { name: string; description?: string | null },
) => send<CostTemplateDTO>(`/industrial-costs/${costVersionId}/save-as-template`, "POST", input);

// ─────────────────────────────────────── Políticas de Precificação

export const listPricingPolicies = (params: ListParams = {}) =>
  read<PricingPolicyListResponse>(`/pricing-policies?${query(params)}`);

export const getPricingPolicy = (id: string) => read<PricingPolicyDTO>(`/pricing-policies/${id}`);

export const createPricingPolicy = (input: CreatePricingPolicyInput) =>
  send<PricingPolicyDTO>("/pricing-policies", "POST", input);

export const updatePricingPolicy = (id: string, input: UpdateTemplateIdentityInput) =>
  send<PricingPolicyDTO>(`/pricing-policies/${id}`, "PATCH", input);

export const setPricingPolicyArchived = (id: string, archived: boolean) =>
  send<PricingPolicyDTO>(`/pricing-policies/${id}/archive`, "POST", { archived });

export const updatePricingPolicyVersion = (id: string, input: UpdatePricingPolicyVersionInput) =>
  send<PricingPolicyVersionDTO>(`/pricing-policy-versions/${id}`, "PATCH", input);

export const activatePricingPolicyVersion = (id: string) =>
  send<PricingPolicyVersionDTO>(`/pricing-policy-versions/${id}/activate`, "POST", {});

export const createPolicyVersionFrom = (id: string) =>
  send<PricingPolicyVersionDTO>(`/pricing-policy-versions/${id}/new-version`, "POST", {});

export const comparePricingPolicyVersions = (fromId: string, againstId: string) =>
  read<TemplateDiffDTO>(`/pricing-policy-versions/${fromId}/compare?against=${againstId}`);

/**
 * Prévia: o que ESTA política produziria NESTE produto.
 *
 * Leitura pura. A mesma política dá preços diferentes em produtos diferentes,
 * e isso precisa estar visível antes de confirmar.
 */
export const previewPricingPolicy = (
  productId: string,
  pricingPolicyVersionId: string,
  industrialCostCalculationId: string,
) =>
  send<PricingPolicyPreviewDTO>(`/products/${productId}/pricing/policy-preview`, "POST", {
    pricingPolicyVersionId,
    industrialCostCalculationId,
  });

export const applyPricingPolicyToProduct = (
  productId: string,
  pricingPolicyVersionId: string,
  industrialCostCalculationId: string,
) =>
  send<PricingVersionDTO>(`/products/${productId}/pricing/from-policy`, "POST", {
    pricingPolicyVersionId,
    industrialCostCalculationId,
  });

export const getPricingPolicyUpdate = async (pricingVersionId: string) =>
  (await read<{ update: TemplateUpdateAvailableDTO | null }>(
    `/pricing-versions/${pricingVersionId}/policy-update`,
  )).update;

export const createPolicyFromPricingVersion = (
  pricingVersionId: string,
  input: { name: string; description?: string | null },
) => send<PricingPolicyDTO>(`/pricing-versions/${pricingVersionId}/save-as-policy`, "POST", input);
