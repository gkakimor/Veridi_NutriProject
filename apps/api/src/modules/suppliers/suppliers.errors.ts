export class SupplierNotFoundError extends Error {
  constructor(id: string) {
    super(`Fornecedor não encontrado: ${id}`);
    this.name = "SupplierNotFoundError";
  }
}

/** Inativar o inativo, reativar o ativo: 409 com a frase, nunca 500 nem 200 silencioso. */
export class InvalidSupplierStatusTransitionError extends Error {
  constructor(active: boolean) {
    super(active ? "Fornecedor já está ativo." : "Fornecedor já está inativo.");
    this.name = "InvalidSupplierStatusTransitionError";
  }
}

export class DuplicateCnpjError extends Error {
  constructor(cnpj: string) {
    super(`CNPJ já cadastrado: ${cnpj}`);
    this.name = "DuplicateCnpjError";
  }
}
