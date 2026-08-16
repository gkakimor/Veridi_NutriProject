export class SampleNotFoundError extends Error {
  constructor(id: string) {
    super(`Amostra não encontrada: ${id}`);
    this.name = "SampleNotFoundError";
  }
}

/** Projeto aprovado/cancelado é terminal — não recebe amostra nova. */
export class ProjectNotOpenForSamplesError extends Error {
  constructor(status: string) {
    super(
      `Projeto ${status === "APPROVED" ? "aprovado" : "cancelado"} não aceita novas amostras.`,
    );
    this.name = "ProjectNotOpenForSamplesError";
  }
}

export class SampleClosedError extends Error {
  constructor(status: string) {
    super(`Amostra ${status} é somente leitura — registros de amostra são históricos.`);
    this.name = "SampleClosedError";
  }
}

export class InvalidSampleTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Transição de amostra não permitida: ${from} → ${to}.`);
    this.name = "InvalidSampleTransitionError";
  }
}

export class SampleItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Item não encontrado: ${id}`);
    this.name = "SampleItemNotFoundError";
  }
}

/** Item loteado sem lote informado destruiria a rastreabilidade. */
export class MissingSampleLotError extends Error {
  constructor(itemCode: string) {
    super(`${itemCode} controla lote — informe o lote consumido.`);
    this.name = "MissingSampleLotError";
  }
}

export class SampleLotNotFoundError extends Error {
  constructor(code: string) {
    super(`Lote não encontrado para este item: ${code}`);
    this.name = "SampleLotNotFoundError";
  }
}

export class LotNotEligibleForSampleError extends Error {
  constructor(code: string) {
    super(
      `Lote ${code} não está elegível (qualidade, validade ou laudo) — não existe exceção para amostra.`,
    );
    this.name = "LotNotEligibleForSampleError";
  }
}

export class LotOwnerNotAllowedError extends Error {
  constructor(code: string) {
    super(`Lote ${code} pertence a outro cliente — não pode ser usado nesta amostra.`);
    this.name = "LotOwnerNotAllowedError";
  }
}

/** Amostra nunca come estoque reservado para OP/Pedido. */
export class InsufficientSampleStockError extends Error {
  constructor(reference: string, available: string) {
    super(`Estoque disponível insuficiente em ${reference}: ${available}.`);
    this.name = "InsufficientSampleStockError";
  }
}

export class InvalidSampleQuantityError extends Error {
  constructor() {
    super("Quantidade consumida deve ser maior que zero.");
    this.name = "InvalidSampleQuantityError";
  }
}

export class MissingSampleOutputError extends Error {
  constructor() {
    super("Informe a quantidade produzida e a unidade da amostra.");
    this.name = "MissingSampleOutputError";
  }
}

/** O sistema nunca inventa consumo: concluir sem material exige confirmação. */
export class SampleWithoutConsumptionError extends Error {
  constructor() {
    super("Nenhum consumo de material foi registrado — confirme para concluir mesmo assim.");
    this.name = "SampleWithoutConsumptionError";
  }
}

export class MissingDecisionNotesError extends Error {
  constructor() {
    super("Descreva o motivo da reprovação da amostra.");
    this.name = "MissingDecisionNotesError";
  }
}
