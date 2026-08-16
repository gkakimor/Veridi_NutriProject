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
