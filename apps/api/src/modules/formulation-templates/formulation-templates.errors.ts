import type { FormulationComponentIssueDTO } from "@veridi/shared";

/*
 * As frases daqui chegam à tela: dizem MODELO, que é o nome da capacidade em
 * português. As classes continuam `Template*` — nome interno, não texto
 * (FORMULATION-TEMPLATE-WORKBENCH-01, fatia 3).
 */

export class FormulationTemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`Modelo de formulação não encontrado: ${id}`);
    this.name = "FormulationTemplateNotFoundError";
  }
}

export class FormulationTemplateVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`Versão do modelo não encontrada: ${id}`);
    this.name = "FormulationTemplateVersionNotFoundError";
  }
}

/** Versão ativa é histórica: para mudar, cria-se uma versão nova. */
export class TemplateVersionNotDraftError extends Error {
  constructor(status: string) {
    super(
      `Só um rascunho pode ser editado — esta versão está em "${status}". Crie uma nova versão para alterar o modelo.`,
    );
    this.name = "TemplateVersionNotDraftError";
  }
}

/**
 * Um rascunho aberto por template.
 *
 * Dois rascunhos simultâneos na mesma matriz seriam duas verdades técnicas
 * em edição, e a segunda ativação apagaria em silêncio o trabalho da primeira.
 */
export class TemplateDraftAlreadyExistsError extends Error {
  constructor(versionNumber: number) {
    super(
      `Este modelo já tem a versão V${versionNumber} em rascunho. Termine ou descarte essa versão antes de criar outra.`,
    );
    this.name = "TemplateDraftAlreadyExistsError";
  }
}

/** Template sem componentes não descreve fórmula nenhuma. */
export class TemplateVersionWithoutComponentsError extends Error {
  constructor() {
    super("Adicione ao menos um componente antes de ativar esta versão do modelo.");
    this.name = "TemplateVersionWithoutComponentsError";
  }
}

/**
 * A versão do Modelo não ativa com componente que o cadastro invalidou —
 * FORMULATION-TEMPLATE-WORKBENCH-01, fatia 3.
 *
 * Ativar é o que libera a matriz para ser aplicada em produto. Um item
 * inativado, que virou produto acabado ou que perdeu a unidade compatível
 * passaria a ser copiado para toda formulação nova — e a recusa só apareceria
 * lá, na ativação de cada uma. A frase nomeia CADA item e o motivo; a lista
 * estruturada vai junto para a tela.
 */
export class TemplateComponentsNeedReviewError extends Error {
  constructor(
    readonly issues: FormulationComponentIssueDTO[],
    motivos: string,
  ) {
    super(`Não é possível ativar esta versão do modelo: componentes precisam de revisão — ${motivos}.`);
    this.name = "TemplateComponentsNeedReviewError";
  }
}

/**
 * Só versão ATIVA vira formulação de produto.
 *
 * Rascunho é trabalho em curso: usá-lo copiaria uma matriz que ninguém
 * revisou para dentro de um produto que vai ser vendido.
 */
export class TemplateVersionNotActiveError extends Error {
  constructor(status: string) {
    super(
      `Só uma versão ativa do modelo pode ser usada — esta está em "${status}".`,
    );
    this.name = "TemplateVersionNotActiveError";
  }
}

/** Template arquivado sai da biblioteca de escolha. */
export class TemplateArchivedError extends Error {
  constructor(code: string) {
    super(`O modelo ${code} está arquivado e não pode ser usado em novas formulações.`);
    this.name = "TemplateArchivedError";
  }
}

/**
 * A formulação de destino já tem trabalho dentro.
 *
 * Sobrescrever apagaria edições sem deixar rastro. O caminho é uma versão
 * nova, que preserva a anterior como história.
 */
export class FormulationNotEmptyForTemplateError extends Error {
  constructor(versionNumber: number) {
    super(
      `A versão V${versionNumber} já tem componentes. Crie uma nova versão para aplicar o modelo sem apagar o que existe.`,
    );
    this.name = "FormulationNotEmptyForTemplateError";
  }
}

/**
 * A base do Modelo não chega à Formulação na mesma grandeza física —
 * TEMPLATE-APPLY-BASE-UOM-01. A Formulação lê a base na unidade do Item
 * acabado; copiar só o número reinterpretaria a receita ("1 kg" virando
 * "1 un"). O motivo vem pronto em português, e nada é criado.
 */
export class TemplateBaseUnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateBaseUnitError";
  }
}

/** Modo PER_DOSE exige doses por embalagem — sem isso a fórmula não fecha. */
export class TemplateDosesRequiredError extends Error {
  constructor() {
    super('No modo "por dose", informe quantas doses a embalagem tem.');
    this.name = "TemplateDosesRequiredError";
  }
}
