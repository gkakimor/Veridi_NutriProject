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

/**
 * Concluir a OP com material por reconciliar.
 *
 * Carrega a lista, e nao so a contagem: "existem materiais sem consumo" manda
 * o operador procurar; "Celulose 102 e Estearato de magnesio" manda ele
 * resolver. A mensagem tambem diz as DUAS saidas — registrar o consumo ou
 * justificar a diferenca —, porque o defeito que este erro fecha nasceu de
 * gente achando que so havia uma.
 */
export class UnreconciledMaterialsError extends Error {
  readonly materials: { itemCode: string; itemName: string; missing: string; unitCode: string }[];

  constructor(materials: { itemCode: string; itemName: string; missing: string; unitCode: string }[]) {
    const nomes = materials.map((material) => `${material.itemCode} ${material.itemName}`).join(", ");
    super(
      `Existem materiais sem consumo confirmado: ${nomes}. ` +
        `Registre o consumo real ou justifique a diferença antes de concluir a ordem.`,
    );
    this.name = "UnreconciledMaterialsError";
    this.materials = materials;
  }
}

/** Justificar diferenca onde nao ha diferenca — o consumo ja cobre a necessidade. */
export class NoMaterialVarianceError extends Error {
  constructor(itemCode: string) {
    super(`O material ${itemCode} já tem consumo suficiente: não há diferença a justificar.`);
    this.name = "NoMaterialVarianceError";
  }
}

/** Requirement inexistente ou de outra OP — nunca revela qual das duas coisas. */
export class RequirementNotFoundError extends Error {
  constructor(requirementId: string) {
    super(`Material ${requirementId} não encontrado nesta ordem de produção.`);
    this.name = "RequirementNotFoundError";
  }
}
