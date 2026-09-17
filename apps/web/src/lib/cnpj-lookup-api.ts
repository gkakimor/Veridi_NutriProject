import type { CnpjLookupProvider, CnpjLookupResult } from "@veridi/shared";
import {
  CNPJ_LOOKUP_UNAVAILABLE_MESSAGE,
  CNPJ_NOT_FOUND_ERROR,
  CNPJ_NOT_FOUND_MESSAGE,
  normalizeCnpj,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";

/**
 * Consulta assistida de CNPJ — CUSTOMER-CNPJ-LOOKUP-01.
 *
 * A chamada vai para a API do Veridi, NUNCA direto ao provedor: quem fala com
 * a fonte externa é o servidor, que valida o CNPJ, escolhe o provedor no
 * registro conhecido, aplica timeout e teto de tamanho, e devolve um contrato
 * normalizado. A tela não conhece endpoint, payload nem erro do provedor.
 *
 * Como `lookupCep`, esta função NÃO lança: preenchimento assistido é
 * conveniência, e falha de serviço externo jamais pode derrubar o cadastro
 * manual. Todo caminho de erro termina em um desfecho que a tela sabe
 * mostrar — e em "continue preenchendo à mão".
 */
export type CnpjLookupOutcome =
  | { status: "found"; result: CnpjLookupResult }
  /** A fonte respondeu e não conhece este CNPJ. */
  | { status: "not_found"; message: string }
  /** Timeout, provedor fora do ar, limite de uso, resposta ilegível, sessão recusada. */
  | { status: "unavailable"; message: string };

export async function lookupCnpj(
  cnpj: string,
  provider: CnpjLookupProvider,
): Promise<CnpjLookupOutcome> {
  const normalizado = normalizeCnpj(cnpj);
  const query = new URLSearchParams({ provider });

  try {
    const response = await apiFetch(
      `${API_URL}/cnpj-lookup/${encodeURIComponent(normalizado)}?${query.toString()}`,
    );
    const body: unknown = await response.json().catch(() => null);

    if (response.ok) {
      // Resposta 200 sem o contrato esperado é tão inútil quanto um 500.
      if (body !== null && typeof body === "object" && "company" in body) {
        return { status: "found", result: body as CnpjLookupResult };
      }
      return { status: "unavailable", message: CNPJ_LOOKUP_UNAVAILABLE_MESSAGE };
    }

    const erro = (body ?? {}) as { error?: unknown; message?: unknown };
    const mensagem = typeof erro.message === "string" && erro.message ? erro.message : null;

    if (response.status === 404 || erro.error === CNPJ_NOT_FOUND_ERROR) {
      return { status: "not_found", message: mensagem ?? CNPJ_NOT_FOUND_MESSAGE };
    }
    return { status: "unavailable", message: mensagem ?? CNPJ_LOOKUP_UNAVAILABLE_MESSAGE };
  } catch {
    // A requisição não chegou ao servidor: rede caída, API fora do ar.
    return { status: "unavailable", message: CNPJ_LOOKUP_UNAVAILABLE_MESSAGE };
  }
}
