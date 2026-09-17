/**
 * Produto inativo não inicia compromisso novo — PRODUCT-INACTIVE-COMMERCIAL-GATE-01,
 * `PRODUCT_RULES.md` §108 (decisões D6 e D7 do PO).
 *
 * Inativar o Produto tira-o de escolha NOVA: vínculo a Projeto, linha e envio de
 * Orçamento, aceite, aprovação do Projeto, geração de Pedido, Amostra e a
 * liberação da OP planejada. O que já existe continua como está — rascunho abre,
 * proposta enviada e Pedido gerado seguem no histórico, OP liberada segue
 * executando — e nada é cancelado por causa da inativação.
 *
 * Produto e item de produto acabado NÃO têm cascata (§100: perfis diferentes
 * inativam um e outro). Por isso a recusa do PA inativo é própria: o item existe,
 * e dizer "sem produto acabado" mandaria quem lê procurar um cadastro que está lá.
 *
 * A decisão é do backend, no momento da ação: a tela pode ter aberto antes da
 * inativação. Custos, precificação, CMV, formulação e roteiro padrão não passam
 * por aqui.
 */

export interface SituacaoDoProduto {
  code: string;
  active: boolean;
}

/**
 * Um ou mais produtos inativos na ação. A orientação diz o que destrava AQUI —
 * enviar pode retirar a linha, aceitar não pode —, por isso vem de quem chama.
 */
export class ProductInactiveError extends Error {
  readonly productCodes: readonly string[];

  constructor(productCodes: readonly string[], orientacao: string) {
    const lista = productCodes.join(", ");
    super(
      productCodes.length === 1
        ? `Produto ${lista} está inativo. ${orientacao}`
        : `Produtos ${lista} estão inativos. ${orientacao}`,
    );
    this.name = "ProductInactiveError";
    this.productCodes = productCodes;
  }
}

/** O item de produto acabado EXISTE e está inativo — nunca "sem produto acabado". */
export class FinishedItemInactiveError extends Error {
  constructor(productCode: string, itemCode: string, orientacao: string) {
    super(
      `O item de produto acabado ${itemCode} do produto ${productCode} está inativo. ${orientacao}`,
    );
    this.name = "FinishedItemInactiveError";
  }
}

/**
 * Recusa se algum produto estiver inativo, nomeando TODOS de uma vez — a proposta
 * com três linhas não obriga a descobrir o segundo inativo só depois de
 * regularizar o primeiro. Códigos repetidos aparecem uma vez, na ordem das linhas.
 */
export function assertProductsActive(
  produtos: readonly SituacaoDoProduto[],
  orientacao: string,
): void {
  const inativos = [
    ...new Set(produtos.filter((produto) => !produto.active).map((produto) => produto.code)),
  ];
  if (inativos.length > 0) throw new ProductInactiveError(inativos, orientacao);
}

/** Item de produto acabado presente e inativo recusa; ausente é outra recusa, de quem chama. */
export function assertFinishedItemActive(
  productCode: string,
  item: SituacaoDoProduto | null,
  orientacao: string,
): void {
  if (item && !item.active) throw new FinishedItemInactiveError(productCode, item.code, orientacao);
}
