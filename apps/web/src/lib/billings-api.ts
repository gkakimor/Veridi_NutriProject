import type {
  AwaitingBillingListResponse,
  BillingDTO,
  BillingListResponse,
  BillingStatus,
  CancelBillingInput,
  UpdateBillingInput,
} from "@veridi/shared";
import { API_URL } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListBillingsParams {
  search?: string;
  customerOrderId?: string;
  shipmentId?: string;
  status?: BillingStatus;
  page?: number;
  pageSize?: number;
}

export async function listBillings(params: ListBillingsParams = {}): Promise<BillingListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.customerOrderId) query.set("customerOrderId", params.customerOrderId);
  if (params.shipmentId) query.set("shipmentId", params.shipmentId);
  if (params.status) query.set("status", params.status);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await fetch(`${API_URL}/billings?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as BillingListResponse;
}

/** Expedições CONFIRMED sem faturamento emitido (inclui as com rascunho). */
export async function listAwaitingBilling(): Promise<AwaitingBillingListResponse> {
  const response = await fetch(`${API_URL}/billings/awaiting`);
  return (await parseJsonOrThrow(response)) as AwaitingBillingListResponse;
}

export async function getBilling(id: string): Promise<BillingDTO> {
  const response = await fetch(`${API_URL}/billings/${id}`);
  return (await parseJsonOrThrow(response)) as BillingDTO;
}

export async function createBilling(shipmentId: string): Promise<BillingDTO> {
  const response = await fetch(`${API_URL}/billings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shipmentId }),
  });
  return (await parseJsonOrThrow(response)) as BillingDTO;
}

export async function updateBilling(id: string, input: UpdateBillingInput): Promise<BillingDTO> {
  const response = await fetch(`${API_URL}/billings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as BillingDTO;
}

export async function issueBilling(id: string): Promise<BillingDTO> {
  const response = await fetch(`${API_URL}/billings/${id}/issue`, { method: "POST" });
  return (await parseJsonOrThrow(response)) as BillingDTO;
}

export async function cancelBilling(id: string, input: CancelBillingInput): Promise<BillingDTO> {
  const response = await fetch(`${API_URL}/billings/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as BillingDTO;
}
