import type { QuoteVersionDTO } from "@veridi/shared";
import { dataCivilPorExtenso } from "@veridi/shared";

/**
 * O que a lista de versões do Projeto e a página do Orçamento escrevem igual:
 * a cor da situação e a data do documento. Duas telas, uma leitura só.
 */

/** Data do documento (emissão, validade) — dia civil gravado, nunca o fuso de quem lê. */
export function formatQuoteDate(value: string | null): string {
  if (!value) return "—";
  return dataCivilPorExtenso(new Date(value));
}

export function quoteBadgeClass(status: QuoteVersionDTO["status"]): string {
  if (status === "ACCEPTED") return "badge badge--active";
  if (status === "REJECTED") return "badge badge--err";
  if (status === "DRAFT") return "badge badge--warn";
  return "badge badge--neutral";
}
