export class RevisionNotFoundError extends Error {
  constructor(id: string) {
    super(`Revisão de documento não encontrada: ${id}`);
    this.name = "RevisionNotFoundError";
  }
}

/** Revisão é imutável: repetir o número significaria reescrever histórico. */
export class RevisionAlreadyExistsError extends Error {
  constructor(type: string, revision: string) {
    super(`Já existe a revisão ${revision} para este documento (${type}).`);
    this.name = "RevisionAlreadyExistsError";
  }
}
