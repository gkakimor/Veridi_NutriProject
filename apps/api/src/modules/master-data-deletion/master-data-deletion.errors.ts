import type { MasterDataDeletionReferenceDTO } from "@veridi/shared";

export class MasterDataNotFoundError extends Error {
  constructor(rotulo: string, id: string) {
    super(`${rotulo} não encontrado: ${id}`);
    this.name = "MasterDataNotFoundError";
  }
}

/** Uso, referência ou histórico real: 409 com cada razão que impede. */
export class MasterDataInUseError extends Error {
  readonly references: MasterDataDeletionReferenceDTO[];

  constructor(rotulo: string, references: MasterDataDeletionReferenceDTO[]) {
    super(
      `${rotulo} em uso não pode ser excluído definitivamente. A exclusão física é só para cadastro criado por engano e nunca utilizado.`,
    );
    this.name = "MasterDataInUseError";
    this.references = references;
  }
}

/**
 * A transação mexeu em algo fora do agregado — CASCADE ou SET NULL que o
 * catálogo não previa. Tudo foi desfeito; nada foi excluído nem gravado.
 */
export class MasterDataDeleteAbortedError extends Error {
  readonly inesperado: Record<string, { ins: number; upd: number; del: number }>;

  constructor(inesperado: Record<string, { ins: number; upd: number; del: number }>) {
    super(
      `A exclusão foi desfeita: ela alteraria dados fora do cadastro (${Object.keys(inesperado).join(", ")}). Nada foi excluído.`,
    );
    this.name = "MasterDataDeleteAbortedError";
    this.inesperado = inesperado;
  }
}
