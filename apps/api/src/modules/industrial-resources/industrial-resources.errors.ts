export class IndustrialResourceNotFoundError extends Error {
  constructor(id: string) {
    super(`Recurso industrial não encontrado: ${id}`);
    this.name = "IndustrialResourceNotFoundError";
  }
}

/** Potência é atributo de equipamento — e nunca é assumida. */
export class InvalidResourcePowerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidResourcePowerError";
  }
}

/** Energia não ocupa capacidade: ela não entra em etapa de roteiro. */
export class InvalidResourceCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidResourceCapacityError";
  }
}

export class InvalidResourceRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidResourceRateError";
  }
}

/** Operador se mede em hora; energia, em kWh. */
export class InvalidResourceRateUomError extends Error {
  constructor(received: string, expected: string) {
    super(`Unidade ${received} não corresponde ao tipo do recurso (esperado ${expected}).`);
    this.name = "InvalidResourceRateUomError";
  }
}
