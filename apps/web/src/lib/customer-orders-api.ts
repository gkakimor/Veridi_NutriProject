import type {
  ApplyFulfillmentPlanInput,
  BulkSelectionDescriptor,
  CancelCustomerOrderInput,
  CreateCustomerOrderInput,
  CustomerOrderDTO,
  CustomerOrderListResponse,
  CustomerOrderSelectionDocumentsResponse,
  CustomerOrderStatus,
  FulfillmentPlanDTO,
  GeneratePurchaseDraftsInput,
  PlanPurchaseSourcingDTO,
  PurchaseSuggestionDTO,
  UpdateCustomerOrderInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";
import { postSelection, postSelectionForFile } from "./bulk-selection-api";

export interface ListCustomerOrdersParams {
  search?: string;
  /**
   * Um status, ou vários — "Em aberto" são quatro. Vários viajam separados
   * por vírgula e o servidor responde com UMA consulta paginada.
   */
  status?: CustomerOrderStatus | CustomerOrderStatus[];
  customerId?: string;
  page?: number;
  pageSize?: number;
}

export async function listCustomerOrders(
  params: ListCustomerOrdersParams = {},
): Promise<CustomerOrderListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  const status = Array.isArray(params.status) ? params.status.join(",") : params.status;
  if (status) query.set("status", status);
  if (params.customerId) query.set("customerId", params.customerId);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/customer-orders?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as CustomerOrderListResponse;
}

export async function getCustomerOrder(id: string): Promise<CustomerOrderDTO> {
  const response = await apiFetch(`${API_URL}/customer-orders/${id}`);
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}

export async function createCustomerOrder(input: CreateCustomerOrderInput): Promise<CustomerOrderDTO> {
  const response = await apiFetch(`${API_URL}/customer-orders`, {
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
  const response = await apiFetch(`${API_URL}/customer-orders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}

export async function confirmCustomerOrder(id: string): Promise<CustomerOrderDTO> {
  const response = await apiFetch(`${API_URL}/customer-orders/${id}/confirm`, { method: "POST" });
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}

export async function cancelCustomerOrder(
  id: string,
  input: CancelCustomerOrderInput,
): Promise<CustomerOrderDTO> {
  const response = await apiFetch(`${API_URL}/customer-orders/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}

export async function getFulfillmentPlan(customerOrderId: string): Promise<FulfillmentPlanDTO> {
  const response = await apiFetch(`${API_URL}/customer-orders/${customerOrderId}/fulfillment-plan`);
  return (await parseJsonOrThrow(response)) as FulfillmentPlanDTO;
}

export async function applyFulfillmentPlan(
  customerOrderId: string,
  input: ApplyFulfillmentPlanInput,
): Promise<CustomerOrderDTO> {
  const response = await apiFetch(`${API_URL}/customer-orders/${customerOrderId}/apply-fulfillment-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}

export async function getPurchaseSuggestion(customerOrderId: string): Promise<PurchaseSuggestionDTO> {
  const response = await apiFetch(`${API_URL}/customer-orders/${customerOrderId}/purchase-suggestion`);
  return (await parseJsonOrThrow(response)) as PurchaseSuggestionDTO;
}

/** Sourcing na fase de Plano — antes de existir OP. */
export async function getPlanPurchaseSourcing(
  customerOrderId: string,
): Promise<PlanPurchaseSourcingDTO> {
  const response = await apiFetch(
    `${API_URL}/customer-orders/${customerOrderId}/plan-purchase-sourcing`,
  );
  return (await parseJsonOrThrow(response)) as PlanPurchaseSourcingDTO;
}

export async function generatePurchaseDrafts(
  customerOrderId: string,
  input: GeneratePurchaseDraftsInput,
): Promise<CustomerOrderDTO> {
  const response = await apiFetch(`${API_URL}/customer-orders/${customerOrderId}/purchase-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}

/**
 * Ordem de produção para o saldo que ainda falta produzir de uma linha.
 * Sem `quantity`, usa o pendente inteiro.
 */
export async function createRemainderProductionOrder(
  customerOrderId: string,
  input: { customerOrderLineId: string; quantity?: string },
): Promise<CustomerOrderDTO> {
  const response = await apiFetch(
    `${API_URL}/customer-orders/${customerOrderId}/remainder-production-order`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}

/** Os filtros da listagem de Pedidos, sem paginação — o recorte da seleção em massa. */
export type CustomerOrderListFilters = Omit<ListCustomerOrdersParams, "page" | "pageSize">;

/** Os Pedidos da seleção, já resolvidos no servidor, para o PDF único (BULK-DOCUMENTS-01). */
export function getCustomerOrderSelectionDocuments(
  selection: BulkSelectionDescriptor<CustomerOrderListFilters>,
): Promise<CustomerOrderSelectionDocumentsResponse> {
  return postSelection(`/customer-orders/bulk/documents`, selection);
}

/** O CSV da seleção, montado no servidor com as colunas da exportação de Pedidos. */
export function exportCustomerOrderSelectionCsv(
  selection: BulkSelectionDescriptor<CustomerOrderListFilters>,
): Promise<{ blob: Blob; fileName: string }> {
  return postSelectionForFile(`/customer-orders/bulk/export.csv`, selection, "pedidos-selecionados.csv");
}
