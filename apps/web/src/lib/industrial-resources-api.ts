import type {
  CreateIndustrialResourceInput,
  CreateIndustrialResourceRateInput,
  IndustrialResourceDetailDTO,
  IndustrialResourceListResponse,
  IndustrialResourceType,
  UpdateIndustrialResourceInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export async function listIndustrialResources(params: {
  search?: string;
  type?: IndustrialResourceType;
  active?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<IndustrialResourceListResponse> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    query.set(key, String(value));
  }
  const response = await apiFetch(`${API_URL}/industrial-resources?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as IndustrialResourceListResponse;
}

export async function getIndustrialResource(id: string): Promise<IndustrialResourceDetailDTO> {
  const response = await apiFetch(`${API_URL}/industrial-resources/${id}`);
  return (await parseJsonOrThrow(response)) as IndustrialResourceDetailDTO;
}

async function send(
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
): Promise<IndustrialResourceDetailDTO> {
  const response = await apiFetch(`${API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await parseJsonOrThrow(response)) as IndustrialResourceDetailDTO;
}

export async function createIndustrialResource(
  input: CreateIndustrialResourceInput,
): Promise<IndustrialResourceDetailDTO> {
  return send("/industrial-resources", "POST", input);
}

export async function updateIndustrialResource(
  id: string,
  input: UpdateIndustrialResourceInput,
): Promise<IndustrialResourceDetailDTO> {
  return send(`/industrial-resources/${id}`, "PATCH", input);
}

/** Reajuste é sempre tarifa nova: não existe edição de tarifa. */
export async function createIndustrialResourceRate(
  resourceId: string,
  input: CreateIndustrialResourceRateInput,
): Promise<IndustrialResourceDetailDTO> {
  return send(`/industrial-resources/${resourceId}/rates`, "POST", input);
}
