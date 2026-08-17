export class PricingVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`Precificação não encontrada: ${id}`);
    this.name = "PricingVersionNotFoundError";
  }
}

export class PricingTierNotFoundError extends Error {
  constructor(id: string) {
    super(`Faixa de precificação não encontrada: ${id}`);
    this.name = "PricingTierNotFoundError";
  }
}

export class PricingProductNotFoundError extends Error {
  constructor(id: string) {
    super(`Produto não encontrado: ${id}`);
    this.name = "PricingProductNotFoundError";
  }
}

/** Só o rascunho é editável — ativa/inativa são histórico comercial. */
export class PricingVersionLockedError extends Error {
  constructor(status: string) {
    super(
      status === "ACTIVE"
        ? "Precificação ativa é somente leitura — crie uma nova versão para alterar."
        : "Precificação inativa é histórico e não pode ser alterada.",
    );
    this.name = "PricingVersionLockedError";
  }
}

/** Preço sem custo de origem é chute com aparência de número. */
export class CalculationRequiredError extends Error {
  constructor() {
    super("Selecione um cálculo de custo salvo (CALC) para criar a precificação.");
    this.name = "CalculationRequiredError";
  }
}

export class CalculationProductMismatchError extends Error {
  constructor() {
    super("O cálculo de custo selecionado pertence a outro produto.");
    this.name = "CalculationProductMismatchError";
  }
}

export class InvalidTierQuantityError extends Error {
  constructor(message = "Informe uma quantidade maior que zero para a faixa.") {
    super(message);
    this.name = "InvalidTierQuantityError";
  }
}

export class DuplicatedTierQuantityError extends Error {
  constructor(quantity: string) {
    super(`Já existe uma faixa de ${quantity} nesta precificação.`);
    this.name = "DuplicatedTierQuantityError";
  }
}

/** Margem somada à comissão em 100% não tem preço que satisfaça. */
export class InvalidPricingPercentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPricingPercentError";
  }
}

export class MissingTierPriceError extends Error {
  constructor(quantities: string[]) {
    super(
      `Faixas sem preço definido: ${quantities.join(", ")}. Informe o preço ou ajuste a margem.`,
    );
    this.name = "MissingTierPriceError";
  }
}

export class NoTiersToActivateError extends Error {
  constructor() {
    super("Adicione ao menos uma faixa de quantidade antes de ativar.");
    this.name = "NoTiersToActivateError";
  }
}

/** Custo incompleto pode virar preço manual, mas nunca por acidente. */
export class IncompleteCostActivationError extends Error {
  constructor(quantities: string[]) {
    super(
      `O custo está incompleto nas faixas: ${quantities.join(", ")}. Confirme explicitamente para ativar assim.`,
    );
    this.name = "IncompleteCostActivationError";
  }
}

export class TargetMarginWithoutPriceError extends Error {
  constructor(quantities: string[]) {
    super(
      `Faixas no modo "calcular pela margem" sem preço sugerido: ${quantities.join(", ")}. Informe o preço manualmente ou use um cálculo de custo completo.`,
    );
    this.name = "TargetMarginWithoutPriceError";
  }
}

/** A EC do cálculo não é mais a estrutura ativa do produto. */
export class OutdatedCostStructureError extends Error {
  constructor(label: string) {
    super(
      `Este preço foi construído sobre ${label}, que não é a estrutura de custos ativa do produto. Confirme explicitamente para ativar assim.`,
    );
    this.name = "OutdatedCostStructureError";
  }
}
