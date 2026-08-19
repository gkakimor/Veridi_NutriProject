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

/**
 * Cálculo já citado por uma precificação não é descartável.
 *
 * A faixa congelou a base econômica dela; apagar o documento citado deixaria
 * um preço sem origem verificável.
 */
export class CalculationInUseError extends Error {
  constructor(public readonly pricingLabels: string[]) {
    super(
      `Este cálculo é a base econômica de ${pricingLabels.join(", ")} e não pode ser descartado.`,
    );
    this.name = "CalculationInUseError";
  }
}
