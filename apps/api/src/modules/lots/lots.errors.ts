export class LotNotFoundError extends Error {
  constructor(id: string) {
    super(`Lote não encontrado: ${id}`);
    this.name = "LotNotFoundError";
  }
}

export class InvalidLotTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLotTransitionError";
  }
}
