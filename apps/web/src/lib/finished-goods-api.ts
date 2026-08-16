import type { FinishedGoodsListResponse, LotStatus } from "@veridi/shared";
import { API_URL } from "./api";
import { parseJsonOrThrow } from "./api-errors";

export interface ListFinishedGoodsParams {
  search?: string;
  status?: LotStatus;
  productId?: string;
  productionOrderId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Consulta somente leitura dos lotes efetivamente produzidos. Não existe
 * criação de produto acabado por aqui — ele nasce apenas de uma Ordem de
 * Produção com apontamento.
 */
export async function listFinishedGoods(
  params: ListFinishedGoodsParams = {},
): Promise<FinishedGoodsListResponse> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetch(`${API_URL}/finished-goods${suffix}`);
  return (await parseJsonOrThrow(response)) as FinishedGoodsListResponse;
}
