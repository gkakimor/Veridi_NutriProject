import { ITEM_TYPE_LABELS } from "@veridi/shared";
import type { ItemType } from "@veridi/shared";

export class InternalConsumptionItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Item não encontrado: ${id}`);
    this.name = "InternalConsumptionItemNotFoundError";
  }
}

/**
 * Lista de PERMISSÃO — ver `ITEM_TYPES_DO_CONSUMO_INTERNO` no shared.
 *
 * A mensagem diz o tipo recusado porque o operador escolhe pelo nome do item,
 * não pelo tipo: "MP-000012 não sai por consumo interno" sem dizer que ele é
 * matéria-prima obrigaria a abrir o cadastro para entender a recusa.
 */
export class InvalidInternalConsumptionItemTypeError extends Error {
  constructor(itemCode: string, type: ItemType) {
    super(
      `Somente item de uso e consumo sai por consumo interno: ${itemCode} é ${ITEM_TYPE_LABELS[type]}.`,
    );
    this.name = "InvalidInternalConsumptionItemTypeError";
  }
}

export class MissingInternalConsumptionLotError extends Error {
  constructor(itemCode: string) {
    super(`Item controla lote — informe o lote: ${itemCode}`);
    this.name = "MissingInternalConsumptionLotError";
  }
}

export class UnexpectedInternalConsumptionLotError extends Error {
  constructor(itemCode: string) {
    super(`Item não controla lote — não informe um lote: ${itemCode}`);
    this.name = "UnexpectedInternalConsumptionLotError";
  }
}

export class InternalConsumptionLotNotFoundError extends Error {
  constructor(lotId: string) {
    super(`Lote não encontrado: ${lotId}`);
    this.name = "InternalConsumptionLotNotFoundError";
  }
}

/** Qualidade, validade e CoA valem igual — não existe bypass "porque é interno". */
export class LotNotEligibleForInternalConsumptionError extends Error {
  constructor(lotCode: string) {
    super(`Lote não está disponível para uso: ${lotCode}`);
    this.name = "LotNotEligibleForInternalConsumptionError";
  }
}

/**
 * Material de cliente nunca vira consumo interno da Veridi: seria a fábrica
 * gastando estoque de terceiro e registrando a despesa como própria.
 */
export class CustomerOwnedLotNotAllowedError extends Error {
  constructor(lotCode: string) {
    super(`Lote de material de cliente não sai por consumo interno: ${lotCode}`);
    this.name = "CustomerOwnedLotNotAllowedError";
  }
}

export class InsufficientInternalConsumptionStockError extends Error {
  constructor(escopo: string, disponivel: string) {
    super(`Quantidade excede o saldo disponível (${disponivel}): ${escopo}`);
    this.name = "InsufficientInternalConsumptionStockError";
  }
}

/** Consumo é registro do que JÁ aconteceu — data futura seria previsão. */
export class FutureInternalConsumptionDateError extends Error {
  constructor(dia: string) {
    super(`Data de consumo no futuro: ${dia}. Registre o consumo depois que ele acontecer.`);
    this.name = "FutureInternalConsumptionDateError";
  }
}

/* ─────────────── Estorno (INTERNAL-CONSUMPTION-REVERSAL-01) ─────────────── */

/** Decimal do domínio na frase, com vírgula — nunca `Number`. */
function quantidadeNaFrase(valor: string): string {
  return valor.replace(".", ",");
}

export class InternalConsumptionNotFoundError extends Error {
  constructor() {
    super("Consumo interno não encontrado.");
    this.name = "InternalConsumptionNotFoundError";
  }
}

/** Tudo já estornado: não há o que devolver. */
export class NothingToReverseError extends Error {
  constructor() {
    super("Não há quantidade a estornar.");
    this.name = "NothingToReverseError";
  }
}

export class ReversalExceedsBalanceError extends Error {
  constructor(consumoCode: string, pedido: string, saldo: string) {
    super(
      `Quantidade a estornar (${quantidadeNaFrase(pedido)}) maior que o saldo estornável de ${consumoCode} (${quantidadeNaFrase(saldo)}).`,
    );
    this.name = "ReversalExceedsBalanceError";
  }
}

/**
 * O "já estornado" mudou entre a tela e o confirmar — duplo clique, outra aba
 * ou outra pessoa. Nada foi gravado; quem estorna decide vendo o número atual.
 */
export class ReversalStateChangedError extends Error {
  constructor(
    consumoCode: string,
    readonly shown: string,
    readonly current: string,
  ) {
    super(
      `O consumo ${consumoCode} mudou desde que você abriu: o já estornado era ${quantidadeNaFrase(shown)} e agora é ${quantidadeNaFrase(current)}. Confira antes de estornar.`,
    );
    this.name = "ReversalStateChangedError";
  }
}

/**
 * A posição está num Inventário Físico aberto: a contagem dele vai acertar o
 * saldo, e o estorno somaria a mesma correção de novo.
 */
export class ReversalPositionInOpenCountError extends Error {
  constructor(
    consumoCode: string,
    readonly stockCountCode: string,
  ) {
    super(
      `A posição de ${consumoCode} está no inventário ${stockCountCode}, ainda aberto. A contagem dele vai acertar o saldo: estornar agora corrigiria duas vezes. Registre a contagem lá.`,
    );
    this.name = "ReversalPositionInOpenCountError";
  }
}

/**
 * A posição foi contada DEPOIS do registro do consumo: o saldo esperado da
 * contagem já tinha a baixa, e o ajuste já absorveu o erro.
 */
export class ReversalPositionCountedAfterConsumptionError extends Error {
  constructor(
    consumoCode: string,
    readonly stockCountCode: string,
  ) {
    super(
      `A posição de ${consumoCode} foi contada no inventário ${stockCountCode} depois do registro do consumo: a contagem já acertou o saldo, e estornar agora corrigiria duas vezes.`,
    );
    this.name = "ReversalPositionCountedAfterConsumptionError";
  }
}

/** Duas escritas no mesmo consumo se cruzaram; nada foi gravado pela segunda. */
export class ReversalConcurrentWriteError extends Error {
  constructor() {
    super("Outra operação neste consumo terminou antes. Recarregue e tente de novo.");
    this.name = "ReversalConcurrentWriteError";
  }
}
