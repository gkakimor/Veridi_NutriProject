import type { SupplierItemDTO } from "@veridi/shared";

/**
 * Item ou fornecedor inativo na relação, do lado da tela —
 * SUPPLIER-ITEM-INACTIVE-GATE-01, `PRODUCT_RULES.md` §112.
 *
 * A autoridade é a API: criar, reativar, homologar, preferencial e oferta são
 * 400 `inactive_reference` com qualquer parte inativa. Aqui a MESMA condição
 * decide só o que a tela oferece, e a frase diz o que reativar — botão
 * desabilitado sem motivo manda a pessoa procurar culpa na homologação, que
 * está em ordem.
 *
 * Três situações distintas e visíveis juntas: o item, o fornecedor e a relação
 * (`active`). Parte inativa não apaga nada: a relação, as ofertas e o histórico
 * de homologação continuam à vista, e bloquear, voltar para pendente e inativar
 * a relação seguem oferecidos.
 */

export type ParteInativa = "item" | "supplier";

/**
 * Qual parte está inativa, ou `null` com as duas ativas. O item vem primeiro
 * com as duas inativas: é por ele que o caminho de volta começa, e é o que a
 * API responde.
 */
export function parteInativaDaRelacao(
  relacao: Pick<SupplierItemDTO, "itemActive" | "supplierActive">,
): ParteInativa | null {
  if (!relacao.itemActive) return "item";
  if (!relacao.supplierActive) return "supplier";
  return null;
}

/** "Item inativo" / "Fornecedor inativo" — o mesmo rótulo da marca e do aviso. */
export const ROTULO_DA_PARTE_INATIVA: Record<ParteInativa, string> = {
  item: "Item inativo",
  supplier: "Fornecedor inativo",
};

/**
 * O que a parte inativa impede e o que ela não impede, na ordem em que importa:
 * primeiro que nada foi perdido, depois o que volta com a reativação.
 */
export function avisoDaParteInativa(parte: ParteInativa): string {
  const cadastro = parte === "item" ? "o item" : "o fornecedor";
  return `${ROTULO_DA_PARTE_INATIVA[parte]}: a relação continua à vista, com as ofertas e o histórico de homologação. Reativar a relação, homologar, definir o preferencial e registrar oferta voltam quando ${cadastro} for reativado. Bloquear, voltar para pendente e inativar a relação seguem disponíveis.`;
}
