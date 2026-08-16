export class ReservationLineNotFoundError extends Error {
  constructor(id: string) {
    super(`Linha de reserva não encontrada: ${id}`);
    this.name = "ReservationLineNotFoundError";
  }
}

export class LineAlreadyPickedError extends Error {
  constructor() {
    super("Este lote já foi conferido no Picking.");
    this.name = "LineAlreadyPickedError";
  }
}

export class LineNotActiveError extends Error {
  constructor() {
    super("Esta linha de reserva foi substituída — use a linha ativa atual.");
    this.name = "LineNotActiveError";
  }
}

export class MissingLotCodeError extends Error {
  constructor() {
    super("Item controla lote — informe o código do lote.");
    this.name = "MissingLotCodeError";
  }
}

export class LotNotFoundByCodeError extends Error {
  constructor(code: string) {
    super(`Lote não encontrado: ${code}`);
    this.name = "LotNotFoundByCodeError";
  }
}

/** Carrega os dois códigos para a UI mostrar "Esperado X / Informado Y" lado a lado. */
export class LotMismatchError extends Error {
  expectedLotCode: string;
  scannedLotCode: string;

  constructor(expectedLotCode: string, scannedLotCode: string) {
    super(`Lote informado (${scannedLotCode}) é diferente do lote reservado (${expectedLotCode}).`);
    this.name = "LotMismatchError";
    this.expectedLotCode = expectedLotCode;
    this.scannedLotCode = scannedLotCode;
  }
}

export class LotNoLongerEligibleError extends Error {
  constructor(lotCode: string) {
    super(
      `Lote ${lotCode} não está mais elegível (vencido, bloqueado ou aguardando liberação) — utilize uma substituição de lote.`,
    );
    this.name = "LotNoLongerEligibleError";
  }
}

export class SameLotSubstitutionError extends Error {
  constructor() {
    super("O lote alternativo não pode ser o mesmo já reservado.");
    this.name = "SameLotSubstitutionError";
  }
}

export class ItemDoesNotControlLotError extends Error {
  constructor() {
    super("Item não controla lote — substituição de lote não se aplica.");
    this.name = "ItemDoesNotControlLotError";
  }
}

export class AlternateLotItemMismatchError extends Error {
  constructor() {
    super("O lote alternativo não pertence ao mesmo item da reserva.");
    this.name = "AlternateLotItemMismatchError";
  }
}

export class InsufficientAlternateLotError extends Error {
  constructor(lotCode: string) {
    super(`Lote ${lotCode} não possui saldo disponível suficiente para a quantidade reservada.`);
    this.name = "InsufficientAlternateLotError";
  }
}

export class SubstitutionAfterConsumptionError extends Error {
  constructor() {
    super("Esta linha já teve consumo registrado — não é mais possível substituir o lote.");
    this.name = "SubstitutionAfterConsumptionError";
  }
}

export class PickingRequiredError extends Error {
  constructor() {
    super("É necessário confirmar o Picking desta linha antes de registrar o consumo.");
    this.name = "PickingRequiredError";
  }
}

export class ConsumptionExceedsReservedError extends Error {
  constructor(remaining: string) {
    super(`Quantidade excede o saldo ainda reservado desta linha (restam ${remaining}).`);
    this.name = "ConsumptionExceedsReservedError";
  }
}

export class InvalidConsumptionQuantityError extends Error {
  constructor() {
    super("Quantidade de consumo deve ser maior que zero.");
    this.name = "InvalidConsumptionQuantityError";
  }
}

export class ConsumptionLotNotEligibleError extends Error {
  constructor(lotCode: string) {
    super(`Lote ${lotCode} não está mais elegível para consumo (vencido, bloqueado ou aguardando liberação).`);
    this.name = "ConsumptionLotNotEligibleError";
  }
}

export class InsufficientOnHandError extends Error {
  constructor(itemCode: string) {
    super(`Estoque físico insuficiente para consumir: ${itemCode}`);
    this.name = "InsufficientOnHandError";
  }
}

export class ProductionOrderNotReleasedError extends Error {
  constructor() {
    super("Somente ordens liberadas ou em produção permitem Picking/Consumo.");
    this.name = "ProductionOrderNotReleasedError";
  }
}

export class EmptyConsumptionBatchError extends Error {
  constructor() {
    super("Informe ao menos uma linha de consumo.");
    this.name = "EmptyConsumptionBatchError";
  }
}
