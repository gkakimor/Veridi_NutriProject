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

/**
 * Cálculo que não pode virar documento.
 *
 * Salvar congela uma base econômica que orçamento e preço vão citar. Se a
 * formulação não consegue nem dizer quanto material entra, o que se
 * congelaria seria um custo sem matéria-prima — o defeito que a auditoria
 * VAL-LEG-01 encontrou em produção.
 */
export class CalculationBlockedByFormulationError extends Error {
  constructor() {
    super(
      "Não é possível salvar este cálculo: a formulação usada tem componentes por dose e não informa as doses por embalagem. Informe as doses na formulação e calcule novamente.",
    );
    this.name = "CalculationBlockedByFormulationError";
  }
}
