export class PurchaseOrderNotFoundError extends Error {
  constructor(id: string) {
    super(`Ordem de compra não encontrada: ${id}`);
    this.name = "PurchaseOrderNotFoundError";
  }
}

export class SupplierNotFoundError extends Error {
  constructor(id: string) {
    super(`Fornecedor não encontrado: ${id}`);
    this.name = "SupplierNotFoundError";
  }
}

export class InactiveSupplierError extends Error {
  constructor(id: string) {
    super(`Fornecedor inativo não pode ser usado em uma ordem de compra: ${id}`);
    this.name = "InactiveSupplierError";
  }
}

export class LineItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Item não encontrado: ${id}`);
    this.name = "LineItemNotFoundError";
  }
}

export class InvalidLineItemTypeError extends Error {
  constructor(id: string) {
    super(`Item não é matéria-prima nem embalagem (RAW_MATERIAL/PACKAGING): ${id}`);
    this.name = "InvalidLineItemTypeError";
  }
}

export class InactiveLineItemError extends Error {
  constructor(id: string) {
    super(`Item inativo não pode ser usado em uma nova linha: ${id}`);
    this.name = "InactiveLineItemError";
  }
}

export class DuplicateLineItemError extends Error {
  constructor(id: string) {
    super(`Item duplicado na mesma ordem de compra: ${id}`);
    this.name = "DuplicateLineItemError";
  }
}

export class EmptyOrderError extends Error {
  constructor() {
    super("Ordem de compra precisa de pelo menos uma linha para ser confirmada");
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
