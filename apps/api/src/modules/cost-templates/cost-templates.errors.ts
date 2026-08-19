export class CostTemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`Template de estrutura não encontrado: ${id}`);
    this.name = "CostTemplateNotFoundError";
  }
}

export class CostTemplateVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`Versão de template de estrutura não encontrada: ${id}`);
    this.name = "CostTemplateVersionNotFoundError";
  }
}

export class PricingPolicyNotFoundError extends Error {
  constructor(id: string) {
    super(`Política de precificação não encontrada: ${id}`);
    this.name = "PricingPolicyNotFoundError";
  }
}

export class PricingPolicyVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`Versão de política não encontrada: ${id}`);
    this.name = "PricingPolicyVersionNotFoundError";
  }
}

/** Versão ativa é histórica: para mudar, cria-se uma versão nova. */
export class TemplateNotDraftError extends Error {
  constructor(status: string) {
    super(
      `Só um rascunho pode ser editado — esta versão está em "${status}". Crie uma nova versão para alterar.`,
    );
    this.name = "TemplateNotDraftError";
  }
}

/**
 * Um rascunho aberto por matriz.
 *
 * Dois rascunhos simultâneos seriam duas verdades em edição, e a segunda
 * ativação apagaria em silêncio o trabalho da primeira.
 */
export class TemplateDraftExistsError extends Error {
  constructor(versionNumber: number) {
    super(
      `Já existe a versão V${versionNumber} em rascunho. Termine ou descarte essa versão antes de criar outra.`,
    );
    this.name = "TemplateDraftExistsError";
  }
}

/** Só versão ATIVA vira documento operacional. */
export class TemplateNotActiveError extends Error {
  constructor(status: string) {
    super(`Só uma versão ativa pode ser usada — esta está em "${status}".`);
    this.name = "TemplateNotActiveError";
  }
}

export class TemplateArchivedForUseError extends Error {
  constructor(code: string) {
    super(`${code} está arquivado e não pode ser usado em novos documentos.`);
    this.name = "TemplateArchivedForUseError";
  }
}

/** Estrutura sem recurso nem premissa não descreve configuração nenhuma. */
export class CostTemplateEmptyError extends Error {
  constructor() {
    super(
      "Adicione ao menos um recurso industrial ou uma premissa de custo antes de ativar esta versão.",
    );
    this.name = "CostTemplateEmptyError";
  }
}

/** Política sem faixa não descreve política nenhuma. */
export class PricingPolicyEmptyError extends Error {
  constructor() {
    super("Adicione ao menos uma faixa de quantidade antes de ativar esta política.");
    this.name = "PricingPolicyEmptyError";
  }
}

/**
 * Energia derivada exige um recurso de energia declarado.
 *
 * Escolher sozinho entre vários cadastros seria inventar premissa econômica —
 * a mesma regra que a estrutura operacional já aplica.
 */
export class CostTemplateEnergyResourceRequiredError extends Error {
  constructor() {
    super(
      'No modo "derivada dos equipamentos", informe qual recurso de energia valoriza o consumo.',
    );
    this.name = "CostTemplateEnergyResourceRequiredError";
  }
}

/** Aplicar política exige base de custo — o preço nasce dela. */
export class PricingPolicyCalculationRequiredError extends Error {
  constructor() {
    super(
      "Escolha o cálculo de custo que serve de base: o preço de cada faixa nasce do custo deste produto.",
    );
    this.name = "PricingPolicyCalculationRequiredError";
  }
}

/**
 * Já existe um rascunho de estrutura COM configuração neste produto.
 *
 * O domínio admite um rascunho de estrutura por produto — a mesma regra que
 * impede duas versões em edição ao mesmo tempo. Aplicar o template aqui teria
 * de sobrescrever esse rascunho, apagando o que alguém montou sem deixar
 * rastro. Ativar ou descartar é decisão de quem está trabalhando nele.
 */
export class CostDraftInUseError extends Error {
  constructor(code: string) {
    super(
      `A estrutura ${code} já está em rascunho com configuração própria. Ative-a ou descarte antes de aplicar um template — aplicar agora sobrescreveria o que já foi montado.`,
    );
    this.name = "CostDraftInUseError";
  }
}
