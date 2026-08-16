import type {
  ApplyFulfillmentPlanInput,
  CancelCustomerOrderInput,
  CreateCustomerOrderInput,
  CustomerOrderDTO,
  CustomerOrderListResponse,
  CustomerOrderStatus,
  FulfillmentPlanDTO,
  GeneratePurchaseDraftsInput,
  PurchaseSuggestionDTO,
  UpdateCustomerOrderInput,
} from "@veridi/shared";
import { API_URL } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListCustomerOrdersParams {
  search?: string;
  status?: CustomerOrderStatus;
  customerId?: string;
  page?: number;
  pageSize?: number;
}

export async function listCustomerOrders(
  params: ListCustomerOrdersParams = {},
): Promise<CustomerOrderListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.status) query.set("status", params.status);
  if (params.customerId) query.set("customerId", params.customerId);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await fetch(`${API_URL}/customer-orders?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as CustomerOrderListResponse;
}

export async function getCustomerOrder(id: string): Promise<CustomerOrderDTO> {
  const response = await fetch(`${API_URL}/customer-orders/${id}`);
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}

export async function createCustomerOrder(input: CreateCustomerOrderInput): Promise<CustomerOrderDTO> {
  const response = await fetch(`${API_URL}/customer-orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}

export async function updateCustomerOrder(
  id: string,
  input: UpdateCustomerOrderInput,
): Promise<CustomerOrderDTO> {
  const response = await fetch(`${API_URL}/customer-orders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}

export async function confirmCustomerOrder(id: string): Promise<CustomerOrderDTO> {
  const response = await fetch(`${API_URL}/customer-orders/${id}/confirm`, { method: "POST" });
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}

export async function cancelCustomerOrder(
  id: string,
  input: CancelCustomerOrderInput,
): Promise<CustomerOrderDTO> {
  const response = await fetch(`${API_URL}/customer-orders/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}

export async function getFulfillmentPlan(customerOrderId: string): Promise<FulfillmentPlanDTO> {
  const response = await fetch(`${API_URL}/customer-orders/${customerOrderId}/fulfillment-plan`);
  return (await parseJsonOrThrow(response)) as FulfillmentPlanDTO;
}

export async function applyFulfillmentPlan(
  customerOrderId: string,
  input: ApplyFulfillmentPlanInput,
): Promise<CustomerOrderDTO> {
  const response = await fetch(`${API_URL}/customer-orders/${customerOrderId}/apply-fulfillment-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}

export async function getPurchaseSuggestion(customerOrderId: string): Promise<PurchaseSuggestionDTO> {
  const response = await fetch(`${API_URL}/customer-orders/${customerOrderId}/purchase-suggestion`);
  return (await parseJsonOrThrow(response)) as PurchaseSuggestionDTO;
}

export async function generatePurchaseDrafts(
  customerOrderId: string,
  input: GeneratePurchaseDraftsInput,
): Promise<CustomerOrderDTO> {
  const response = await fetch(`${API_URL}/customer-orders/${customerOrderId}/purchase-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}
