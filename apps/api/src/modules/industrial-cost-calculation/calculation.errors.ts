export class IndustrialCostCalculationNotFoundError extends Error {
  constructor(id: string) {
    super(`Cálculo de custo não encontrado: ${id}`);
    this.name = "IndustrialCostCalculationNotFoundError";
  }
}

/** Data de referência é decisão de quem calcula — nunca "hoje" implícito. */
export class InvalidCostReferenceDateError extends Error {
  constructor() {
    super("Data de referência de custo inválida.");
    this.name = "InvalidCostReferenceDateError";
  }
}
