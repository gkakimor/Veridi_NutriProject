export class ProductNotFoundError extends Error {
  constructor(id: string) {
    super(`Produto não encontrado: ${id}`);
    this.name = "ProductNotFoundError";
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
    super(`Cliente inativo não pode ser associado a um novo produto: ${id}`);
    this.name = "InactiveCustomerError";
  }
}

export class FinishedItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Item de produto acabado não encontrado: ${id}`);
    this.name = "FinishedItemNotFoundError";
  }
}

export class InvalidFinishedItemTypeError extends Error {
  constructor(id: string) {
    super(`Item não é do tipo FINISHED_PRODUCT: ${id}`);
    this.name = "InvalidFinishedItemTypeError";
  }
}

export class InactiveFinishedItemError extends Error {
  constructor(id: string) {
    super(`Item inativo não pode ser associado a um novo produto: ${id}`);
    this.name = "InactiveFinishedItemError";
  }
}

export class DuplicateFinishedItemError extends Error {
  constructor(id: string) {
    super(`Item de produto acabado já associado a outro produto: ${id}`);
    this.name = "DuplicateFinishedItemError";
  }
}
