import type { ProductCmvResponse } from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/**
 * CMV do produto — uma leitura, nenhum cálculo no cliente.
 *
 * `quantity` e `referenceDate` vão sempre explícitas: quem pergunta precisa
 * dizer de qual quantidade e de qual dia está falando, e a resposta devolve
 * a mesma data para a tela poder repetir sobre o que ela fala.
 */
export async function getProductCmv(
  productId: string,
  params: { quantity: string; referenceDate: string },
): Promise<ProductCmvResponse> {
  const query = new URLSearchParams({
    quantity: params.quantity,
    referenceDate: params.referenceDate,
  });
  const response = await apiFetch(`${API_URL}/products/${productId}/cmv?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as ProductCmvResponse;
}
