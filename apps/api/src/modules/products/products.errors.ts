/** A unidade da dose precisa existir no cadastro de unidades. */
export class DoseUomNotFoundError extends Error {
  constructor(code: string) {
    super(`Unidade da dose inválida: ${code}`);
    this.name = "DoseUomNotFoundError";
  }
}

export class ProductNotFoundError extends Error {
  constructor(id: string) {
    super(`Produto não encontrado: ${id}`);
    this.name = "ProductNotFoundError";
  }
}

export class CustomerNotFoundError extends Error {
  constructor(id: string) {
    super(`Cliente não encontrado: ${id}`);
    this.name = "CustomerNotFoundError";
  }
}

export class InactiveCustomerError extends Error {
  constructor(id: string) {
    super(`Cliente inativo não pode ser associado a um novo produto: ${id}`);
    this.name = "InactiveCustomerError";
  }
}

export class FinishedItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Item de produto acabado não encontrado: ${id}`);
    this.name = "FinishedItemNotFoundError";
  }
}

export class InvalidFinishedItemTypeError extends Error {
  constructor(id: string) {
    super(`Item não é do tipo FINISHED_PRODUCT: ${id}`);
    this.name = "InvalidFinishedItemTypeError";
  }
}

export class InactiveFinishedItemError extends Error {
  constructor(id: string) {
    super(`Item inativo não pode ser associado a um novo produto: ${id}`);
    this.name = "InactiveFinishedItemError";
  }
}

export class DuplicateFinishedItemError extends Error {
  constructor(id: string) {
    super(`Item de produto acabado já associado a outro produto: ${id}`);
    this.name = "DuplicateFinishedItemError";
  }
}

/** A unidade de estoque do item de produto acabado precisa existir. */
export class FinishedUnitNotFoundError extends Error {
  constructor(code: string) {
    super(`Unidade de estoque inválida: ${code}`);
    this.name = "FinishedUnitNotFoundError";
  }
}

/**
 * "Exige CoA" pedido na criação do Produto para um item de produto acabado que
 * JÁ EXISTE, com valor diferente do que o item tem.
 *
 * O Produto só decide o laudo do PA que nasce com ele. Depois disso o controle
 * é do cadastro do Item, com o gate da Qualidade: aceitar aqui seria uma porta
 * lateral para desligar (ou ligar) o laudo de um item existente, e ignorar em
 * silêncio deixaria quem pediu achando que o lote exige laudo.
 */
export class FinishedItemControlsNotEditableHereError extends Error {
  constructor(itemCode: string) {
    super(
      `O item de produto acabado ${itemCode} já existe: "Exige CoA / Laudo" dele se altera no cadastro de Itens, pela Qualidade. ` +
        "Crie o produto sem informar o laudo.",
    );
    this.name = "FinishedItemControlsNotEditableHereError";
  }
}

/** Inativar o inativo, reativar o ativo: 409 com a frase, nunca 500 nem 200 silencioso. */
export class InvalidProductStatusTransitionError extends Error {
  constructor(active: boolean) {
    super(active ? "Produto já está ativo." : "Produto já está inativo.");
    this.name = "InvalidProductStatusTransitionError";
  }
}

/**
 * Produto já em uso não muda de Cliente.
 *
 * Trocar o dono de um produto que já tem pedido, ordem de produção ou
 * orçamento reescreveria, em silêncio, de quem era aquele histórico. O
 * caminho correto é cadastrar um produto do outro Cliente — inclusive porque
 * cada Cliente tem o seu item de produto acabado.
 */
export class ProductCustomerLockedError extends Error {
  constructor(code: string, reasons: string[]) {
    super(
      `O produto ${code} não pode mudar de cliente: ${reasons.join(", ")}. ` +
        "Cadastre um produto para o outro cliente.",
    );
    this.name = "ProductCustomerLockedError";
  }
}
