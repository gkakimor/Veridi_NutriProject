import { entityHref } from "../components/EntityLink";
import { rotaComRetorno } from "./contextual-create";

/**
 * O endereço de uma versão de orçamento — QUOTE-WORKSPACE-NAVIGATION-01.
 *
 * Orçamento é documento com página própria: `/comercial/orcamentos/:id`, com o
 * id da VERSÃO. Todo caminho que abre um orçamento chega a esta mesma rota — a
 * lista do Projeto, a origem comercial do Pedido, a volta do CMV e, quando
 * existir, a lista geral de Orçamentos (QUOTES-HUB-01). Cada um só acrescenta o
 * que é seu:
 *
 * - `linha`: a linha que a página traz à vista (volta do CMV);
 * - `voltar`: a tela de onde se saiu, para o "← Voltar" explícito da página —
 *   o mesmo parâmetro e a mesma guarda de rota interna do retorno de cadastro.
 */

/** A linha da proposta que a página destaca e traz à vista. */
export const PARAM_LINHA_DO_ORCAMENTO = "quoteLineId";

export function rotaDoOrcamento(
  quoteVersionId: string,
  opcoes: { linha?: string | null; voltar?: string | null } = {},
): string {
  const destino = entityHref("quoteVersion", quoteVersionId);
  const comLinha = opcoes.linha
    ? `${destino}?${PARAM_LINHA_DO_ORCAMENTO}=${encodeURIComponent(opcoes.linha)}`
    : destino;
  return opcoes.voltar ? rotaComRetorno(comLinha, opcoes.voltar) : comLinha;
}
