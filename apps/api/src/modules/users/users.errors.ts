export class UserNotFoundError extends Error {
  constructor(id: string) {
    super(`Usuário não encontrado: ${id}`);
    this.name = "UserNotFoundError";
  }
}

export class EmailAlreadyUsedError extends Error {
  constructor(email: string) {
    super(`Já existe um usuário com o e-mail ${email}.`);
    this.name = "EmailAlreadyUsedError";
  }
}
