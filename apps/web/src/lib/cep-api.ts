import { normalizeZipCode } from "@veridi/shared";

/**
 * Consulta de CEP no ViaCEP.
 *
 * Deliberadamente pequeno: uma função, sem cache, sem cadeia de provedores e
 * sem fila de retentativa. Preenchimento de endereço é conveniência — a falha
 * do serviço externo **nunca** pode impedir um cadastro, então todo caminho de
 * erro termina em "preencha manualmente", jamais em exceção que sobe para a
 * tela.
 */

export interface CepAddress {
  street: string;
  district: string;
  city: string;
  state: string;
}

export type CepLookupResult =
  | { status: "found"; address: CepAddress }
  /** CEP bem formado que não existe na base. */
  | { status: "not_found" }
  /** Rede, timeout, 5xx, resposta ilegível — indistinguíveis para o operador. */
  | { status: "unavailable" };

const VIACEP_URL = "https://viacep.com.br/ws";
const TIMEOUT_MS = 5000;

interface ViaCepResponse {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean | string;
}

/** `true` quando o CEP tem os 8 dígitos — só então vale consultar. */
export function isCompleteZipCode(raw: string): boolean {
  return normalizeZipCode(raw).length === 8;
}

export async function lookupCep(raw: string): Promise<CepLookupResult> {
  const digits = normalizeZipCode(raw);
  if (digits.length !== 8) return { status: "not_found" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${VIACEP_URL}/${digits}/json/`, {
      signal: controller.signal,
    });
    if (!response.ok) return { status: "unavailable" };

    const data = (await response.json()) as ViaCepResponse;
    // ViaCEP responde 200 com `{ "erro": true }` para CEP inexistente.
    if (data.erro === true || data.erro === "true") return { status: "not_found" };
    if (!data.localidade || !data.uf) return { status: "not_found" };

    return {
      status: "found",
      address: {
        street: data.logradouro ?? "",
        district: data.bairro ?? "",
        city: data.localidade,
        state: data.uf.toUpperCase(),
      },
    };
  } catch {
    // AbortError, falha de rede, JSON inválido — o operador não precisa
    // distinguir: em todos os casos ele digita o endereço.
    return { status: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}
