import type {
  CreateInternalConsumptionInput,
  CreateInternalConsumptionReversalInput,
  InternalConsumptionAvailabilityDTO,
  InternalConsumptionDetailDTO,
  InternalConsumptionDTO,
  InternalConsumptionListResponse,
  InternalConsumptionReversalDTO,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/** Estoque → Uso e consumo. Saída física própria, nunca ajuste. */

export interface ListInternalConsumptionsParams {
  search?: string;
  itemId?: string;
  /** Dia civil `AAAA-MM-DD`; o servidor lê o período em dias comerciais. */
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export async function listInternalConsumptions(
  params: ListInternalConsumptionsParams = {},
): Promise<InternalConsumptionListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.itemId) query.set("itemId", params.itemId);
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/internal-consumptions?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as InternalConsumptionListResponse;
}

/**
 * Saldo do item para a tela, respondido pelo MESMO cálculo que a gravação
 * confere — a tela nunca promete saldo que o servidor recusa.
 */
export async function getInternalConsumptionAvailability(
  itemId: string,
): Promise<InternalConsumptionAvailabilityDTO> {
  const response = await apiFetch(`${API_URL}/internal-consumptions/availability/${itemId}`);
  return (await parseJsonOrThrow(response)) as InternalConsumptionAvailabilityDTO;
}

export async function createInternalConsumption(
  input: CreateInternalConsumptionInput,
): Promise<InternalConsumptionDTO> {
  const response = await apiFetch(`${API_URL}/internal-consumptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as InternalConsumptionDTO;
}

/**
 * O consumo aberto para estornar: estornos anteriores e os avisos (item
 * inativo, lote bloqueado ou vencido, ajuste manual posterior), lidos na hora.
 */
export async function getInternalConsumption(id: string): Promise<InternalConsumptionDetailDTO> {
  const response = await apiFetch(`${API_URL}/internal-consumptions/${id}`);
  return (await parseJsonOrThrow(response)) as InternalConsumptionDetailDTO;
}

/** Estorno (INTERNAL-CONSUMPTION-REVERSAL-01). A recusa volta com a mensagem inteira. */
export async function createInternalConsumptionReversal(
  id: string,
  input: CreateInternalConsumptionReversalInput,
): Promise<InternalConsumptionReversalDTO> {
  const response = await apiFetch(`${API_URL}/internal-consumptions/${id}/reversals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as InternalConsumptionReversalDTO;
}
