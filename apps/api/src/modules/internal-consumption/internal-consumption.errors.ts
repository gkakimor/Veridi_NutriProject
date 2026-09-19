import {
  ITEM_TYPE_LABELS,
  dataCivilPorExtenso,
  diaDoInstantePorExtenso,
  hojeComercial,
  minutoDoDiaComercial,
} from "@veridi/shared";
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

/* ──────── Consumo de data passada × inventário (INTERNAL-CONSUMPTION-BACKDATED-AFTER-COUNT-01) ──────── */

/** A contagem que já viu a saída do material, e onde ela está. */
export interface ContagemQueViuASaida {
  /** Dia civil `AAAA-MM-DD` informado no consumo. */
  consumptionDate: string;
  itemCode: string;
  lotCode: string | null;
  stockCountId: string;
  stockCountCode: string;
  countedAt: Date;
}

/** `15/09/2026` — o dia do consumo é data civil, sem fuso. */
function diaNaFrase(diaISO: string): string {
  return dataCivilPorExtenso(new Date(`${diaISO}T00:00:00.000Z`));
}

/** `17/09/2026 às 10:32` — instante lido no fuso comercial. */
function instanteNaFrase(instante: Date): string {
  const minuto = minutoDoDiaComercial(instante);
  const hora = String(Math.floor(minuto / 60)).padStart(2, "0");
  const minutos = String(minuto % 60).padStart(2, "0");
  return `${diaDoInstantePorExtenso(instante)} às ${hora}:${minutos}`;
}

function posicaoNaFrase(contagem: ContagemQueViuASaida): string {
  return contagem.lotCode ? `${contagem.itemCode}, lote ${contagem.lotCode}` : contagem.itemCode;
}

/**
 * Contagem do MESMO dia do consumo: o dia não tem hora, e a saída pode ter sido
 * antes ou depois dela — por isso "pode já ter". Dia posterior: já viu.
 */
function mesmoDia(contagem: ContagemQueViuASaida): boolean {
  return hojeComercial(contagem.countedAt) === contagem.consumptionDate;
}

/**
 * Um inventário ENCERRADO — sessão ou Contagem rápida — reconciliou a posição
 * numa contagem do dia do consumo ou posterior: a saída já está no saldo que
 * ele deixou, e o consumo lançado agora baixaria o material de novo.
 */
export class BackdatedConsumptionAfterCountError extends Error {
  readonly contagem: ContagemQueViuASaida;
  readonly completedAt: Date | null;

  constructor(contagem: ContagemQueViuASaida, completedAt: Date | null) {
    const encerrado = completedAt ? `, encerrado em ${instanteNaFrase(completedAt)}` : "";
    const quando = mesmoDia(contagem)
      ? "é do mesmo dia do consumo e pode já ter refletido"
      : "é posterior ao dia do consumo e já refletiu";
    super(
      `Consumo com data de ${diaNaFrase(contagem.consumptionDate)} recusado: o saldo de ${posicaoNaFrase(contagem)} ` +
        `já foi reconciliado pelo inventário ${contagem.stockCountCode}${encerrado}. A contagem, de ` +
        `${instanteNaFrase(contagem.countedAt)}, ${quando} a saída do material — lançar este consumo agora ` +
        `baixaria o material duas vezes. Revise a data e a quantidade do lançamento; se o saldo estiver errado, ` +
        `faça uma nova contagem.`,
    );
    this.name = "BackdatedConsumptionAfterCountError";
    this.contagem = contagem;
    this.completedAt = completedAt;
  }
}

/**
 * A posição está num inventário AINDA ABERTO que já a contou no dia do consumo
 * ou depois: a diferença congelada daquela contagem já tem a saída, e o
 * encerramento a aplicaria por cima do consumo.
 */
export class BackdatedConsumptionInOpenCountError extends Error {
  readonly contagem: ContagemQueViuASaida;

  constructor(contagem: ContagemQueViuASaida) {
    const quando = mesmoDia(contagem)
      ? "no mesmo dia do consumo. A contagem pode já ter refletido"
      : "depois do dia do consumo. A contagem já refletiu";
    super(
      `Consumo com data de ${diaNaFrase(contagem.consumptionDate)} recusado: ${posicaoNaFrase(contagem)} está no ` +
        `inventário ${contagem.stockCountCode}, ainda aberto, e já foi contado em ${instanteNaFrase(contagem.countedAt)}, ` +
        `${quando} a saída do material, e o encerramento acertaria o saldo pela diferença — lançar este consumo ` +
        `agora baixaria o material duas vezes. Revise o lançamento e trate a diferença na revisão do inventário ` +
        `${contagem.stockCountCode}.`,
    );
    this.name = "BackdatedConsumptionInOpenCountError";
    this.contagem = contagem;
  }
}

/**
 * A gravação esperou demais por outra operação no estoque do item (trava do
 * escopo ou da posição de inventário) ou se cruzou com ela. Nada foi gravado.
 */
export class InternalConsumptionConcurrentWriteError extends Error {
  constructor() {
    super("Outra operação no estoque deste item terminou antes. Nada foi gravado; tente de novo.");
    this.name = "InternalConsumptionConcurrentWriteError";
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
