import type {
  CancelPurchaseOrderInput,
  CreatePurchaseOrderInput,
  PurchaseOrderDTO,
  PurchaseOrderListResponse,
  PurchaseOrderStatus,
  UpdatePurchaseOrderInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListPurchaseOrdersParams {
  search?: string;
  supplierId?: string;
  /**
   * Um status, ou vários — "Em aberto" são três. Vários viajam separados por
   * vírgula e o servidor responde com UMA consulta paginada.
   */
  status?: PurchaseOrderStatus | PurchaseOrderStatus[];
  /**
   * Só OC que pode receber material agora. Quais status recebem é o servidor
   * quem diz — a mesma regra que ele aplica ao gravar o recebimento.
   */
  receivable?: boolean;
  /** Data do pedido, dia civil `YYYY-MM-DD` — nunca instante. */
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export async function listPurchaseOrders(
  params: ListPurchaseOrdersParams = {},
): Promise<PurchaseOrderListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.supplierId) query.set("supplierId", params.supplierId);
  const status = Array.isArray(params.status) ? params.status.join(",") : params.status;
  if (status) query.set("status", status);
  if (params.receivable) query.set("receivable", "true");
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/purchase-orders?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as PurchaseOrderListResponse;
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrderDTO> {
  const response = await apiFetch(`${API_URL}/purchase-orders/${id}`);
  return (await parseJsonOrThrow(response)) as PurchaseOrderDTO;
}

export async function createPurchaseOrder(
  input: CreatePurchaseOrderInput,
): Promise<PurchaseOrderDTO> {
  const response = await apiFetch(`${API_URL}/purchase-orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as PurchaseOrderDTO;
}

export async function updatePurchaseOrder(
  id: string,
  input: UpdatePurchaseOrderInput,
): Promise<PurchaseOrderDTO> {
  const response = await apiFetch(`${API_URL}/purchase-orders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as PurchaseOrderDTO;
}

export async function confirmPurchaseOrder(id: string): Promise<PurchaseOrderDTO> {
  const response = await apiFetch(`${API_URL}/purchase-orders/${id}/confirm`, {
    method: "POST",
  });
  return (await parseJsonOrThrow(response)) as PurchaseOrderDTO;
}

export async function cancelPurchaseOrder(
  id: string,
  input: CancelPurchaseOrderInput,
): Promise<PurchaseOrderDTO> {
  const response = await apiFetch(`${API_URL}/purchase-orders/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as PurchaseOrderDTO;
}
