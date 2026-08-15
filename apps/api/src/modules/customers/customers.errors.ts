export class CustomerNotFoundError extends Error {
  constructor(id: string) {
    super(`Cliente não encontrado: ${id}`);
    this.name = "CustomerNotFoundError";
  }
}

export class DuplicateCnpjError extends Error {
  constructor(cnpj: string) {
    super(`CNPJ já cadastrado: ${cnpj}`);
    this.name = "DuplicateCnpjError";
  }
}
