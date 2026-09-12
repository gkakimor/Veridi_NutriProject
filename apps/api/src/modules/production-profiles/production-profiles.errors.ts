import { TEMPLATE_VERSION_STATUS_LABELS } from "@veridi/shared";
import type { TemplateVersionStatus } from "@veridi/shared";

/** Perfil de Produção — recusas de domínio (`PRODUCT_RULES.md` §89). */

const situacao = (status: string) =>
  TEMPLATE_VERSION_STATUS_LABELS[status as TemplateVersionStatus] ?? status;

export class ProductionProfileNotFoundError extends Error {
  constructor(id: string) {
    super(`Perfil de Produção não encontrado: ${id}`);
    this.name = "ProductionProfileNotFoundError";
  }
}

export class ProductionProfileVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`Versão de Perfil de Produção não encontrada: ${id}`);
    this.name = "ProductionProfileVersionNotFoundError";
  }
}

export class ProductionProfileProductNotFoundError extends Error {
  constructor(id: string) {
    super(`Produto não encontrado: ${id}`);
    this.name = "ProductionProfileProductNotFoundError";
  }
}

/** Versão ativa é congelada: mudar o roteiro exige versão nova. */
export class ProductionProfileVersionNotDraftError extends Error {
  constructor(status: string) {
    super(
      `Só um rascunho pode ser editado — esta versão está "${situacao(status)}". Crie uma nova versão para alterar.`,
    );
    this.name = "ProductionProfileVersionNotDraftError";
  }
}

/**
 * Um rascunho por perfil: dois seriam duas verdades em edição, e a segunda
 * ativação apagaria em silêncio o trabalho da primeira.
 */
export class ProductionProfileDraftExistsError extends Error {
  constructor(versionNumber: number) {
    super(
      `Já existe a versão V${versionNumber} em rascunho. Termine essa versão antes de criar outra.`,
    );
    this.name = "ProductionProfileDraftExistsError";
  }
}

/** Perfil sem etapa não descreve como produzir nada. */
export class ProductionProfileEmptyError extends Error {
  constructor() {
    super("Adicione ao menos uma etapa antes de ativar esta versão.");
    this.name = "ProductionProfileEmptyError";
  }
}

/** Energia não ocupa capacidade: ela continua no custo (Estrutura de Custos). */
export class CapacityResourceNotAllowedError extends Error {
  constructor(resourceName: string) {
    super(
      `${resourceName} é energia e não entra em etapa: energia não é recurso de capacidade — continua no custo, na Estrutura de Custos.`,
    );
    this.name = "CapacityResourceNotAllowedError";
  }
}

export class StepResourceNotFoundError extends Error {
  constructor(id: string) {
    super(`Recurso industrial não encontrado: ${id}`);
    this.name = "StepResourceNotFoundError";
  }
}

export class StepResourceInactiveError extends Error {
  constructor(resourceName: string) {
    super(
      `${resourceName} está inativo e não pode ser planejado numa etapa. Troque o recurso ou reative o cadastro.`,
    );
    this.name = "StepResourceInactiveError";
  }
}

/** Uma linha por recurso na etapa: quantos iguais é a quantidade de recursos. */
export class DuplicateStepResourceError extends Error {
  constructor(stepName: string, resourceName: string) {
    super(
      `A etapa "${stepName}" lista ${resourceName} duas vezes. Use uma linha só, com a quantidade de recursos.`,
    );
    this.name = "DuplicateStepResourceError";
  }
}

export class ProductionProfileUomNotFoundError extends Error {
  constructor(code: string) {
    super(`Unidade de medida desconhecida: ${code}`);
    this.name = "ProductionProfileUomNotFoundError";
  }
}

/** Só versão ATIVA vira padrão de produto — rascunho ainda muda. */
export class ProductionProfileVersionNotActiveError extends Error {
  constructor(status: string) {
    super(
      `Só uma versão ativa pode ser o Roteiro de Produção padrão de um produto — esta está "${situacao(status)}".`,
    );
    this.name = "ProductionProfileVersionNotActiveError";
  }
}

/** Sem item de produto acabado o produto não tem unidade para comparar. */
export class ProductWithoutUnitError extends Error {
  constructor(productCode: string) {
    super(
      `${productCode} não tem item de produto acabado: sem a unidade do produto não há como conferir a quantidade de referência do roteiro.`,
    );
    this.name = "ProductWithoutUnitError";
  }
}

/** Base do perfil e produto em dimensões diferentes: nada se converte. */
export class ProductionProfileUomIncompatibleError extends Error {
  constructor(profileUom: string, productUom: string) {
    super(
      `A quantidade de referência do roteiro está em ${profileUom} e o produto é controlado em ${productUom}: unidades de dimensões diferentes não se convertem.`,
    );
    this.name = "ProductionProfileUomIncompatibleError";
  }
}
