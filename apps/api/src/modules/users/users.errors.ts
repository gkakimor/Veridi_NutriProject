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

/**
 * A alteração deixaria o sistema sem nenhum ADMIN ativo — inativar o último, ou
 * trocar o perfil dele por outro (USER-LAST-ADMIN-GUARD-01, §120).
 */
export class LastActiveAdminError extends Error {
  constructor() {
    super("Não é possível concluir. O sistema precisa manter pelo menos um administrador ativo.");
    this.name = "LastActiveAdminError";
  }
}

/** Ninguém inativa o próprio usuário, nem havendo outro ADMIN: outro administrador faz isso (§120). */
export class SelfDeactivationError extends Error {
  constructor() {
    super(
      "Não é possível concluir. Você não pode inativar o próprio usuário — outro administrador deve fazer isso.",
    );
    this.name = "SelfDeactivationError";
  }
}

/** Nenhum ADMIN retira de si o perfil Administrador, nem havendo outro: outro administrador faz isso (§120). */
export class SelfDemotionError extends Error {
  constructor() {
    super(
      "Não é possível concluir. Você não pode retirar de si mesmo o perfil Administrador — outro administrador deve fazer isso.",
    );
    this.name = "SelfDemotionError";
  }
}
