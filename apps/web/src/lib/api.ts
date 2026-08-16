import type { HealthResponse } from "@veridi/shared";

const API_URL = import.meta.env["VITE_API_URL"] ?? "http://127.0.0.1:3333";

/**
 * Toda chamada à API passa por aqui.
 *
 * A sessão vive em cookie HttpOnly, então `credentials: "include"` é
 * obrigatório — centralizado para não depender de cada arquivo lembrar.
 * Um 401 dispara um evento único que o AppShell escuta para levar o
 * usuário de volta ao Login, em vez de cada tela tratar do seu jeito.
 */
export const UNAUTHENTICATED_EVENT = "veridi:unauthenticated";

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, { ...init, credentials: "include" });
  if (response.status === 401 && !input.includes("/auth/")) {
    window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT));
  }
  return response;
}

/** Consulta `GET /health` da API. Lanca em falha de rede ou resposta invalida. */
export async function fetchHealth(): Promise<HealthResponse> {
  const response = await apiFetch(`${API_URL}/health`);
  return (await response.json()) as HealthResponse;
}

export { API_URL };
