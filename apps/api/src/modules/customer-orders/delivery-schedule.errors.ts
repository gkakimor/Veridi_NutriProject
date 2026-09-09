export class DeliveryNotFoundError extends Error {
  constructor(id: string) {
    super(`Entrega programada não encontrada: ${id}`);
    this.name = "DeliveryNotFoundError";
  }
}

export class OrderNotSchedulableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderNotSchedulableError";
  }
}

export class UnknownDeliveryLineError extends Error {
  constructor(customerOrderLineId: string) {
    super(`Linha não pertence a este pedido: ${customerOrderLineId}`);
    this.name = "UnknownDeliveryLineError";
  }
}

export class DuplicateDeliveryLineError extends Error {
  constructor(productCode: string) {
    super(`O produto ${productCode} aparece duas vezes na mesma entrega — some as quantidades.`);
    this.name = "DuplicateDeliveryLineError";
  }
}

/**
 * O excesso é a recusa central da capacidade: prometer mais do que o Pedido
 * tem para entregar é um compromisso que a operação não pode cumprir.
 */
export class ExceedsSchedulableQuantityError extends Error {
  constructor(productCode: string, schedulable: string) {
    super(
      `Quantidade maior que o saldo disponível para programar de ${productCode} ` +
        `(restam ${schedulable}).`,
    );
    this.name = "ExceedsSchedulableQuantityError";
  }
}

export class EmptyDeliveryError extends Error {
  constructor() {
    super("Informe ao menos um produto com quantidade maior que zero.");
    this.name = "EmptyDeliveryError";
  }
}

export class DeliveryAlreadyCancelledError extends Error {
  constructor(sequence: number) {
    super(`A entrega ${sequence} já está cancelada.`);
    this.name = "DeliveryAlreadyCancelledError";
  }
}

/**
 * Entrega inteiramente atendida é histórico executado: não há saldo para
 * cancelar nem para reprogramar, e marcá-la de outro jeito reescreveria uma
 * expedição que já saiu.
 */
export class DeliveryAlreadyFulfilledError extends Error {
  constructor(sequence: number, acao: "cancelar" | "reprogramar") {
    super(
      `A entrega ${sequence} já foi inteiramente atendida e não pode ser ${acao === "cancelar" ? "cancelada" : "reprogramada"}: ` +
        "não há saldo pendente.",
    );
    this.name = "DeliveryAlreadyFulfilledError";
  }
}

/** A linha de Expedição só pode atender uma promessa do mesmo Pedido e produto. */
export class DeliveryLineMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryLineMismatchError";
  }
}

export class ExceedsScheduledQuantityError extends Error {
  constructor(productCode: string, remaining: string) {
    super(
      `Expedir ${productCode} acima do que a entrega programada prometia ` +
        `(restam ${remaining} nesta entrega).`,
    );
    this.name = "ExceedsScheduledQuantityError";
  }
}

/**
 * Separação em andamento tranca a promessa que ela está preparando.
 *
 * Cancelar ou reprogramar por baixo de um rascunho de Expedição deixaria a
 * separação apontando para uma promessa que não existe mais — e quem está
 * conferindo lote na outra tela não teria como saber. A ordem é a inversa:
 * resolver a expedição primeiro.
 */
export class DeliveryHasDraftShipmentError extends Error {
  constructor(sequence: number, shipmentCodes: string[]) {
    super(
      `Existe expedição em preparação para a entrega ${sequence} ` +
        `(${shipmentCodes.join(", ")}). Confirme ou cancele essa expedição antes de alterar a programação.`,
    );
    this.name = "DeliveryHasDraftShipmentError";
  }
}
