export class ReceiptNotFoundError extends Error {
  constructor(id: string) {
    super(`Recebimento não encontrado: ${id}`);
    this.name = "ReceiptNotFoundError";
  }
}

export class PurchaseOrderNotFoundError extends Error {
  constructor(id: string) {
    super(`Ordem de compra não encontrada: ${id}`);
    this.name = "PurchaseOrderNotFoundError";
  }
}

export class InvalidPurchaseOrderStatusError extends Error {
  constructor(status: string) {
    super(`Ordem de compra com status ${status} não pode receber materiais`);
    this.name = "InvalidPurchaseOrderStatusError";
  }
}

export class PurchaseOrderLineNotFoundError extends Error {
  constructor(id: string) {
    super(`Linha de ordem de compra não encontrada: ${id}`);
    this.name = "PurchaseOrderLineNotFoundError";
  }
}

export class EmptyReceiptError extends Error {
  constructor() {
    super("Informe ao menos uma linha com quantidade recebida");
    this.name = "EmptyReceiptError";
  }
}

export class InvalidReceivedQuantityError extends Error {
  constructor(itemCode: string) {
    super(`Quantidade recebida deve ser maior que zero: ${itemCode}`);
    this.name = "InvalidReceivedQuantityError";
  }
}

export class OverReceiptError extends Error {
  constructor(itemCode: string) {
    super(`Quantidade recebida excede o saldo em aberto da linha: ${itemCode}`);
    this.name = "OverReceiptError";
  }
}

export class MissingSupplierLotError extends Error {
  constructor(itemCode: string) {
    super(`Lote do fornecedor é obrigatório para este item: ${itemCode}`);
    this.name = "MissingSupplierLotError";
  }
}

export class MissingExpiryDateError extends Error {
  constructor(itemCode: string) {
    super(`Validade é obrigatória para este item: ${itemCode}`);
    this.name = "MissingExpiryDateError";
  }
}

export class InvalidExpiryDateError extends Error {
  constructor(itemCode: string) {
    super(`Validade não pode ser anterior à data do recebimento: ${itemCode}`);
    this.name = "InvalidExpiryDateError";
  }
}

export class CustomerNotFoundError extends Error {
  constructor(id: string) {
    super(`Cliente não encontrado: ${id}`);
    this.name = "CustomerNotFoundError";
  }
}

export class InactiveCustomerError extends Error {
  constructor(id: string) {
    super(`Cliente inativo não pode enviar material: ${id}`);
    this.name = "InactiveCustomerError";
  }
}

export class ReceiptItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Item não encontrado: ${id}`);
    this.name = "ReceiptItemNotFoundError";
  }
}

export class InvalidCustomerSuppliedItemTypeError extends Error {
  constructor(code: string) {
    super(
      `Item ${code} não é matéria-prima nem embalagem — material do cliente só existe para esses tipos.`,
    );
    this.name = "InvalidCustomerSuppliedItemTypeError";
  }
}

/**
 * Material do cliente SEM controle de lote criaria saldo de terceiro
 * indistinguível do estoque próprio. Decisão de produto: bloquear o
 * recebimento em vez de aceitar um saldo que não dá para rastrear.
 */
export class CustomerMaterialRequiresLotControlError extends Error {
  constructor(code: string) {
    super(
      `Item ${code} não controla lote — material de propriedade do cliente exige controle de lote. Ative o controle de lote no cadastro do item antes de receber.`,
    );
    this.name = "CustomerMaterialRequiresLotControlError";
  }
}
