import type {
  CreateCustomerSuppliedReceiptInput,
  CreateReceiptInput,
  ReceiptDTO,
  ReceiptListResponse,
  ReceiptSourceType,
} from "@veridi/shared";
import { API_URL } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListReceiptsParams {
  search?: string;
  purchaseOrderId?: string;
  supplierId?: string;
  sourceType?: ReceiptSourceType;
  customerId?: string;
  page?: number;
  pageSize?: number;
}

export async function listReceipts(
  params: ListReceiptsParams = {},
): Promise<ReceiptListResponse> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.purchaseOrderId) query.set("purchaseOrderId", params.purchaseOrderId);
  if (params.supplierId) query.set("supplierId", params.supplierId);
  if (params.sourceType) query.set("sourceType", params.sourceType);
  if (params.customerId) query.set("customerId", params.customerId);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));

  const response = await fetch(`${API_URL}/receipts?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as ReceiptListResponse;
}

export async function getReceipt(id: string): Promise<ReceiptDTO> {
  const response = await fetch(`${API_URL}/receipts/${id}`);
  return (await parseJsonOrThrow(response)) as ReceiptDTO;
}

export async function createReceipt(
  purchaseOrderId: string,
  input: CreateReceiptInput,
): Promise<ReceiptDTO> {
  const response = await fetch(`${API_URL}/purchase-orders/${purchaseOrderId}/receipts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ReceiptDTO;
}

/** Recebimento de material enviado pelo cliente — sem Ordem de Compra. */
export async function createCustomerSuppliedReceipt(
  input: CreateCustomerSuppliedReceiptInput,
): Promise<ReceiptDTO> {
  const response = await fetch(`${API_URL}/receipts/customer-supplied`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await parseJsonOrThrow(response)) as ReceiptDTO;
}
