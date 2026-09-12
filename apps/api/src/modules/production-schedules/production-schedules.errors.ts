/**
 * Recusas da programação de uma Ordem de Produção
 * (PLANNING-CAPACITY-BOARD-01).
 *
 * Todas são regra de negócio, e todas dizem o que falta em português. Nenhuma
 * delas "conserta" a entrada: deslocar um início inválido em silêncio faria a
 * pessoa programar um turno e descobrir outro.
 */

export class ProductionOrderNotFoundError extends Error {
  constructor(id: string) {
    super(`Ordem de produção não encontrada: ${id}`);
    this.name = "ProductionOrderNotFoundError";
  }
}

/** Sem roteiro copiado não há etapa para posicionar no tempo. */
export class ProductionOrderWithoutRouteError extends Error {
  constructor(code: string) {
    super(
      `${code} não tem roteiro de produção aplicado: sem etapas não há o que programar. Aplique o roteiro na própria ordem.`,
    );
    this.name = "ProductionOrderWithoutRouteError";
  }
}

/** O calendário ainda não sabe ONDE fica o intervalo — fail-closed. */
export class CalendarBreakNotPositionedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarBreakNotPositionedError";
  }
}

/** O calendário nunca foi salvo: não há jornada para projetar nada. */
export class CalendarNotConfiguredError extends Error {
  constructor() {
    super(
      "O calendário de produção ainda não foi configurado. Defina a jornada da fábrica antes de programar ordens.",
    );
    this.name = "CalendarNotConfiguredError";
  }
}

/**
 * O início escolhido não cai numa janela de trabalho.
 *
 * Carrega a SUGESTÃO junto: a tela oferece "usar este horário" como ação
 * explícita, e quem decide continua sendo a pessoa.
 */
export class ScheduleStartNotOperationalError extends Error {
  constructor(
    message: string,
    readonly suggestionAt: string | null,
  ) {
    super(message);
    this.name = "ScheduleStartNotOperationalError";
  }
}

/** Mover a agenda de uma ordem liberada é decisão, não ajuste. */
export class ScheduleNeedsConfirmationError extends Error {
  constructor(code: string) {
    super(
      `${code} já foi liberada para produção: confirme explicitamente para mover a programação dela.`,
    );
    this.name = "ScheduleNeedsConfirmationError";
  }
}

/** Situação em que a agenda é histórico, e histórico não se reescreve. */
export class ScheduleLockedError extends Error {
  constructor(code: string, situacao: string) {
    super(
      `${code} está ${situacao}: a programação vira referência histórica e não é mais alterada aqui.`,
    );
    this.name = "ScheduleLockedError";
  }
}

export class ScheduleNotFoundError extends Error {
  constructor(code: string) {
    super(`${code} ainda não tem programação definida.`);
    this.name = "ScheduleNotFoundError";
  }
}
