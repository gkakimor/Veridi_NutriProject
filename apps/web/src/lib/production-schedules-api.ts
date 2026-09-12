import type {
  ProductionBoardResponse,
  ProductionBoardView,
  ProductionOrderScheduleDTO,
  ProductionSchedulePreviewDTO,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/**
 * Planejamento → Programação de Produção (PLANNING-CAPACITY-BOARD-01).
 *
 * A prévia é um POST porque CALCULA — e porque o instante escolhido viaja no
 * corpo. Ela não grava nada: quem grava é o PUT, depois de a pessoa ver o
 * resultado.
 */

async function send<T>(path: string, method: "POST" | "PUT", body?: unknown): Promise<T> {
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

export const getProductionOrderSchedule = (orderId: string) =>
  read<{ schedule: ProductionOrderScheduleDTO | null }>(
    `/production-orders/${orderId}/schedule`,
  );

export const previewProductionOrderSchedule = (orderId: string, startAt: string) =>
  send<ProductionSchedulePreviewDTO>(`/production-orders/${orderId}/schedule/preview`, "POST", {
    startAt,
  });

export const scheduleProductionOrder = (
  orderId: string,
  input: { startAt: string; notes?: string | null; confirmReleased?: boolean },
) => send<ProductionOrderScheduleDTO>(`/production-orders/${orderId}/schedule`, "PUT", input);

export async function unscheduleProductionOrder(orderId: string): Promise<void> {
  const response = await apiFetch(`${API_URL}/production-orders/${orderId}/schedule`, {
    method: "DELETE",
  });
  if (!response.ok) await parseJsonOrThrow(response);
}

export interface ProductionBoardParams {
  from: string;
  to: string;
  view: ProductionBoardView;
  status?: string;
  productId?: string;
  industrialResourceId?: string;
}

export function getProductionBoard(params: ProductionBoardParams) {
  const query = new URLSearchParams({ from: params.from, to: params.to, view: params.view });
  if (params.status) query.set("status", params.status);
  if (params.productId) query.set("productId", params.productId);
  if (params.industrialResourceId) query.set("industrialResourceId", params.industrialResourceId);
  return read<ProductionBoardResponse>(`/production-board?${query.toString()}`);
}
