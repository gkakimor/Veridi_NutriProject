/**
 * Recusas do Calendário de Produção (PLANNING-CALENDAR-01).
 *
 * Toda regra de jornada e de exceção é recusa de NEGÓCIO, com mensagem em
 * português — nunca 500, e nunca erro cru do banco vazando para a tela.
 */

/** Jornada inválida: horário, intervalo ou dias operantes. */
export class ProductionCalendarConfigInvalidError extends Error {
  /** As recusas, na ordem em que a tela as mostra. */
  readonly problems: string[];

  constructor(problems: string[]) {
    super(problems.join(" "));
    this.name = "ProductionCalendarConfigInvalidError";
    this.problems = problems;
  }
}

/** Data que não existe no calendário, ou fora do formato `YYYY-MM-DD`. */
export class ProductionCalendarDateInvalidError extends Error {
  constructor(valor: string) {
    super(`Data inválida: ${valor}. Use uma data existente no calendário.`);
    this.name = "ProductionCalendarDateInvalidError";
  }
}

export class ProductionCalendarExceptionNotFoundError extends Error {
  constructor() {
    super("Exceção do calendário não encontrada.");
    this.name = "ProductionCalendarExceptionNotFoundError";
  }
}

/**
 * Uma exceção por data (decisão do PO).
 *
 * Cadastrar de novo a mesma data não empilha um segundo motivo e também não
 * sobrescreve o primeiro em silêncio: quem já está lá aparece na recusa, e
 * editar é uma ação consciente.
 */
export class ProductionCalendarExceptionDateTakenError extends Error {
  constructor(diaISO: string, tipoExistente: string) {
    super(
      `O dia ${diaISO} já está cadastrado como ${tipoExistente}. Edite a exceção existente em vez de cadastrar outra.`,
    );
    this.name = "ProductionCalendarExceptionDateTakenError";
  }
}
