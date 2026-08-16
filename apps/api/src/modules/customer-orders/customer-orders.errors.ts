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
