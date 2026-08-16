export class SupplierItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Relação item × fornecedor não encontrada: ${id}`);
    this.name = "SupplierItemNotFoundError";
  }
}

export class SupplierItemAlreadyExistsError extends Error {
  constructor() {
    super("Este fornecedor já está cadastrado para o item.");
    this.name = "SupplierItemAlreadyExistsError";
  }
}

export class SupplierItemItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Item não encontrado: ${id}`);
    this.name = "SupplierItemItemNotFoundError";
  }
}

export class SupplierItemSupplierNotFoundError extends Error {
  constructor(id: string) {
    super(`Fornecedor não encontrado: ${id}`);
    this.name = "SupplierItemSupplierNotFoundError";
  }
}

/** Produto acabado não se compra de fornecedor — ele é produzido. */
export class SupplierItemInvalidItemTypeError extends Error {
  constructor() {
    super("Só matéria-prima e embalagem têm fornecedor cadastrado.");
    this.name = "SupplierItemInvalidItemTypeError";
  }
}

export class InactiveSupplierItemPartyError extends Error {
  constructor(what: "item" | "supplier") {
    super(
      what === "item"
        ? "Item inativo — reative o item antes de criar a relação."
        : "Fornecedor inativo — reative o fornecedor antes de criar a relação.",
    );
    this.name = "InactiveSupplierItemPartyError";
  }
}

/** Só relação ativa e homologada pode ser preferencial. */
export class SupplierItemNotEligibleForPreferredError extends Error {
  constructor() {
    super("Só um fornecedor homologado e ativo pode ser o preferencial do item.");
    this.name = "SupplierItemNotEligibleForPreferredError";
  }
}

export class InvalidOfferPriceError extends Error {
  constructor() {
    super("Preço inválido: informe um valor maior ou igual a zero.");
    this.name = "InvalidOfferPriceError";
  }
}

export class InvalidCurrencyCodeError extends Error {
  constructor(value: string) {
    super(`Moeda inválida: ${value}. Use o código de 3 letras (ex.: BRL).`);
    this.name = "InvalidCurrencyCodeError";
  }
}

export class IncompatibleOfferUomError extends Error {
  constructor(uomCode: string, itemUnitCode: string) {
    super(`Unidade ${uomCode} não é compatível com a unidade do item (${itemUnitCode}).`);
    this.name = "IncompatibleOfferUomError";
  }
}

export class InvalidMinimumOrderError extends Error {
  constructor(message = "Pedido mínimo exige quantidade maior que zero e unidade.") {
    super(message);
    this.name = "InvalidMinimumOrderError";
  }
}

export class InvalidOfferValidityError extends Error {
  constructor() {
    super("A validade não pode ser anterior ao início da vigência.");
    this.name = "InvalidOfferValidityError";
  }
}
