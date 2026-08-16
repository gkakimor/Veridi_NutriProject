import type {
  ApproveProjectInput,
  CancelProjectInput,
  ChangeProjectStatusInput,
  CreateProjectInput,
  ProjectDTO,
  ProjectListResponse,
  ProjectStatus,
  ProjectVocabularyResponse,
  QuoteVersionDTO,
  RejectQuoteInput,
  UpdateProjectInput,
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

export async function sendQuoteVersion(id: string): Promise<QuoteVersionDTO> {
  return postJson<QuoteVersionDTO>(`/quote-versions/${id}/send`);
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
