import type {
  CustomerOrderDTO,
  ApproveProjectInput,
  CancelProjectInput,
  ChangeProjectStatusInput,
  CreateProjectInput,
  ProjectDTO,
  ProjectListResponse,
  ProjectProductDTO,
  ProjectStatus,
  PricingVersionDTO,
  ProjectVocabularyResponse,
  QuoteVersionDTO,
  RejectQuoteInput,
  UpdateProjectInput,
  QuotePaymentScheduleDTO,
  UpdateQuoteVersionInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListProjectsParams {
  search?: string;
  customerId?: string;
  status?: ProjectStatus;
  channel?: string;
  concept?: string;
  responsibleUserId?: string;
  entryFrom?: string;
  entryTo?: string;
  page?: number;
  pageSize?: number;
}

export async function listProjects(params: ListProjectsParams = {}): Promise<ProjectListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.customerId) query.set("customerId", params.customerId);
  if (params.status) query.set("status", params.status);
  if (params.channel) query.set("channel", params.channel);
  if (params.concept) query.set("concept", params.concept);
  if (params.responsibleUserId) query.set("responsibleUserId", params.responsibleUserId);
  if (params.entryFrom) query.set("entryFrom", params.entryFrom);
  if (params.entryTo) query.set("entryTo", params.entryTo);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/projects?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as ProjectListResponse;
}

export async function getProject(id: string): Promise<ProjectDTO> {
  const response = await apiFetch(`${API_URL}/projects/${id}`);
  return (await parseJsonOrThrow(response)) as ProjectDTO;
}

export async function getProjectVocabulary(): Promise<ProjectVocabularyResponse> {
  const response = await apiFetch(`${API_URL}/projects/vocabulary`);
  return (await parseJsonOrThrow(response)) as ProjectVocabularyResponse;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return (await parseJsonOrThrow(response)) as T;
}

export async function createProject(input: CreateProjectInput): Promise<ProjectDTO> {
  return postJson<ProjectDTO>("/projects", input);
}

export async function updateProject(id: string, input: UpdateProjectInput): Promise<ProjectDTO> {
  const response = await apiFetch(`${API_URL}/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ProjectDTO;
}

export async function changeProjectStatus(
  id: string,
  input: ChangeProjectStatusInput,
): Promise<ProjectDTO> {
  return postJson<ProjectDTO>(`/projects/${id}/status`, input);
}

export async function cancelProject(id: string, input: CancelProjectInput): Promise<ProjectDTO> {
  return postJson<ProjectDTO>(`/projects/${id}/cancel`, input);
}

export async function approveProject(
  id: string,
  input: ApproveProjectInput = {},
): Promise<ProjectDTO> {
  return postJson<ProjectDTO>(`/projects/${id}/approve`, input);
}

export async function createQuoteVersion(projectId: string): Promise<QuoteVersionDTO> {
  return postJson<QuoteVersionDTO>(`/projects/${projectId}/quote-versions`);
}

export async function getQuoteVersion(id: string): Promise<QuoteVersionDTO> {
  const response = await apiFetch(`${API_URL}/quote-versions/${id}`);
  return (await parseJsonOrThrow(response)) as QuoteVersionDTO;
}

export async function updateQuoteVersion(
  id: string,
  input: UpdateQuoteVersionInput,
): Promise<QuoteVersionDTO> {
  const response = await apiFetch(`${API_URL}/quote-versions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as QuoteVersionDTO;
}

/** Simula as condições sem gravar — a conta continua sendo do backend. */
export async function previewQuotePaymentSchedule(
  id: string,
  input: UpdateQuoteVersionInput,
): Promise<QuotePaymentScheduleDTO | null> {
  const body = await postJson<{ schedule: QuotePaymentScheduleDTO | null }>(
    `/quote-versions/${id}/payment-preview`,
    input,
  );
  return body.schedule;
}

export async function sendQuoteVersion(
  id: string,
  input: { confirmIncompleteCost?: boolean } = {},
): Promise<QuoteVersionDTO> {
  return postJson<QuoteVersionDTO>(`/quote-versions/${id}/send`, input);
}

/**
 * Gera o pedido da proposta aceita — ou reabre o que já existe.
 *
 * A API responde 201 quando nasce e 200 quando já havia. Do lado da tela o
 * resultado é o mesmo: o pedido do acordo, aberto.
 */
export async function createOrderFromQuote(id: string): Promise<CustomerOrderDTO> {
  return postJson<CustomerOrderDTO>(`/quote-versions/${id}/create-order`, {});
}

export async function acceptQuoteVersion(id: string): Promise<QuoteVersionDTO> {
  return postJson<QuoteVersionDTO>(`/quote-versions/${id}/accept`);
}

export async function rejectQuoteVersion(
  id: string,
  input: RejectQuoteInput = {},
): Promise<QuoteVersionDTO> {
  return postJson<QuoteVersionDTO>(`/quote-versions/${id}/reject`, input);
}

/**
 * Prepara o produto técnico do projeto.
 *
 * É o que destrava engenharia e custeio antes da aprovação comercial — sem
 * mudar o status do projeto e sem criar produto duplicado.
 */
export async function prepareTechnicalProduct(
  projectId: string,
  input: { finishedUnitCode?: string } = {},
): Promise<ProjectDTO> {
  return postJson<ProjectDTO>(`/projects/${projectId}/technical-product`, input);
}

/** Precificação ATIVA disponível para embasar a proposta. */
export async function getQuotePricingOptions(
  lineId: string,
): Promise<PricingVersionDTO | null> {
  const response = await apiFetch(`${API_URL}/quote-lines/${lineId}/pricing-options`);
  if (response.status === 404) return null;
  return (await parseJsonOrThrow(response)) as PricingVersionDTO;
}

export async function applyQuotePricing(
  lineId: string,
  pricingTierId: string,
): Promise<QuoteVersionDTO> {
  return postJson<QuoteVersionDTO>(`/quote-lines/${lineId}/apply-pricing`, { pricingTierId });
}

export async function useManualQuotePrice(
  lineId: string): Promise<QuoteVersionDTO> {
  return postJson<QuoteVersionDTO>(`/quote-lines/${lineId}/manual-price`);
}

/* ─────────────── Produtos do projeto ─────────────── */

export async function listProjectProducts(projectId: string): Promise<ProjectProductDTO[]> {
  const response = await apiFetch(`${API_URL}/projects/${projectId}/products`);
  const body = (await parseJsonOrThrow(response)) as { products: ProjectProductDTO[] };
  return body.products;
}

/** Cria um produto novo no projeto — nasce em desenvolvimento. */
export async function createProjectProduct(
  projectId: string,
  input: { name?: string; finishedUnitCode?: string },
): Promise<ProjectProductDTO> {
  return postJson<ProjectProductDTO>(`/projects/${projectId}/products`, {
    operation: "create",
    ...input,
  });
}

/** Vincula um produto que já existe. */
export async function linkProjectProduct(
  projectId: string,
  productId: string,
): Promise<ProjectProductDTO> {
  return postJson<ProjectProductDTO>(`/projects/${projectId}/products`, {
    operation: "link",
    productId,
  });
}

export async function removeProjectProduct(projectProductId: string): Promise<void> {
  const response = await apiFetch(`${API_URL}/project-products/${projectProductId}`, {
    method: "DELETE",
  });
  if (!response.ok) await parseJsonOrThrow(response);
}

/* ─────────────── Linhas do orçamento ─────────────── */

export async function addQuoteLine(
  quoteVersionId: string,
  projectProductId: string,
): Promise<QuoteVersionDTO> {
  return postJson<QuoteVersionDTO>(`/quote-versions/${quoteVersionId}/lines`, {
    projectProductId,
  });
}

export async function updateQuoteLine(
  lineId: string,
  input: { quotedQuantity?: string | null; uomCode?: string | null; unitPrice?: string | null },
): Promise<QuoteVersionDTO> {
  const response = await apiFetch(`${API_URL}/quote-lines/${lineId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as QuoteVersionDTO;
}

export async function removeQuoteLine(lineId: string): Promise<QuoteVersionDTO> {
  const response = await apiFetch(`${API_URL}/quote-lines/${lineId}`, { method: "DELETE" });
  return (await parseJsonOrThrow(response)) as QuoteVersionDTO;
}
