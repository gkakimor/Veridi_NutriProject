export class ProductCmvNotFoundError extends Error {
  constructor(productId: string) {
    super(`Produto ${productId} não encontrado.`);
    this.name = "ProductCmvNotFoundError";
  }
}

export class InvalidCmvQuantityError extends Error {
  constructor() {
    super("Informe uma quantidade maior que zero para simular o CMV.");
    this.name = "InvalidCmvQuantityError";
  }
}

export class InvalidCmvReferenceDateError extends Error {
  constructor() {
    super("Informe uma data de referência válida (AAAA-MM-DD).");
    this.name = "InvalidCmvReferenceDateError";
  }
}
