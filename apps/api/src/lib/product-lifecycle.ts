import type { ProductLifecycle } from "@prisma/client";

/**
 * Elegibilidade operacional de um Produto.
 *
 * Produto em DESENVOLVIMENTO é entidade técnica do projeto: existe para
 * formulação, estrutura de custos, cálculo e precificação — exatamente o que
 * o comercial precisa ANTES de fechar negócio. Ele não entra em pedido,
 * ordem de produção comercial, expedição ou faturamento.
 *
 * O gate vive aqui, num único lugar, e o backend é a autoridade: chamar a
 * API direto não contorna a regra.
 */
export class ProductNotOperationalError extends Error {
  constructor(identifier: string) {
    super(
      `O produto ${identifier} está em desenvolvimento e ainda não pode ser usado em operação comercial ou industrial. Aprove o projeto para liberá-lo.`,
    );
    this.name = "ProductNotOperationalError";
  }
}

export interface ProductOperationalCheck {
  code?: string;
  lifecycle: ProductLifecycle;
}

export function isProductOperational(product: ProductOperationalCheck): boolean {
  return product.lifecycle === "APPROVED";
}

/** Lança quando o produto ainda é técnico — `active` continua sendo checado por quem chama. */
export function assertProductOperational(
  product: ProductOperationalCheck,
  fallbackIdentifier: string,
): void {
  if (isProductOperational(product)) return;
  throw new ProductNotOperationalError(product.code ?? fallbackIdentifier);
}
