import type { HealthResponse } from "@veridi/shared";

const API_URL = import.meta.env["VITE_API_URL"] ?? "http://127.0.0.1:3333";

/** Consulta `GET /health` da API. Lanca em falha de rede ou resposta invalida. */
export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${API_URL}/health`);
  return (await response.json()) as HealthResponse;
}

export { API_URL };
