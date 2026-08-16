export class BillingNotFoundError extends Error {
  constructor(id: string) {
    super(`Faturamento não encontrado: ${id}`);
    this.name = "BillingNotFoundError";
  }
}

export class ShipmentNotBillableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShipmentNotBillableError";
  }
}

export class ActiveBillingAlreadyExistsError extends Error {
  constructor(code: string) {
    super(`Esta expedição já possui um faturamento ativo (${code}).`);
    this.name = "ActiveBillingAlreadyExistsError";
  }
}

export class EmptyShipmentForBillingError extends Error {
  constructor() {
    super("Esta expedição não possui linhas para faturar.");
    this.name = "EmptyShipmentForBillingError";
  }
}

export class BillingNotDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingNotDraftError";
  }
}

export class BillingLineNotFoundError extends Error {
  constructor(id: string) {
    super(`Linha de faturamento não encontrada neste documento: ${id}`);
    this.name = "BillingLineNotFoundError";
  }
}
