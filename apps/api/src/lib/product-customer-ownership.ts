import type { Prisma, PrismaClient } from "@prisma/client";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/**
 * Inconsistência de cliente: o Produto pertence a um cliente e o documento a
 * outro. Nunca se escolhe um "vencedor" silencioso — sem cliente inequívoco
 * não se pode usar material de propriedade do cliente.
 *
 * Mora aqui, e não num módulo, porque a mesma semântica é recusada em vários
 * boundaries (Pedido, Ordem de Produção, proposta → Pedido). `production-orders`
 * reexporta esta classe: quem já a importava de lá continua funcionando, e
 * `instanceof` continua sendo o mesmo tipo em todos os pontos de captura.
 */
export class CustomerMismatchError extends Error {
  constructor(productCustomer: string, orderCustomer: string) {
    super(
      `Cliente inconsistente: o produto pertence a ${productCustomer} e o pedido a ${orderCustomer}.`,
    );
    this.name = "CustomerMismatchError";
  }
}

export interface ProductOwnership {
  customerId: string | null;
}

/**
 * O Produto pode entrar num documento deste Cliente?
 *
 * Produto SEM cliente não é inconsistência. A base traz produtos importados do
 * legado sem dono resolvido, e tanto `resolveOrderCustomerId` quanto o vínculo
 * de Produto a Projeto sempre os aceitaram. Recusá-los aqui mudaria o modelo de
 * Product, que é outra capacidade — não esta.
 */
export function productBelongsToCustomer(
  product: ProductOwnership,
  customerId: string,
): boolean {
  return product.customerId === null || product.customerId === customerId;
}

/**
 * Recusa a mistura de propriedade entre clientes, com o nome dos dois na
 * mensagem. O dono do Produto só é consultado no caminho de falha — em
 * operação normal esta função não faz consulta nenhuma.
 */
export async function assertProductBelongsToCustomer(
  prisma: PrismaOrTx,
  product: ProductOwnership,
  orderCustomer: { id: string; legalName: string },
): Promise<void> {
  if (productBelongsToCustomer(product, orderCustomer.id)) return;
  const owner = await prisma.customer.findUnique({ where: { id: product.customerId! } });
  throw new CustomerMismatchError(
    owner?.legalName ?? product.customerId!,
    orderCustomer.legalName,
  );
}
