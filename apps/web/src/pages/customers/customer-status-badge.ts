import type { CustomerStatus } from "@veridi/shared";

/**
 * Cor da SITUAÇÃO CADASTRAL (§95) — não confundir com a da situação comercial
 * (`commercial-status-badge.ts`, §86), que responde outra pergunta.
 *
 * Bloqueado é aviso: decisão comercial em vigor, que quem vende precisa notar.
 * Inativo é arquivo, no mesmo cinza de todo cadastro arquivado do ERP.
 */
export function customerStatusBadgeClass(status: CustomerStatus): string {
  if (status === "BLOCKED") return "badge badge--warn";
  if (status === "INACTIVE") return "badge badge--inactive";
  return "badge badge--active";
}
