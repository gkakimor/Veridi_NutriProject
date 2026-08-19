export class CustomerOrderNotFoundError extends Error {
  constructor(id: string) {
    super(`Pedido não encontrado: ${id}`);
    this.name = "CustomerOrderNotFoundError";
  }
}

export class CustomerNotFoundError extends Error {
  constructor(id: string) {
    super(`Cliente não encontrado: ${id}`);
    this.name = "CustomerNotFoundError";
  }
}

export class InactiveCustomerError extends Error {
  constructor(id: string) {
    super(`Cliente inativo não pode ser usado em um pedido: ${id}`);
    this.name = "InactiveCustomerError";
  }
}

export class LineProductNotFoundError extends Error {
  constructor(id: string) {
    super(`Produto não encontrado: ${id}`);
    this.name = "LineProductNotFoundError";
  }
}

export class InactiveLineProductError extends Error {
  constructor(id: string) {
    super(`Produto inativo não pode ser usado em uma nova linha: ${id}`);
    this.name = "InactiveLineProductError";
  }
}

export class MissingFinishedItemError extends Error {
  constructor(id: string) {
    super(`Produto precisa de um item de produto acabado válido para entrar em um pedido: ${id}`);
    this.name = "MissingFinishedItemError";
  }
}

export class DuplicateLineProductError extends Error {
  constructor(id: string) {
    super(`Produto duplicado no mesmo pedido: ${id}`);
    this.name = "DuplicateLineProductError";
  }
}

export class EmptyOrderError extends Error {
  constructor() {
    super("Pedido precisa de pelo menos uma linha para ser confirmado");
    this.name = "EmptyOrderError";
  }
}

export class InvalidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

export class OrderLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderLockedError";
  }
}

export class CancellationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CancellationBlockedError";
  }
}

/**
 * Pedido nascido de proposta aceita nao renegocia sozinho.
 *
 * Produto, quantidade e preco vieram de um acordo com o cliente. Deixar
 * alterar aqui faria o Pedido parar de representar o que foi aceito, sem que
 * a proposta registrasse nada — o acordo e a execucao passariam a contar
 * historias diferentes. Mudar exige renegociar: nova versao de orcamento.
 */
export class CommercialOriginLockedError extends Error {
  constructor(quoteCode: string) {
    super(
      `Este pedido veio do orçamento ${quoteCode}: produto e quantidade seguem o que foi acordado. Para mudar, renegocie criando uma nova versão do orçamento.`,
    );
    this.name = "CommercialOriginLockedError";
  }
}
