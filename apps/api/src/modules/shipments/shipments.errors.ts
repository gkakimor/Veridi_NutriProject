export class ShipmentNotFoundError extends Error {
  constructor(id: string) {
    super(`Expedição não encontrada: ${id}`);
    this.name = "ShipmentNotFoundError";
  }
}

export class OrderNotShippableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderNotShippableError";
  }
}

export class DraftShipmentAlreadyExistsError extends Error {
  constructor(code: string) {
    super(`Este pedido já possui uma expedição em rascunho (${code}) — confirme ou cancele antes de criar outra.`);
    this.name = "DraftShipmentAlreadyExistsError";
  }
}

export class NothingToShipError extends Error {
  constructor() {
    super("Não há quantidade reservada disponível para expedir neste pedido.");
    this.name = "NothingToShipError";
  }
}

export class ShipmentNotDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShipmentNotDraftError";
  }
}

export class EmptyShipmentError extends Error {
  constructor() {
    super("Informe ao menos uma quantidade maior que zero para confirmar a expedição.");
    this.name = "EmptyShipmentError";
  }
}

export class ReservationLineNotFoundError extends Error {
  constructor(id: string) {
    super(`Linha de reserva não encontrada neste pedido: ${id}`);
    this.name = "ReservationLineNotFoundError";
  }
}

export class ExceedsReservedRemainingError extends Error {
  constructor(lotCode: string, remaining: string) {
    super(`Quantidade excede o reservado disponível do lote ${lotCode} (restam ${remaining}).`);
    this.name = "ExceedsReservedRemainingError";
  }
}

export class ExceedsOutstandingError extends Error {
  constructor(productCode: string, outstanding: string) {
    super(`Quantidade excede o que ainda falta expedir de ${productCode} (restam ${outstanding}).`);
    this.name = "ExceedsOutstandingError";
  }
}

export class LotNotShippableError extends Error {
  constructor(lotCode: string) {
    super(
      `Lote ${lotCode} não está elegível para expedição (bloqueado, vencido ou aguardando liberação da Qualidade) — realoque a reserva.`,
    );
    this.name = "LotNotShippableError";
  }
}

export class InsufficientOnHandError extends Error {
  constructor(lotCode: string) {
    super(`Saldo físico insuficiente no lote ${lotCode} para esta expedição.`);
    this.name = "InsufficientOnHandError";
  }
}

export class ExcessiveReserveRequestError extends Error {
  constructor(productCode: string, limit: string) {
    super(`Quantidade a reservar excede o pendente de ${productCode} (máximo ${limit}).`);
    this.name = "ExcessiveReserveRequestError";
  }
}

export class InsufficientAvailableError extends Error {
  constructor(productCode: string, available: string) {
    super(`Estoque disponível insuficiente para reservar ${productCode} (disponível: ${available}).`);
    this.name = "InsufficientAvailableError";
  }
}

export class ShipmentLineNotFoundError extends Error {
  constructor(id: string) {
    super(`Linha não encontrada nesta expedição: ${id}`);
    this.name = "ShipmentLineNotFoundError";
  }
}

export class LotNotFoundError extends Error {
  constructor(code: string) {
    super(`Lote não encontrado: ${code}`);
    this.name = "LotNotFoundError";
  }
}

/**
 * Lote lido não é o lote reservado desta linha. Nunca substituir
 * automaticamente — trocar de lote é uma realocação explícita da reserva.
 */
export class LotMismatchError extends Error {
  constructor(
    readonly expectedLotCode: string,
    readonly informedLotCode: string,
  ) {
    super(
      `Este lote não corresponde à reserva desta linha da expedição. Lote esperado: ${expectedLotCode}. Lote informado: ${informedLotCode}.`,
    );
    this.name = "LotMismatchError";
  }
}

export class LineNotVerifiableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LineNotVerifiableError";
  }
}

export class UnverifiedShipmentLinesError extends Error {
  constructor() {
    super("Existem lotes ainda não conferidos nesta expedição.");
    this.name = "UnverifiedShipmentLinesError";
  }
}

export class NothingToReallocateError extends Error {
  constructor() {
    super("Esta linha de reserva não possui quantidade remanescente para realocar.");
    this.name = "NothingToReallocateError";
  }
}
