export class ProductNotFoundError extends Error {
  constructor(id: string) {
    super(`Produto não encontrado: ${id}`);
    this.name = "ProductNotFoundError";
  }
}

export class InactiveProductError extends Error {
  constructor(id: string) {
    super(`Produto inativo não pode ser usado em uma Ordem de Produção: ${id}`);
    this.name = "InactiveProductError";
  }
}

export class MissingFinishedItemError extends Error {
  constructor() {
    super("Produto precisa de um item de produto acabado válido antes de gerar uma Ordem de Produção");
    this.name = "MissingFinishedItemError";
  }
}

export class FormulationVersionNotFoundError extends Error {
  constructor(id: string) {
    super(`Versão de formulação não encontrada: ${id}`);
    this.name = "FormulationVersionNotFoundError";
  }
}

export class FormulationVersionProductMismatchError extends Error {
  constructor(versionId: string, productId: string) {
    super(`Versão de formulação ${versionId} não pertence ao produto ${productId}`);
    this.name = "FormulationVersionProductMismatchError";
  }
}

export class ProductionOrderNotFoundError extends Error {
  constructor(id: string) {
    super(`Ordem de produção não encontrada: ${id}`);
    this.name = "ProductionOrderNotFoundError";
  }
}

export class InvalidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransitionError";
  }
}

export class OrderLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderLockedError";
  }
}

/** Reúne todas as falhas do gate de planejamento (seção 21 do handoff) numa mensagem só. */
export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}

/** Reúne todas as falhas do gate de RELEASE (shortage por Requirement) numa mensagem só. */
export class ReleaseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseValidationError";
  }
}

/**
 * Inconsistência de cliente: o Produto pertence a um cliente e o Pedido a
 * outro. Nunca se escolhe um "vencedor" silencioso — sem cliente
 * inequívoco não se pode usar material de propriedade do cliente.
 *
 * A classe passou a morar em `lib/product-customer-ownership.ts` quando o
 * Pedido do Cliente ganhou a mesma recusa: a semântica é uma só, então o
 * tipo também. Reexportada daqui para quem já a importava deste módulo.
 */
export { CustomerMismatchError } from "../../lib/product-customer-ownership.js";

/**
 * Pediram o roteiro padrão atual numa OP cujo Produto não tem padrão ativo. A
 * saída é escolher um roteiro para a ordem — ou definir o padrão no Produto.
 */
export class NoDefaultProductionProfileError extends Error {
  constructor(productCode: string) {
    super(
      `O produto ${productCode} não tem roteiro de produção padrão ativo. Escolha um roteiro para esta ordem.`,
    );
    this.name = "NoDefaultProductionProfileError";
  }
}

/** Sem roteiro a ordem existe, mas não planeja e não libera (§89). */
export class RouteRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteRequiredError";
  }
}

/** Trocar um roteiro já aplicado, ou regularizar legado, pede motivo. */
export class RouteReasonRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteReasonRequiredError";
  }
}

/** Ordem PLANNED/RELEASED sem roteiro: aplicar é regularização, e isso se confirma. */
export class LegacyRouteRepairNeedsConfirmationError extends Error {
  constructor(orderCode: string) {
    super(
      `${orderCode} já saiu do rascunho sem roteiro de produção. Confirme a regularização e informe o motivo.`,
    );
    this.name = "LegacyRouteRepairNeedsConfirmationError";
  }
}

/** A ordem tem programação, e aplicar o roteiro a remove. */
export class ScheduleRemovalNeedsConfirmationError extends Error {
  constructor() {
    super(
      "Alterar o roteiro removerá a programação atual desta ordem, pois tempos e recursos podem mudar. Confirme para continuar.",
    );
    this.name = "ScheduleRemovalNeedsConfirmationError";
  }
}

/** Outra pessoa mudou o roteiro desta ordem enquanto a tela estava aberta. */
export class ProductionRouteChangedError extends Error {
  constructor(orderCode: string) {
    super(
      `O roteiro de ${orderCode} mudou enquanto a tela estava aberta. Recarregue a ordem antes de aplicar.`,
    );
    this.name = "ProductionRouteChangedError";
  }
}
