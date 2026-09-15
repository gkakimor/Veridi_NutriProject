import type {
  CreateCustomerInput,
  CustomerCommercialStatus,
  CustomerDTO,
  CustomerListResponse,
  CustomerStatus,
  CustomerStatusAction,
  UpdateCustomerInput,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListCustomersParams {
  /** Conjunto explícito de ids — link contextual e exportação da seleção. */
  ids?: string[];
  search?: string;
  state?: string;
  active?: boolean;
  /**
   * Situação cadastral (§95), uma ou mais. Ausente: todas. Quem vende pede
   * só `ACTIVE`; cadastro e material do cliente aceitam também o bloqueado.
   */
  status?: CustomerStatus[];
  /** Situação comercial derivada (§86). Ausente: todas. */
  commercialStatus?: CustomerCommercialStatus;
  page?: number;
  pageSize?: number;
}

export async function listCustomers(
  params: ListCustomersParams = {},
): Promise<CustomerListResponse> {
  const query = new URLSearchParams();
  if (params.ids && params.ids.length > 0) query.set("ids", params.ids.join(","));
  if (params.search) query.set("search", params.search);
  if (params.state) query.set("state", params.state);
  if (params.active !== undefined) query.set("active", String(params.active));
  if (params.status && params.status.length > 0) query.set("status", params.status.join(","));
  if (params.commercialStatus) query.set("commercialStatus", params.commercialStatus);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/customers?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as CustomerListResponse;
}

export async function createCustomer(
  input: CreateCustomerInput,
): Promise<CustomerDTO> {
  const response = await apiFetch(`${API_URL}/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerDTO;
}

export async function updateCustomer(
  id: string,
  input: UpdateCustomerInput,
): Promise<CustomerDTO> {
  const response = await apiFetch(`${API_URL}/customers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as CustomerDTO;
}

const CAMINHO_DA_ACAO: Record<CustomerStatusAction, string> = {
  BLOCK: "block",
  UNBLOCK: "unblock",
  DEACTIVATE: "deactivate",
  ACTIVATE: "activate",
};

/**
 * As quatro ações de situação cadastral (§95). Mesmo corpo — o motivo, sempre
 * obrigatório —, e a resposta é o cliente já na situação nova.
 */
export async function changeCustomerStatus(
  id: string,
  action: CustomerStatusAction,
  reason: string,
): Promise<CustomerDTO> {
  const response = await apiFetch(`${API_URL}/customers/${id}/${CAMINHO_DA_ACAO[action]}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  return (await parseJsonOrThrow(response)) as CustomerDTO;
}
