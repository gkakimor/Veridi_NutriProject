import type { DashboardDTO } from "@veridi/shared";
import { API_URL } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/**
 * Read model único do cockpit. O período é sempre enviado explicitamente
 * pelo frontend (limites já resolvidos em ISO) — assim a tela nunca depende
 * silenciosamente do fuso do servidor.
 */
export async function getDashboard(from: string, to: string): Promise<DashboardDTO> {
  const query = new URLSearchParams({ from, to });
  const response = await fetch(`${API_URL}/dashboard?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as DashboardDTO;
}
