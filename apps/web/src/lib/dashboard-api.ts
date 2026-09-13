import type { DashboardDTO } from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/**
 * Read model único do cockpit. O período vai como dois DIAS (`YYYY-MM-DD`,
 * `lib/period.ts`) e o servidor os abre no dia comercial — a tela não depende
 * do fuso do navegador, e a consulta não depende do fuso do servidor.
 */
export async function getDashboard(from: string, to: string): Promise<DashboardDTO> {
  const query = new URLSearchParams({ from, to });
  const response = await apiFetch(`${API_URL}/dashboard?${query.toString()}`);
  return (await parseJsonOrThrow(response)) as DashboardDTO;
}
