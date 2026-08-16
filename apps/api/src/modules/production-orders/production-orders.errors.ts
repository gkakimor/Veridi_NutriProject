export class ProductNotFoundError extends Error {
  constructor(id: string) {
    super(`Produto não encontrado: ${id}`);
    this.name = "ProductNotFoundError";
  }
}

export class InactiveProductError extends Error {
  constructor(id: string) {
    super(`Produto inativo não pode ser usado em uma Ordem de Produção: ${id}`);
    this.name = "InactiveProductError";
  }
}

export class MissingFinishedItemError extends Error {
  constructor() {
    super("Produto precisa de um item de produto acabado válido antes de gerar uma Ordem de Produção");
    this.name = "MissingFinishedItemError";
  }
}

export class FormulationVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`Versão de formulação não encontrada: ${id}`);
    this.name = "FormulationVersionNotFoundError";
  }
}

export class FormulationVersionProductMismatchError extends Error {
  constructor(versionId: string, productId: string) {
    super(`Versão de formulação ${versionId} não pertence ao produto ${productId}`);
    this.name = "FormulationVersionProductMismatchError";
  }
}

export class ProductionOrderNotFoundError extends Error {
  constructor(id: string) {
    super(`Ordem de produção não encontrada: ${id}`);
    this.name = "ProductionOrderNotFoundError";
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

/** Reúne todas as falhas do gate de planejamento (seção 21 do handoff) numa mensagem só. */
export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}

/** Reúne todas as falhas do gate de RELEASE (shortage por Requirement) numa mensagem só. */
export class ReleaseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseValidationError";
  }
}
