import type {
  CreateFormulationTemplateInput,
  CreateTemplateFromFormulationInput,
  FormulationTemplateDTO,
  FormulationTemplateDiffDTO,
  FormulationTemplateListResponse,
  FormulationTemplateUpdateAvailableDTO,
  FormulationTemplateVersionDTO,
  FormulationVersionDTO,
  UpdateFormulationTemplateInput,
  UpdateFormulationTemplateVersionInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/** Biblioteca técnica de Formulações — matrizes reutilizáveis entre clientes. */

async function send<T>(path: string, method: "POST" | "PATCH", body?: unknown): Promise<T> {
  const response = await apiFetch(`${API_URL}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return (await parseJsonOrThrow(response)) as T;
}

export interface ListTemplatesParams {
  search?: string;
  archived?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listFormulationTemplates(
  params: ListTemplatesParams = {},
): Promise<FormulationTemplateListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.archived !== undefined) query.set("archived", String(params.archived));
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));
  const response = await apiFetch(`${API_URL}/formulation-templates?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as FormulationTemplateListResponse;
}

export async function getFormulationTemplate(id: string): Promise<FormulationTemplateDTO> {
  const response = await apiFetch(`${API_URL}/formulation-templates/${id}`);
  return (await parseJsonOrThrow(response)) as FormulationTemplateDTO;
}

export async function createFormulationTemplate(
  input: CreateFormulationTemplateInput,
): Promise<FormulationTemplateDTO> {
  return send<FormulationTemplateDTO>("/formulation-templates", "POST", input);
}

export async function updateFormulationTemplate(
  id: string,
  input: UpdateFormulationTemplateInput,
): Promise<FormulationTemplateDTO> {
  return send<FormulationTemplateDTO>(`/formulation-templates/${id}`, "PATCH", input);
}

export async function setFormulationTemplateArchived(
  id: string,
  archived: boolean,
): Promise<FormulationTemplateDTO> {
  return send<FormulationTemplateDTO>(`/formulation-templates/${id}/archive`, "POST", {
    archived,
  });
}

export async function updateFormulationTemplateVersion(
  id: string,
  input: UpdateFormulationTemplateVersionInput,
): Promise<FormulationTemplateVersionDTO> {
  return send<FormulationTemplateVersionDTO>(
    `/formulation-template-versions/${id}`,
    "PATCH",
    input,
  );
}

export async function activateFormulationTemplateVersion(
  id: string,
): Promise<FormulationTemplateVersionDTO> {
  return send<FormulationTemplateVersionDTO>(
    `/formulation-template-versions/${id}/activate`,
    "POST",
    {},
  );
}

export async function createTemplateVersionFrom(
  id: string,
): Promise<FormulationTemplateVersionDTO> {
  return send<FormulationTemplateVersionDTO>(
    `/formulation-template-versions/${id}/new-version`,
    "POST",
    {},
  );
}

export async function compareTemplateVersions(
  fromId: string,
  againstId: string,
): Promise<FormulationTemplateDiffDTO> {
  const response = await apiFetch(
    `${API_URL}/formulation-template-versions/${fromId}/compare?against=${againstId}`,
  );
  return (await parseJsonOrThrow(response)) as FormulationTemplateDiffDTO;
}

/** Aplica o template ao produto — sempre cópia, nunca vínculo. */
export async function applyTemplateToProduct(
  productId: string,
  formulationTemplateVersionId: string,
): Promise<FormulationVersionDTO> {
  return send<FormulationVersionDTO>(
    `/products/${productId}/formulation-versions/from-template`,
    "POST",
    { formulationTemplateVersionId },
  );
}

export async function getTemplateUpdateAvailable(
  formulationVersionId: string,
): Promise<FormulationTemplateUpdateAvailableDTO | null> {
  const response = await apiFetch(
    `${API_URL}/formulation-versions/${formulationVersionId}/template-update`,
  );
  const body = (await parseJsonOrThrow(response)) as {
    update: FormulationTemplateUpdateAvailableDTO | null;
  };
  return body.update;
}

export async function compareFormulationWithTemplate(
  formulationVersionId: string,
  againstId?: string,
): Promise<FormulationTemplateDiffDTO> {
  const query = againstId ? `?against=${againstId}` : "";
  const response = await apiFetch(
    `${API_URL}/formulation-versions/${formulationVersionId}/template-diff${query}`,
  );
  return (await parseJsonOrThrow(response)) as FormulationTemplateDiffDTO;
}

export async function createTemplateFromFormulation(
  formulationVersionId: string,
  input: CreateTemplateFromFormulationInput,
): Promise<FormulationTemplateDTO> {
  return send<FormulationTemplateDTO>(
    `/formulation-versions/${formulationVersionId}/save-as-template`,
    "POST",
    input,
  );
}
