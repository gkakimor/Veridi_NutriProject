import type { CustomerCommercialStatus } from "@veridi/shared";

/**
 * O badge da situação comercial (§86) — o mesmo na lista e na Consulta.
 *
 * Classes do design system que já existem; nenhuma cor nova. Prospect é
 * atenção (relacionamento em formação), Inativo é neutro — não é erro, é só
 * ninguém ter oportunidade aberta.
 */
export function commercialStatusBadgeClass(status: CustomerCommercialStatus): string {
  if (status === "ACTIVE") return "badge badge--active";
  if (status === "PROSPECT") return "badge badge--warn";
  return "badge badge--neutral";
}
