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

export class AgreedPriceNotEditableError extends Error {
  constructor(agreed: string) {
    super(
      `O preço deste item foi acordado no Pedido (R$ ${agreed}) e não se digita de novo aqui. ` +
        'Para faturar outro valor use "Alterar preço de faturamento", com justificativa.',
    );
    this.name = "AgreedPriceNotEditableError";
  }
}

export class PriceOverrideReasonRequiredError extends Error {
  constructor() {
    super("Informe o motivo — faturar um valor diferente do acordado é uma decisão que fica registrada.");
    this.name = "PriceOverrideReasonRequiredError";
  }
}

export class NoAgreedPriceToOverrideError extends Error {
  constructor() {
    super(
      "Esta linha não tem preço acordado no Pedido — não há o que sobrepor. Informe o preço normalmente.",
    );
    this.name = "NoAgreedPriceToOverrideError";
  }
}
