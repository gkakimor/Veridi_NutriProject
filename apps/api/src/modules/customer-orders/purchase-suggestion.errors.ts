export class CustomerOrderNotInFulfillmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerOrderNotInFulfillmentError";
  }
}

export class EmptyPurchaseDraftsError extends Error {
  constructor() {
    super("Nenhuma quantidade informada — nenhuma Ordem de Compra foi gerada.");
    this.name = "EmptyPurchaseDraftsError";
  }
}
