import {
  CUSTOMER_BLOCKED_FOR_SALES_MESSAGE,
  CUSTOMER_INACTIVE_FOR_SALES_MESSAGE,
} from "@veridi/shared";

export class CustomerNotFoundError extends Error {
  constructor(id: string) {
    super(`Cliente não encontrado: ${id}`);
    this.name = "CustomerNotFoundError";
  }
}

export class DuplicateCnpjError extends Error {
  constructor(cnpj: string) {
    super(`CNPJ já cadastrado: ${cnpj}`);
    this.name = "DuplicateCnpjError";
  }
}

/** Ação de situação que não parte da situação atual — ex.: desbloquear quem não está bloqueado. */
export class InvalidCustomerStatusTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCustomerStatusTransitionError";
  }
}

/**
 * Operação comercial NOVA para cliente bloqueado (§95). Leva o motivo vigente:
 * quem vende precisa saber por que não pode.
 */
export class CustomerBlockedForSalesError extends Error {
  constructor(reason: string | null) {
    super(
      reason
        ? `${CUSTOMER_BLOCKED_FOR_SALES_MESSAGE} Motivo: ${reason}`
        : CUSTOMER_BLOCKED_FOR_SALES_MESSAGE,
    );
    this.name = "CustomerBlockedForSalesError";
  }
}

/** Operação comercial NOVA para cliente inativo (§95). */
export class CustomerInactiveForSalesError extends Error {
  constructor() {
    super(CUSTOMER_INACTIVE_FOR_SALES_MESSAGE);
    this.name = "CustomerInactiveForSalesError";
  }
}
