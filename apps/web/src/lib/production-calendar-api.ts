import type {
  ProductionCalendarConfigInput,
  ProductionCalendarDTO,
  ProductionCalendarExceptionDTO,
  ProductionCalendarExceptionInput,
  ProductionCalendarExceptionListResponse,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/**
 * Planejamento → Calendário de Produção (PLANNING-CALENDAR-01).
 *
 * Rotas no singular e sem id: existe UM calendário de produção. Nada aqui
 * pergunta "qual calendário" — e não há CRUD de calendários para construir.
 */

async function read<T>(path: string): Promise<T> {
  return (await parseJsonOrThrow(await apiFetch(`${API_URL}${path}`))) as T;
}

async function send<T>(path: string, method: "POST" | "PATCH" | "PUT", body?: unknown): Promise<T> {
  const response = await apiFetch(`${API_URL}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return (await parseJsonOrThrow(response)) as T;
}

export const getProductionCalendar = () => read<ProductionCalendarDTO>("/production-calendar");

export const updateProductionCalendar = (input: ProductionCalendarConfigInput) =>
  send<ProductionCalendarDTO>("/production-calendar", "PUT", input);

export function listProductionCalendarExceptions(
  params: { from?: string; to?: string } = {},
): Promise<ProductionCalendarExceptionListResponse> {
  const q = new URLSearchParams();
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  const query = q.toString();
  return read<ProductionCalendarExceptionListResponse>(
    `/production-calendar/exceptions${query ? `?${query}` : ""}`,
  );
}

export const createProductionCalendarException = (input: ProductionCalendarExceptionInput) =>
  send<ProductionCalendarExceptionDTO>("/production-calendar/exceptions", "POST", input);

export const updateProductionCalendarException = (
  id: string,
  input: { type?: ProductionCalendarExceptionInput["type"]; reason?: string | null },
) =>
  send<ProductionCalendarExceptionDTO>(
    `/production-calendar/exceptions/${id}`,
    "PATCH",
    input,
  );

/** 204 sem corpo: não passa por `parseJsonOrThrow`. */
export async function deleteProductionCalendarException(id: string): Promise<void> {
  const response = await apiFetch(`${API_URL}/production-calendar/exceptions/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) await parseJsonOrThrow(response);
}
