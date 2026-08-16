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

const STRUCTURAL_FIELD_LABELS: Record<string, string> = {
  type: "Tipo",
  unitCode: "Unidade",
  controlsLot: "Controla lote",
  controlsExpiry: "Controla validade",
};

export class StructuralFieldLockedError extends Error {
  constructor(field: string) {
    const label = STRUCTURAL_FIELD_LABELS[field] ?? field;
    super(
      `${label}: este campo não pode ser alterado porque o item já possui histórico operacional.`,
    );
    this.name = "StructuralFieldLockedError";
  }
}
