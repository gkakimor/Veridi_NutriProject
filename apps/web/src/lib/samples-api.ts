import type {
  CreateProjectSampleInput,
  ProduceSampleInput,
  ProjectSampleDTO,
  ProjectSampleListResponse,
  ProjectSampleStatus,
  RegisterSampleConsumptionInput,
  SampleDecisionInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListSamplesParams {
  search?: string;
  projectId?: string;
  customerId?: string;
  status?: ProjectSampleStatus;
  producedFrom?: string;
  producedTo?: string;
  page?: number;
  pageSize?: number;
}

export function samplesQueryString(params: ListSamplesParams): string {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.projectId) query.set("projectId", params.projectId);
  if (params.customerId) query.set("customerId", params.customerId);
  if (params.status) query.set("status", params.status);
  if (params.producedFrom) query.set("producedFrom", params.producedFrom);
  if (params.producedTo) query.set("producedTo", params.producedTo);
  return query.toString();
}

export async function listSamples(
  params: ListSamplesParams = {},
): Promise<ProjectSampleListResponse> {
  const query = new URLSearchParams(samplesQueryString(params));
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/project-samples?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as ProjectSampleListResponse;
}

export async function getSample(id: string): Promise<ProjectSampleDTO> {
  const response = await apiFetch(`${API_URL}/project-samples/${id}`);
  return (await parseJsonOrThrow(response)) as ProjectSampleDTO;
}

async function postJson(path: string, body?: unknown): Promise<ProjectSampleDTO> {
  const response = await apiFetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return (await parseJsonOrThrow(response)) as ProjectSampleDTO;
}

export async function createSample(
  projectId: string,
  input: CreateProjectSampleInput = {},
): Promise<ProjectSampleDTO> {
  return postJson(`/projects/${projectId}/samples`, input);
}

export async function registerSampleConsumption(
  sampleId: string,
  input: RegisterSampleConsumptionInput,
): Promise<ProjectSampleDTO> {
  return postJson(`/project-samples/${sampleId}/consumptions`, input);
}

export async function produceSample(
  sampleId: string,
  input: ProduceSampleInput,
): Promise<ProjectSampleDTO> {
  return postJson(`/project-samples/${sampleId}/produce`, input);
}

export async function approveSample(
  sampleId: string,
  input: SampleDecisionInput = {},
): Promise<ProjectSampleDTO> {
  return postJson(`/project-samples/${sampleId}/approve`, input);
}

export async function rejectSample(
  sampleId: string,
  input: SampleDecisionInput,
): Promise<ProjectSampleDTO> {
  return postJson(`/project-samples/${sampleId}/reject`, input);
}

export async function cancelSample(
  sampleId: string,
  input: SampleDecisionInput = {},
): Promise<ProjectSampleDTO> {
  return postJson(`/project-samples/${sampleId}/cancel`, input);
}
