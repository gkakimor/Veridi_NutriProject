import type { CustomerMaterialsResponse, LotStatus } from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListCustomerMaterialsParams {
  search?: string;
  customerId?: string;
  itemId?: string;
  status?: LotStatus;
  onlyWithBalance?: boolean;
  page?: number;
  pageSize?: number;
}

/** Estoque → Materiais de Clientes: read model, nunca uma segunda fonte de saldo. */
export async function listCustomerMaterials(
  params: ListCustomerMaterialsParams = {},
): Promise<CustomerMaterialsResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.customerId) query.set("customerId", params.customerId);
  if (params.itemId) query.set("itemId", params.itemId);
  if (params.status) query.set("status", params.status);
  if (params.onlyWithBalance) query.set("onlyWithBalance", "true");
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await apiFetch(`${API_URL}/inventory/customer-materials?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as CustomerMaterialsResponse;
}
