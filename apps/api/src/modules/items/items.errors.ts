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

/**
 * `packagingSubtype` só existe para embalagem. Guardá-lo em matéria-prima
 * ou produto acabado criaria um dado sem significado no cadastro.
 */
export class PackagingSubtypeNotApplicableError extends Error {
  constructor() {
    super("Subtipo de embalagem só se aplica a itens do tipo Material de embalagem.");
    this.name = "PackagingSubtypeNotApplicableError";
  }
}

/** Referência manual de custo em unidade que não converte para a do item. */
export class CostReferenceUnitIncompatibleError extends Error {
  constructor(uomCode: string, itemUnitCode: string) {
    super(
      `A unidade da referência (${uomCode}) não converte para a unidade do item (${itemUnitCode}).`,
    );
    this.name = "CostReferenceUnitIncompatibleError";
  }
}

export class InvalidCostReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCostReferenceError";
  }
}

export class StructuralFieldLockedError extends Error {
  constructor(field: string) {
    const label = STRUCTURAL_FIELD_LABELS[field] ?? field;
    super(
      `${label}: este campo não pode ser alterado porque o item já possui histórico operacional.`,
    );
    this.name = "StructuralFieldLockedError";
  }
}
