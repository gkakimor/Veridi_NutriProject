export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Projeto não encontrado: ${id}`);
    this.name = "ProjectNotFoundError";
  }
}

/** Projeto aprovado/cancelado é histórico comercial — não se reescreve. */
export class ProjectLockedError extends Error {
  constructor(status: string) {
    super(`Projeto ${status === "APPROVED" ? "aprovado" : "cancelado"} é somente leitura.`);
    this.name = "ProjectLockedError";
  }
}

export class InvalidStatusTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Transição de status não permitida: ${from} → ${to}.`);
    this.name = "InvalidStatusTransitionError";
  }
}

export class MissingCancelDetailsError extends Error {
  constructor() {
    super('Descreva o motivo quando o cancelamento for "Outro".');
    this.name = "MissingCancelDetailsError";
  }
}

/** Trocar o cliente depois de uma proposta formal reescreveria história. */
export class CustomerLockedError extends Error {
  constructor() {
    super("Este projeto já tem orçamento formalizado — o cliente não pode ser alterado.");
    this.name = "CustomerLockedError";
  }
}

export class MissingAcceptedQuoteError extends Error {
  constructor() {
    super("Selecione/aceite uma versão de orçamento antes de aprovar o projeto.");
    this.name = "MissingAcceptedQuoteError";
  }
}

/** Sem unidade coerente para o produto acabado, nada é inventado. */
export class MissingFinishedUnitError extends Error {
  constructor() {
    super("Informe a unidade do produto acabado para aprovar o projeto.");
    this.name = "MissingFinishedUnitError";
  }
}

export class QuoteNotFoundError extends Error {
  constructor(id: string) {
    super(`Orçamento não encontrado: ${id}`);
    this.name = "QuoteNotFoundError";
  }
}

export class QuoteNotDraftError extends Error {
  constructor(status: string) {
    super(`Orçamento ${status} é somente leitura — crie uma nova versão para renegociar.`);
    this.name = "QuoteNotDraftError";
  }
}

export class QuoteNotSentError extends Error {
  constructor(status: string) {
    super(`Somente orçamento enviado pode ser aceito ou recusado (atual: ${status}).`);
    this.name = "QuoteNotSentError";
  }
}

export class IncompleteQuoteError extends Error {
  constructor() {
    super("Informe quantidade, unidade e preço unitário antes de marcar como enviado.");
    this.name = "IncompleteQuoteError";
  }
}

export class QuoteLineNotFoundError extends Error {
  constructor(id: string) {
    super(`Linha de orçamento ${id} não encontrada.`);
    this.name = "QuoteLineNotFoundError";
  }
}

export class QuoteLineDuplicateError extends Error {
  /**
   * Recebe o CÓDIGO do produto, não o id.
   *
   * A mensagem é lida por quem negocia: "PROD-000006 já está nesta proposta"
   * é uma frase; um UUID no meio dela é ruído que não ajuda ninguém a
   * decidir o que fazer.
   */
  constructor(productCode: string) {
    super(
      `Produto ${productCode} já está nesta proposta. Ajuste a linha existente em vez de criar outra.`,
    );
    this.name = "QuoteLineDuplicateError";
  }
}

export class QuoteLineProductNotInProjectError extends Error {
  constructor(projectProductId: string) {
    super(
      `Produto ${projectProductId} não pertence a este projeto. A proposta é da negociação: produto de fora entraria como vínculo inventado.`,
    );
    this.name = "QuoteLineProductNotInProjectError";
  }
}

export class ProjectProductNotFoundError extends Error {
  constructor(id: string) {
    super(`Produto do projeto ${id} não encontrado.`);
    this.name = "ProjectProductNotFoundError";
  }
}

export class ProjectProductDuplicateError extends Error {
  constructor(productCode: string) {
    super(`O produto ${productCode} já está neste projeto.`);
    this.name = "ProjectProductDuplicateError";
  }
}

export class ProjectProductCustomerMismatchError extends Error {
  constructor() {
    super(
      "Este produto pertence a outro cliente. Vincular seria misturar propriedade de clientes diferentes.",
    );
    this.name = "ProjectProductCustomerMismatchError";
  }
}

/**
 * Gerar Pedido a partir de proposta que o cliente não aceitou seria inventar
 * um acordo. Enquanto a negociação corre, não há o que executar.
 */
export class QuoteNotAcceptedForOrderError extends Error {
  constructor(status: string) {
    super(
      `Só uma proposta aceita gera pedido. Esta versão está em "${status}" — registre o aceite do cliente antes.`,
    );
    this.name = "QuoteNotAcceptedForOrderError";
  }
}

/**
 * O produto técnico do projeto não é operacional até a aprovação. Gerar o
 * Pedido antes contornaria `Product.lifecycle` pela porta dos fundos.
 */
export class ProjectNotApprovedForOrderError extends Error {
  constructor(status: string) {
    super(
      `O orçamento foi aceito, mas o projeto ainda está em "${status}". Aprove o projeto para liberar os produtos e então gere o pedido.`,
    );
    this.name = "ProjectNotApprovedForOrderError";
  }
}

/** Proposta sem linha precificada não descreve nenhum acordo executável. */
export class QuoteWithoutOrderableLinesError extends Error {
  constructor() {
    super(
      "A proposta aceita não tem nenhuma linha com produto e preço para gerar pedido.",
    );
    this.name = "QuoteWithoutOrderableLinesError";
  }
}

/**
 * A unidade da proposta e a do produto acabado precisam ser a mesma.
 *
 * Converter aqui mudaria a quantidade sem mudar o preço unitário acordado, e
 * o Pedido deixaria de representar o que o cliente aceitou.
 */
export class QuoteOrderUomMismatchError extends Error {
  constructor(productCode: string, quoteUom: string, productUom: string) {
    super(
      `${productCode}: a proposta está em "${quoteUom}" e o produto acabado é medido em "${productUom}". Alinhe a unidade antes de gerar o pedido.`,
    );
    this.name = "QuoteOrderUomMismatchError";
  }
}
