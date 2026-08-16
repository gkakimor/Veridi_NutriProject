/** Credencial inválida OU usuário inativo — a mensagem nunca distingue os dois. */
export class InvalidCredentialsError extends Error {
  constructor() {
    super("E-mail ou senha inválidos.");
    this.name = "InvalidCredentialsError";
  }
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Sessão inválida ou expirada — faça login novamente.");
    this.name = "NotAuthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Seu perfil não permite esta ação.") {
    super(message);
    this.name = "ForbiddenError";
  }
}
