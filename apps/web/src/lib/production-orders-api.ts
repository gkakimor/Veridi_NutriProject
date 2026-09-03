import type {
  CancelProductionOrderInput,
  CompleteProductionOrderInput,
  CreateProductionOrderInput,
  ProductionOrderDTO,
  ProductionOrderListResponse,
  ProductionOrderStatus,
  RegisterProductionOutputInput,
  UpdateProductionOrderInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListProductionOrdersParams {
  search?: string;
  status?: ProductionOrderStatus;
  productId?: string;
  page?: number;
  pageSize?: number;
}

export async function listProductionOrders(
  params: ListProductionOrdersParams = {},
): Promise<ProductionOrderListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.status) query.set("status", params.status);
  if (params.productId) query.set("productId", params.productId);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/production-orders?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as ProductionOrderListResponse;
}

export async function getProductionOrder(id: string): Promise<ProductionOrderDTO> {
  const response = await apiFetch(`${API_URL}/production-orders/${id}`);
  return (await parseJsonOrThrow(response)) as ProductionOrderDTO;
}

export async function createProductionOrder(
  input: CreateProductionOrderInput,
): Promise<ProductionOrderDTO> {
  const response = await apiFetch(`${API_URL}/production-orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ProductionOrderDTO;
}

export async function updateProductionOrder(
  id: string,
  input: UpdateProductionOrderInput,
): Promise<ProductionOrderDTO> {
  const response = await apiFetch(`${API_URL}/production-orders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ProductionOrderDTO;
}

export async function planProductionOrder(id: string): Promise<ProductionOrderDTO> {
  const response = await apiFetch(`${API_URL}/production-orders/${id}/plan`, { method: "POST" });
  return (await parseJsonOrThrow(response)) as ProductionOrderDTO;
}

export async function releaseProductionOrder(id: string): Promise<ProductionOrderDTO> {
  const response = await apiFetch(`${API_URL}/production-orders/${id}/release`, { method: "POST" });
  return (await parseJsonOrThrow(response)) as ProductionOrderDTO;
}

export async function cancelProductionOrder(
  id: string,
  input: CancelProductionOrderInput,
): Promise<ProductionOrderDTO> {
  const response = await apiFetch(`${API_URL}/production-orders/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ProductionOrderDTO;
}

export async function confirmPicking(
  productionOrderId: string,
  reservationLineId: string,
  lotCode?: string,
): Promise<ProductionOrderDTO> {
  const response = await apiFetch(
    `${API_URL}/production-orders/${productionOrderId}/picking/${reservationLineId}/confirm`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lotCode ? { lotCode } : {}),
    },
  );
  return (await parseJsonOrThrow(response)) as ProductionOrderDTO;
}

export async function substituteReservationLine(
  productionOrderId: string,
  reservationLineId: string,
  lotCode: string,
): Promise<ProductionOrderDTO> {
  const response = await apiFetch(
    `${API_URL}/production-orders/${productionOrderId}/picking/${reservationLineId}/substitute`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lotCode }),
    },
  );
  return (await parseJsonOrThrow(response)) as ProductionOrderDTO;
}

export async function recordConsumption(
  productionOrderId: string,
  entries: { reservationLineId: string; quantity: string }[],
): Promise<ProductionOrderDTO> {
  const response = await apiFetch(`${API_URL}/production-orders/${productionOrderId}/consumptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  return (await parseJsonOrThrow(response)) as ProductionOrderDTO;
}

export async function registerProductionOutput(
  productionOrderId: string,
  input: RegisterProductionOutputInput,
): Promise<ProductionOrderDTO> {
  const response = await apiFetch(`${API_URL}/production-orders/${productionOrderId}/outputs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ProductionOrderDTO;
}

/**
 * Justifica a diferença entre a necessidade de um material e o consumo real.
 *
 * Por requisito, nunca por ordem: a pergunta é sobre um material específico, e
 * uma justificativa por ordem obrigaria a explicar seis diferenças numa frase.
 */
export async function acceptMaterialVariance(
  productionOrderId: string,
  requirementId: string,
  reason: string,
): Promise<ProductionOrderDTO> {
  const response = await apiFetch(
    `${API_URL}/production-orders/${productionOrderId}/requirements/${requirementId}/variance`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    },
  );
  return (await parseJsonOrThrow(response)) as ProductionOrderDTO;
}

export async function completeProductionOrder(
  productionOrderId: string,
  input: CompleteProductionOrderInput,
): Promise<ProductionOrderDTO> {
  const response = await apiFetch(`${API_URL}/production-orders/${productionOrderId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ProductionOrderDTO;
}

/**
 * Ampliação explícita da reserva desta OP ("Adicionar consumo extra").
 * Sem `lotCode`, amplia no próprio lote da linha.
 */
export async function addExtraReservation(
  productionOrderId: string,
  reservationLineId: string,
  input: { quantity: string; reason: string; lotCode?: string },
): Promise<ProductionOrderDTO> {
  const response = await apiFetch(
    `${API_URL}/production-orders/${productionOrderId}/picking/${reservationLineId}/extra`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return (await parseJsonOrThrow(response)) as ProductionOrderDTO;
}
