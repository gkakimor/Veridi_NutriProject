export class PartNotFoundError extends Error {
  constructor(partNumber: number) {
    super(`Parte ${partNumber} não encontrada nesta Ordem de Produção.`);
    this.name = "PartNotFoundError";
  }
}

export class PartAlreadyCompletedError extends Error {
  constructor(partNumber: number) {
    super(`A parte ${partNumber} já foi concluída — registros de parte concluída são históricos.`);
    this.name = "PartAlreadyCompletedError";
  }
}

/** Embalagem não é pesada por fração: continua no Picking/Consumo da OP. */
export class RequirementNotWeighableError extends Error {
  constructor(itemCode: string) {
    super(`${itemCode} não é matéria-prima — embalagem não entra na pesagem por parte.`);
    this.name = "RequirementNotWeighableError";
  }
}

export class WeighingNotFoundError extends Error {
  constructor(id: string) {
    super(`Pesagem não encontrada: ${id}`);
    this.name = "WeighingNotFoundError";
  }
}

/**
 * Conclusão de parte com matéria-prima planejada e nenhuma pesagem. Não é
 * uma tolerância: é a ausência total de registro.
 */
export class UnweighedRequirementError extends Error {
  constructor(itemCodes: string[]) {
    super(
      `Não é possível concluir a parte: sem pesagem registrada para ${itemCodes.join(", ")}.`,
    );
    this.name = "UnweighedRequirementError";
  }
}
