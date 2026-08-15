export class ItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Item não encontrado: ${id}`);
    this.name = "ItemNotFoundError";
  }
}

export class UnitNotFoundError extends Error {
  constructor(code: string) {
    super(`Unidade de medida inválida: ${code}`);
    this.name = "UnitNotFoundError";
  }
}
