import type {
  CreateFormulationVersionInput,
  FormulationActivationImpactDTO,
  FormulationListResponse,
  FormulationVersionDTO,
  FormulationVersionListResponse,
  UpdateFormulationVersionInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListFormulationsParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function listFormulations(
  params: ListFormulationsParams = {},
): Promise<FormulationListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/formulations?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as FormulationListResponse;
}

export async function listFormulationVersionsByProduct(
  productId: string,
): Promise<FormulationVersionListResponse> {
  const response = await apiFetch(`${API_URL}/products/${productId}/formulations`);
  return (await parseJsonOrThrow(response)) as FormulationVersionListResponse;
}

export async function getFormulationVersion(id: string): Promise<FormulationVersionDTO> {
  const response = await apiFetch(`${API_URL}/formulation-versions/${id}`);
  return (await parseJsonOrThrow(response)) as FormulationVersionDTO;
}

export async function createFirstFormulationVersion(
  productId: string,
  input: CreateFormulationVersionInput = {},
): Promise<FormulationVersionDTO> {
  const response = await apiFetch(`${API_URL}/products/${productId}/formulation-versions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as FormulationVersionDTO;
}

export async function updateFormulationVersion(
  id: string,
  input: UpdateFormulationVersionInput,
): Promise<FormulationVersionDTO> {
  const response = await apiFetch(`${API_URL}/formulation-versions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as FormulationVersionDTO;
}

export async function activateFormulationVersion(id: string): Promise<FormulationVersionDTO> {
  const response = await apiFetch(`${API_URL}/formulation-versions/${id}/activate`, {
    method: "POST",
  });
  return (await parseJsonOrThrow(response)) as FormulationVersionDTO;
}

/** O que fica defasado se esta versão virar a ativa — leitura, nada muda. */
export async function getFormulationActivationImpact(
  id: string,
): Promise<FormulationActivationImpactDTO> {
  const response = await apiFetch(`${API_URL}/formulation-versions/${id}/activation-impact`);
  return (await parseJsonOrThrow(response)) as FormulationActivationImpactDTO;
}

export async function createNewFormulationVersion(
  sourceVersionId: string,
): Promise<FormulationVersionDTO> {
  const response = await apiFetch(`${API_URL}/formulation-versions/${sourceVersionId}/new-version`, {
    method: "POST",
  });
  return (await parseJsonOrThrow(response)) as FormulationVersionDTO;
}
