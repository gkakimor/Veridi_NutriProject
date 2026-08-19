export class FormulationTemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`Template de formulação não encontrado: ${id}`);
    this.name = "FormulationTemplateNotFoundError";
  }
}

export class FormulationTemplateVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`Versão de template não encontrada: ${id}`);
    this.name = "FormulationTemplateVersionNotFoundError";
  }
}

/** Versão ativa é histórica: para mudar, cria-se uma versão nova. */
export class TemplateVersionNotDraftError extends Error {
  constructor(status: string) {
    super(
      `Só um rascunho pode ser editado — esta versão está em "${status}". Crie uma nova versão para alterar o template.`,
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
      `Este template já tem a versão V${versionNumber} em rascunho. Termine ou descarte essa versão antes de criar outra.`,
    );
    this.name = "TemplateDraftAlreadyExistsError";
  }
}

/** Template sem componentes não descreve fórmula nenhuma. */
export class TemplateVersionWithoutComponentsError extends Error {
  constructor() {
    super("Adicione ao menos um componente antes de ativar esta versão do template.");
    this.name = "TemplateVersionWithoutComponentsError";
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
      `Só uma versão ativa do template pode ser usada — esta está em "${status}".`,
    );
    this.name = "TemplateVersionNotActiveError";
  }
}

/** Template arquivado sai da biblioteca de escolha. */
export class TemplateArchivedError extends Error {
  constructor(code: string) {
    super(`O template ${code} está arquivado e não pode ser usado em novas formulações.`);
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
      `A versão V${versionNumber} já tem componentes. Crie uma nova versão para aplicar o template sem apagar o que existe.`,
    );
    this.name = "FormulationNotEmptyForTemplateError";
  }
}

/** Modo PER_DOSE exige doses por embalagem — sem isso a fórmula não fecha. */
export class TemplateDosesRequiredError extends Error {
  constructor() {
    super('No modo "por dose", informe quantas doses a embalagem tem.');
    this.name = "TemplateDosesRequiredError";
  }
}
