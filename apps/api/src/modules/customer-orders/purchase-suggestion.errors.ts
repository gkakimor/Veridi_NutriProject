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

/**
 * Tentativa de comprar material que, nas OPs deste Pedido, é fornecido
 * pelo cliente. Falta desse material nunca é "comprar" — é aguardar o
 * cliente enviar.
 */
export class CustomerSuppliedItemPurchaseError extends Error {
  constructor(itemCode: string) {
    super(
      `${itemCode} é material fornecido pelo cliente nas OPs deste pedido — não gera Ordem de Compra.`,
    );
    this.name = "CustomerSuppliedItemPurchaseError";
  }
}
