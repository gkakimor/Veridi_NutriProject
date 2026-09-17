import type { UserRole } from "@veridi/shared";
import { USER_ROLE_LABELS } from "@veridi/shared";

/**
 * Uma lista de perfis por extenso, na ordem da constante que a API aplica:
 * "Compras, Qualidade, Produção e Administrador".
 *
 * A frase da tela é lida da MESMA lista do gate — trocar um perfil na
 * constante troca a frase junto, sem redigitar nada.
 */
export function perfisPorExtenso(roles: readonly UserRole[], conjuncao: "e" | "ou"): string {
  const nomes = roles.map((role) => USER_ROLE_LABELS[role]);
  if (nomes.length <= 1) return nomes.join("");
  return `${nomes.slice(0, -1).join(", ")} ${conjuncao} ${nomes[nomes.length - 1]}`;
}

/** O perfil da sessão está na lista? Sem perfil, não. */
export function perfilPermite(
  roles: readonly UserRole[],
  role: UserRole | null | undefined,
): boolean {
  return role !== null && role !== undefined && roles.includes(role);
}
