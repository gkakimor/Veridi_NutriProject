export class IndustrialCostVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`Estrutura de custos não encontrada: ${id}`);
    this.name = "IndustrialCostVersionNotFoundError";
  }
}

export class IndustrialCostProductNotFoundError extends Error {
  constructor(id: string) {
    super(`Produto não encontrado: ${id}`);
    this.name = "IndustrialCostProductNotFoundError";
  }
}

/** Só o rascunho é editável — versão ativa/inativa é histórico. */
export class IndustrialCostVersionLockedError extends Error {
  constructor(status: string) {
    super(
      status === "ACTIVE"
        ? "Estrutura ativa é somente leitura — crie uma nova versão para alterar."
        : "Estrutura inativa é histórico e não pode ser alterada.",
    );
    this.name = "IndustrialCostVersionLockedError";
  }
}

export class MissingFormulationVersionError extends Error {
  constructor() {
    super("Selecione a versão de formulação usada por esta estrutura de custos.");
    this.name = "MissingFormulationVersionError";
  }
}

export class FormulationVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`Versão de formulação não encontrada: ${id}`);
    this.name = "FormulationVersionNotFoundError";
  }
}

/** A formulação precisa pertencer ao mesmo produto — custo não cruza receita. */
export class FormulationProductMismatchError extends Error {
  constructor() {
    super("A formulação selecionada pertence a outro produto.");
    this.name = "FormulationProductMismatchError";
  }
}

/** Ativar sobre formulação DRAFT congelaria custo sobre receita mutável. */
export class FormulationNotStableError extends Error {
  constructor() {
    super(
      "A formulação usada ainda é rascunho. Ative a formulação antes de ativar a estrutura de custos.",
    );
    this.name = "FormulationNotStableError";
  }
}

export class InvalidReferenceOutputError extends Error {
  constructor(message = "Informe a base de produção usada para estruturar o custo.") {
    super(message);
    this.name = "InvalidReferenceOutputError";
  }
}

export class IncompatibleReferenceUomError extends Error {
  constructor(uomCode: string, expected: string) {
    super(`Unidade ${uomCode} não é compatível com a unidade do produto acabado (${expected}).`);
    this.name = "IncompatibleReferenceUomError";
  }
}

/** Mão de obra, equipamento e energia ganham modelagem própria na capacidade 44. */
export class UnsupportedCostCategoryError extends Error {
  constructor() {
    super(
      "Mão de obra, equipamentos e energia não são lançados manualmente: eles entram com os recursos industriais.",
    );
    this.name = "UnsupportedCostCategoryError";
  }
}

export class InvalidCostRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCostRateError";
  }
}

export class IndustrialCostLineNotFoundError extends Error {
  constructor(id: string) {
    super(`Linha de custo não encontrada: ${id}`);
    this.name = "IndustrialCostLineNotFoundError";
  }
}

/** Ativar com premissa faltando é permitido, mas nunca por acidente. */
export class IncompleteActivationError extends Error {
  constructor(pendencies: string[]) {
    super(
      `Esta estrutura possui premissas de custo ainda não informadas: ${pendencies.join("; ")}. Confirme explicitamente para ativar assim.`,
    );
    this.name = "IncompleteActivationError";
  }
}
