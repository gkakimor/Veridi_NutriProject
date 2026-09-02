import type {
  BillingDTO,
  CustomerConsultationSummaryDTO,
  CustomerFinishedGoodsResponse,
  CustomerOrderDTO,
  ProductDTO,
  ProjectDTO,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/**
 * Consulta do Cliente — somente leitura.
 *
 * As LISTAS não estão aqui: elas continuam saindo de `projects-api`,
 * `customer-orders-api`, `billings-api` e `customer-materials-api`, que já
 * filtram por `customerId`. Um segundo cliente HTTP para os mesmos dados
 * seria uma segunda verdade.
 *
 * O que existe aqui é o resumo e os DETALHES no escopo do Cliente — as
 * únicas leituras onde o id da rota poderia apontar para outro Cliente.
 */

const base = (customerId: string) =>
  `${API_URL}/customers/${encodeURIComponent(customerId)}/consultation`;

export async function getConsultationSummary(
  customerId: string,
): Promise<CustomerConsultationSummaryDTO> {
  const response = await apiFetch(`${base(customerId)}/summary`);
  return (await parseJsonOrThrow(response)) as CustomerConsultationSummaryDTO;
}

export async function getConsultationProject(
  customerId: string,
  projectId: string,
): Promise<ProjectDTO> {
  const response = await apiFetch(
    `${base(customerId)}/projects/${encodeURIComponent(projectId)}`,
  );
  return (await parseJsonOrThrow(response)) as ProjectDTO;
}

export async function getConsultationOrder(
  customerId: string,
  orderId: string,
): Promise<CustomerOrderDTO> {
  const response = await apiFetch(`${base(customerId)}/orders/${encodeURIComponent(orderId)}`);
  return (await parseJsonOrThrow(response)) as CustomerOrderDTO;
}

export async function getConsultationBilling(
  customerId: string,
  billingId: string,
): Promise<BillingDTO> {
  const response = await apiFetch(
    `${base(customerId)}/billings/${encodeURIComponent(billingId)}`,
  );
  return (await parseJsonOrThrow(response)) as BillingDTO;
}

export async function getConsultationProduct(
  customerId: string,
  productId: string,
): Promise<ProductDTO> {
  const response = await apiFetch(
    `${base(customerId)}/products/${encodeURIComponent(productId)}`,
  );
  return (await parseJsonOrThrow(response)) as ProductDTO;
}

/** Estoque de produto acabado do Cliente — paginado como as demais listas. */
export async function listConsultationFinishedGoods(
  customerId: string,
  params: { page?: number; pageSize?: number } = {},
): Promise<CustomerFinishedGoodsResponse> {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));
  const response = await apiFetch(`${base(customerId)}/finished-goods?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as CustomerFinishedGoodsResponse;
}
