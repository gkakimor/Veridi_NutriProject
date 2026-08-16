export class ItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Item não encontrado: ${id}`);
    this.name = "ItemNotFoundError";
  }
}

export class LotNotFoundError extends Error {
  constructor(id: string) {
    super(`Lote não encontrado: ${id}`);
    this.name = "LotNotFoundError";
  }
}

export class LotItemMismatchError extends Error {
  constructor(lotId: string, itemId: string) {
    super(`Lote ${lotId} não pertence ao item ${itemId}`);
    this.name = "LotItemMismatchError";
  }
}

export class MissingLotError extends Error {
  constructor(itemCode: string) {
    super(`Item controla lote — informe o lote: ${itemCode}`);
    this.name = "MissingLotError";
  }
}

export class UnexpectedLotError extends Error {
  constructor(itemCode: string) {
    super(`Item não controla lote — não informe um lote: ${itemCode}`);
    this.name = "UnexpectedLotError";
  }
}

export class InsufficientStockError extends Error {
  constructor(itemCode: string) {
    super(`Quantidade excede o saldo disponível em estoque: ${itemCode}`);
    this.name = "InsufficientStockError";
  }
}

export class MissingCountReasonError extends Error {
  constructor() {
    super("Motivo é obrigatório quando a contagem diverge do saldo do sistema");
    this.name = "MissingCountReasonError";
  }
}

export class CountBelowReservedError extends Error {
  constructor() {
    super(
      "A contagem informada é inferior à quantidade atualmente reservada. Revise as reservas antes de ajustar o estoque.",
    );
    this.name = "CountBelowReservedError";
  }
}
