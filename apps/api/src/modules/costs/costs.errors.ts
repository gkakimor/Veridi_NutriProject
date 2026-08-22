export class FormulationVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`Versão de formulação não encontrada: ${id}`);
    this.name = "FormulationVersionNotFoundError";
  }
}

export class ReceiptLineNotFoundError extends Error {
  constructor(id: string) {
    super(`Linha de recebimento não encontrada: ${id}`);
    this.name = "ReceiptLineNotFoundError";
  }
}

export class InvalidAcquisitionCostError extends Error {
  constructor() {
    super("Custo efetivo de aquisição não pode ser negativo.");
    this.name = "InvalidAcquisitionCostError";
  }
}

/**
 * Material que o cliente envia nao tem aquisicao da Veridi. Gravar um custo
 * ali criaria um numero que nunca existiu — e que entraria em relatorio como
 * se fosse compra nossa.
 */
export class CustomerSuppliedAcquisitionCostError extends Error {
  constructor() {
    super("Materiais fornecidos pelo cliente não recebem custo de aquisição Veridi.");
    this.name = "CustomerSuppliedAcquisitionCostError";
  }
}
