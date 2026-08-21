export class CustomerOrderNotConfirmedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerOrderNotConfirmedError";
  }
}

export class MissingPlanLineError extends Error {
  constructor(customerOrderLineId: string) {
    super(`O plano precisa cobrir todas as linhas do pedido — falta a linha ${customerOrderLineId}.`);
    this.name = "MissingPlanLineError";
  }
}

export class UnknownPlanLineError extends Error {
  constructor(customerOrderLineId: string) {
    super(`Linha não pertence a este pedido: ${customerOrderLineId}`);
    this.name = "UnknownPlanLineError";
  }
}

export class IncompletePlanCoverageError extends Error {
  constructor(customerOrderLineId: string) {
    super(
      `Reservar + Produzir precisa ser exatamente igual à quantidade pedida na linha ${customerOrderLineId}.`,
    );
    this.name = "IncompletePlanCoverageError";
  }
}

export class ExcessiveReserveError extends Error {
  constructor(productCode: string, available: string) {
    super(
      `Estoque disponível insuficiente para reservar ${productCode} no momento da aplicação (disponível: ${available}).`,
    );
    this.name = "ExcessiveReserveError";
  }
}

export class ProductNoLongerValidForProductionError extends Error {
  constructor(productCode: string) {
    super(
      `Produto ${productCode} não está mais ativo/válido para gerar Ordem de Produção — revise o pedido.`,
    );
    this.name = "ProductNoLongerValidForProductionError";
  }
}

export class NoPendingProductionError extends Error {
  constructor(productCode: string) {
    super(
      `Não há saldo pendente de produção em ${productCode} — o pedido já está coberto por expedição, ` +
        "reserva de produto acabado ou ordem em andamento.",
    );
    this.name = "NoPendingProductionError";
  }
}

export class RemainderExceedsPendingError extends Error {
  constructor(pending: string) {
    super(`Quantidade maior que o saldo pendente de produção desta linha (restam ${pending}).`);
    this.name = "RemainderExceedsPendingError";
  }
}
