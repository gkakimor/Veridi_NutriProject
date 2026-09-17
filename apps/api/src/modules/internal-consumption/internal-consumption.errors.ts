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
