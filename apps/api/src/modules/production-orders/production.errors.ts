export class MissingBusinessLotNumberError extends Error {
  constructor() {
    super("Informe o lote Veridi/comercial para criar um novo lote de produto acabado.");
    this.name = "MissingBusinessLotNumberError";
  }
}

export class MissingFinishedExpiryDateError extends Error {
  constructor() {
    super("Este produto acabado controla validade — informe a validade do novo lote.");
    this.name = "MissingFinishedExpiryDateError";
  }
}

export class ExpiryBeforeProducedAtError extends Error {
  constructor() {
    super("A validade não pode ser anterior à data de produção.");
    this.name = "ExpiryBeforeProducedAtError";
  }
}

export class LotControlRequiredError extends Error {
  constructor(itemCode: string) {
    super(`Item de produto acabado ${itemCode} não controla lote — não é possível registrar produção.`);
    this.name = "LotControlRequiredError";
  }
}

export class OutputExceedsPlannedError extends Error {
  constructor(remaining: string) {
    super(`Quantidade excede o que ainda resta planejado para esta Ordem (restam ${remaining}).`);
    this.name = "OutputExceedsPlannedError";
  }
}

export class FinishedLotNotFoundError extends Error {
  constructor(id: string) {
    super(`Lote de produto acabado não encontrado: ${id}`);
    this.name = "FinishedLotNotFoundError";
  }
}

export class FinishedLotWrongOrderError extends Error {
  constructor(lotCode: string) {
    super(`Lote ${lotCode} não pertence a esta Ordem de Produção.`);
    this.name = "FinishedLotWrongOrderError";
  }
}

export class FinishedLotWrongItemError extends Error {
  constructor(lotCode: string) {
    super(`Lote ${lotCode} não pertence a este produto.`);
    this.name = "FinishedLotWrongItemError";
  }
}

export class FinishedLotNotEligibleError extends Error {
  constructor(lotCode: string) {
    super(
      `Lote ${lotCode} não está mais elegível para receber nova produção (bloqueado, vencido ou já liberado pela Qualidade).`,
    );
    this.name = "FinishedLotNotEligibleError";
  }
}

export class NoProductionOutputsError extends Error {
  constructor() {
    super("Registre ao menos um apontamento de produção antes de concluir a Ordem.");
    this.name = "NoProductionOutputsError";
  }
}

export class MissingCompletionReasonError extends Error {
  constructor() {
    super("Quantidade produzida ficou abaixo do planejado — informe o motivo da variação para concluir.");
    this.name = "MissingCompletionReasonError";
  }
}
