export class SupplierNotFoundError extends Error {
  constructor(id: string) {
    super(`Fornecedor não encontrado: ${id}`);
    this.name = "SupplierNotFoundError";
  }
}

export class DuplicateCnpjError extends Error {
  constructor(cnpj: string) {
    super(`CNPJ já cadastrado: ${cnpj}`);
    this.name = "DuplicateCnpjError";
  }
}
