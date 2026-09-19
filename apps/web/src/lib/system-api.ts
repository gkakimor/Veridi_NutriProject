import type { SystemMetaDTO } from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/** `GET /meta` — versão, ambiente e commit do sistema no ar ("Sobre o sistema"). */
export async function fetchSystemMeta(): Promise<SystemMetaDTO> {
  const response = await apiFetch(`${API_URL}/meta`);
  return (await parseJsonOrThrow(response)) as SystemMetaDTO;
}
