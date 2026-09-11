import type { UpdateUserPreferencesInput, UserPreferencesDTO } from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/** Preferências de interface do usuário da SESSÃO — nunca de outra pessoa. */
export async function fetchUserPreferences(): Promise<UserPreferencesDTO> {
  const response = await apiFetch(`${API_URL}/me/preferences`);
  return (await parseJsonOrThrow(response)) as UserPreferencesDTO;
}

/**
 * PATCH parcial. `keepalive` deixa a última gravação sair mesmo com a aba
 * fechando — o caso de quem recolhe o menu e fecha o navegador em seguida.
 */
export async function updateUserPreferences(
  input: UpdateUserPreferencesInput,
  options: { keepalive?: boolean } = {},
): Promise<UserPreferencesDTO> {
  const response = await apiFetch(`${API_URL}/me/preferences`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    keepalive: options.keepalive ?? false,
  });
  return (await parseJsonOrThrow(response)) as UserPreferencesDTO;
}
