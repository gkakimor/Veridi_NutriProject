import type {
  ActivateIndustrialCostVersionInput,
  CreateIndustrialCostLineInput,
  CreateIndustrialCostVersionInput,
  IndustrialCostVersionDTO,
  ProductIndustrialCostResponse,
  UpdateIndustrialCostVersionInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export async function getProductIndustrialCosts(
  productId: string,
): Promise<ProductIndustrialCostResponse> {
  const response = await apiFetch(`${API_URL}/products/${productId}/industrial-costs`);
  return (await parseJsonOrThrow(response)) as ProductIndustrialCostResponse;
}

export async function getIndustrialCostVersion(id: string): Promise<IndustrialCostVersionDTO> {
  const response = await apiFetch(`${API_URL}/industrial-costs/${id}`);
  return (await parseJsonOrThrow(response)) as IndustrialCostVersionDTO;
}

async function send(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<IndustrialCostVersionDTO> {
  const response = await apiFetch(`${API_URL}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return (await parseJsonOrThrow(response)) as IndustrialCostVersionDTO;
}

export async function createIndustrialCostVersion(
  productId: string,
  input: CreateIndustrialCostVersionInput = {},
): Promise<IndustrialCostVersionDTO> {
  return send(`/products/${productId}/industrial-costs`, "POST", input);
}

export async function updateIndustrialCostVersion(
  id: string,
  input: UpdateIndustrialCostVersionInput,
): Promise<IndustrialCostVersionDTO> {
  return send(`/industrial-costs/${id}`, "PATCH", input);
}

export async function createIndustrialCostLine(
  versionId: string,
  input: CreateIndustrialCostLineInput,
): Promise<IndustrialCostVersionDTO> {
  return send(`/industrial-costs/${versionId}/lines`, "POST", input);
}

export async function deleteIndustrialCostLine(lineId: string): Promise<IndustrialCostVersionDTO> {
  return send(`/industrial-cost-lines/${lineId}`, "DELETE");
}

export async function activateIndustrialCostVersion(
  id: string,
  input: ActivateIndustrialCostVersionInput = {},
): Promise<IndustrialCostVersionDTO> {
  return send(`/industrial-costs/${id}/activate`, "POST", input);
}
