export class ProductNotFoundError extends Error {
  constructor(id: string) {
    super(`Produto não encontrado: ${id}`);
    this.name = "ProductNotFoundError";
  }
}

export class FormulationVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`Versão de formulação não encontrada: ${id}`);
    this.name = "FormulationVersionNotFoundError";
  }
}

export class MissingFinishedItemError extends Error {
  constructor() {
    super("Produto precisa de um item de produto acabado vinculado antes de ter formulação");
    this.name = "MissingFinishedItemError";
  }
}

export class FormulationAlreadyExistsError extends Error {
  constructor() {
    super("Produto já possui ao menos uma versão de formulação — use \"Criar nova versão\"");
    this.name = "FormulationAlreadyExistsError";
  }
}

export class VersionNotDraftError extends Error {
  constructor() {
    super("Esta ação só é permitida em uma versão em rascunho");
    this.name = "VersionNotDraftError";
  }
}

export class VersionNotActiveError extends Error {
  constructor() {
    super("Nova versão só pode ser criada a partir da versão ativa");
    this.name = "VersionNotActiveError";
  }
}

export class DuplicateComponentItemError extends Error {
  constructor(itemCode: string) {
    super(`Item duplicado na mesma versão: ${itemCode}`);
    this.name = "DuplicateComponentItemError";
  }
}

export class InvalidComponentItemTypeError extends Error {
  constructor(itemCode: string) {
    super(`Item não é matéria-prima nem embalagem (RAW_MATERIAL/PACKAGING): ${itemCode}`);
    this.name = "InvalidComponentItemTypeError";
  }
}

export class InactiveComponentItemError extends Error {
  constructor(itemCode: string) {
    super(`Item inativo não pode ser adicionado como novo componente: ${itemCode}`);
    this.name = "InactiveComponentItemError";
  }
}

export class ComponentItemNotFoundError extends Error {
  constructor(itemId: string) {
    super(`Item não encontrado: ${itemId}`);
    this.name = "ComponentItemNotFoundError";
  }
}

export class InvalidComponentQuantityError extends Error {
  constructor(itemCode: string) {
    super(`Quantidade deve ser maior que zero: ${itemCode}`);
    this.name = "InvalidComponentQuantityError";
  }
}

export class IncompatibleComponentUnitError extends Error {
  constructor(itemCode: string) {
    super(`Unidade da fórmula incompatível com a unidade de estoque do item: ${itemCode}`);
    this.name = "IncompatibleComponentUnitError";
  }
}

/** Motivo já vem pronto em português — reúne todas as falhas do gate de ativação (seção 16). */
export class FormulationActivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulationActivationError";
  }
}
