import type {
  StockCountCloseIssueDTO,
  StockCountHeldPositionDTO,
  StockCountStatus,
} from "@veridi/shared";

/** Decimal do domínio na frase, com vírgula — nunca `Number`. */
function quantidadeNaFrase(valor: string): string {
  return valor.replace(".", ",");
}

const STATUS_NA_FRASE: Record<StockCountStatus, string> = {
  IN_PROGRESS: "em contagem",
  IN_REVIEW: "em revisão",
  COMPLETED: "encerrado",
  CANCELLED: "cancelado",
};

export class StockCountNotFoundError extends Error {
  constructor() {
    super("Inventário não encontrado.");
    this.name = "StockCountNotFoundError";
  }
}

export class StockCountPositionNotFoundError extends Error {
  constructor() {
    super("Posição não encontrada neste inventário.");
    this.name = "StockCountPositionNotFoundError";
  }
}

/** Ação fora do estado: encerrado e cancelado não reabrem, e cada passo tem o seu estado. */
export class InvalidStockCountStatusError extends Error {
  constructor(
    readonly status: StockCountStatus,
    acao: string,
  ) {
    super(`Não é possível ${acao}: o inventário está ${STATUS_NA_FRASE[status]}.`);
    this.name = "InvalidStockCountStatusError";
  }
}

export class StockCountScopeEmptyError extends Error {
  constructor() {
    super("Nenhuma posição no escopo escolhido.");
    this.name = "StockCountScopeEmptyError";
  }
}

export class StockCountScopeTooLargeError extends Error {
  constructor(
    readonly positionCount: number,
    readonly maxPositions: number,
  ) {
    super(
      `O escopo tem ${positionCount} posições; o máximo por inventário é ${maxPositions}. Divida por tipo ou por local.`,
    );
    this.name = "StockCountScopeTooLargeError";
  }
}

/** O conjunto reavaliado no início difere do que a tela mostrou. */
export class StockCountScopeChangedError extends Error {
  constructor(
    readonly added: string[],
    readonly removed: string[],
  ) {
    super("As posições do escopo mudaram desde o preview. Confira de novo antes de iniciar.");
    this.name = "StockCountScopeChangedError";
  }
}

export class StockCountCustomerNotFoundError extends Error {
  constructor() {
    super("Cliente não encontrado.");
    this.name = "StockCountCustomerNotFoundError";
  }
}

/** Exclusividade: uma posição física está em no máximo um inventário aberto. */
export class PositionHeldByOpenCountError extends Error {
  constructor(readonly held: StockCountHeldPositionDTO[]) {
    const [primeira] = held;
    super(
      held.length === 0
        ? "Uma posição entrou em outro inventário aberto agora há pouco. Recarregue e confira."
        : held.length === 1 && primeira
          ? `Posição em outro inventário (${primeira.stockCountCode}). Registre a contagem lá.`
          : `${held.length} posições já estão em outro inventário aberto.`,
    );
    this.name = "PositionHeldByOpenCountError";
  }
}

export class PositionAlreadyInCountError extends Error {
  constructor() {
    super("Esta posição já faz parte do inventário.");
    this.name = "PositionAlreadyInCountError";
  }
}

/** Ação sobre uma posição que o estado dela não permite (ex.: retirar duas vezes). */
export class StockCountActionNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockCountActionNotAllowedError";
  }
}

/**
 * Conflito otimista: a posição mudou desde a versão que a tela recebeu. Nunca
 * último-write silencioso — quem registrou decide, vendo o registro atual.
 */
export class StockCountEntryConflictError extends Error {
  constructor(readonly positionId: string) {
    super(
      "A posição mudou desde que você a abriu: outra contagem foi registrada ou a rodada mudou. Confira antes de registrar.",
    );
    this.name = "StockCountEntryConflictError";
  }
}

export class StockCountEntryNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockCountEntryNotAllowedError";
  }
}

export class ClientRequestReusedError extends Error {
  constructor() {
    super("Este envio já registrou contagem em outra posição.");
    this.name = "ClientRequestReusedError";
  }
}

/** P2: unidade de dimensão COUNT conta unidades inteiras. */
export class FractionalCountQuantityError extends Error {
  constructor(unitCode: string) {
    super(`A unidade ${unitCode} conta unidades inteiras: informe a quantidade sem casas decimais.`);
    this.name = "FractionalCountQuantityError";
  }
}

export class StockCountFirstRoundIncompleteError extends Error {
  constructor(readonly pendingCount: number) {
    super(
      pendingCount === 1
        ? "Falta contar 1 posição (ou retirá-la com motivo)."
        : `Faltam contar ${pendingCount} posições (ou retirá-las com motivo).`,
    );
    this.name = "StockCountFirstRoundIncompleteError";
  }
}

export class StockCountNothingToReviewError extends Error {
  constructor() {
    super("Todas as posições foram retiradas: não há o que revisar. Cancele o inventário.");
    this.name = "StockCountNothingToReviewError";
  }
}

export class StockCountRecountNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockCountRecountNotAllowedError";
  }
}

export class StockCountDecisionNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockCountDecisionNotAllowedError";
  }
}

export class StockCountCloseBlockedError extends Error {
  constructor(readonly issues: StockCountCloseIssueDTO[]) {
    super(
      issues.length === 1
        ? "O encerramento foi recusado em 1 posição. Revise a lista."
        : `O encerramento foi recusado em ${issues.length} posições. Revise a lista.`,
    );
    this.name = "StockCountCloseBlockedError";
  }
}

/** Contagem rápida: o saldo mudou entre o que a tela mostrou e o confirmar. */
export class SystemQuantityChangedError extends Error {
  constructor(
    readonly shown: string,
    readonly current: string,
  ) {
    super(
      `O saldo mudou desde que você abriu (era ${quantidadeNaFrase(shown)}, agora ${quantidadeNaFrase(current)}). Confira antes de confirmar.`,
    );
    this.name = "SystemQuantityChangedError";
  }
}

export class StockCountFindingInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StockCountFindingInvalidError";
  }
}

/** Duas escritas no mesmo inventário se cruzaram; nada foi gravado pela segunda. */
export class StockCountConcurrentWriteError extends Error {
  constructor() {
    super("Outra operação neste inventário terminou antes. Recarregue e tente de novo.");
    this.name = "StockCountConcurrentWriteError";
  }
}
