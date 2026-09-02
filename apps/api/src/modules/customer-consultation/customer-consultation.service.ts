import type {
  BillingDTO,
  CustomerConsultationSummaryDTO,
  CustomerFinishedGoodsResponse,
  CustomerFinishedGoodsRowDTO,
  CustomerOrderDTO,
  ProductDTO,
  ProjectDTO,
} from "@veridi/shared";
import { Prisma } from "@prisma/client";
import { getPrisma } from "../../db/prisma.js";
import {
  getAvailableByItems,
  getOnHandByItems,
  getReservedByItems,
} from "../../lib/inventory-ledger.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageMeta, slicePage } from "../../lib/pagination.js";
import { getBillingById } from "../billings/billings.service.js";
import { getCustomerOrderById } from "../customer-orders/customer-orders.service.js";
import { getCustomerById } from "../customers/customers.service.js";
import { CustomerNotFoundError } from "../customers/customers.errors.js";
import { getProductById } from "../products/products.service.js";
import { getProjectById } from "../projects/projects.service.js";
import { NotInThisCustomerError } from "./customer-consultation.errors.js";

/**
 * CONSULTA DO CLIENTE — leitura pura sobre o que já existe.
 *
 * Duas responsabilidades, e só elas:
 *
 * 1. o RESUMO, que conta o que o Cliente tem em cada módulo;
 * 2. o ESCOPO, que garante que um detalhe consultivo aberto sob um Cliente
 *    pertence de fato àquele Cliente.
 *
 * Nenhuma regra de domínio nasce aqui. Os detalhes reusam os mesmos serviços
 * que os módulos operacionais usam — a Consulta só decide se pode mostrar.
 * As LISTAS nem passam por aqui: os endpoints operacionais já filtram por
 * `customerId`, e criar um segundo caminho para os mesmos dados seria manter
 * duas verdades.
 */

/**
 * Pedido "em aberto": confirmado ou em atendimento, ainda não expedido por
 * completo nem cancelado. `DRAFT` conta — é pedido que ainda vai acontecer.
 * Deriva do `status` já persistido; nada de estado novo.
 */
const OPEN_ORDER_STATUSES = ["DRAFT", "CONFIRMED", "IN_FULFILLMENT", "PARTIALLY_SHIPPED"] as const;

/** 404 antes de qualquer outra coisa: sem Cliente não existe contexto. */
async function requireCustomer(customerId: string) {
  const customer = await getCustomerById(customerId);
  if (!customer) throw new CustomerNotFoundError(customerId);
  return customer;
}

export async function getConsultationSummary(
  customerId: string,
): Promise<CustomerConsultationSummaryDTO> {
  const customer = await requireCustomer(customerId);
  const prisma = getPrisma();

  /*
   * Cinco `count` em paralelo, nenhuma linha carregada para a memória. O
   * caminho ingênuo — listar projetos, pedidos, faturamentos e lotes só para
   * medir o tamanho de cada lista — traria o histórico inteiro do cliente
   * para contar cardinalidade.
   */
  const [products, projects, orders, openOrders, billings, materialLots] = await Promise.all([
    prisma.product.count({ where: { customerId } }),
    prisma.project.count({ where: { customerId } }),
    prisma.customerOrder.count({ where: { customerId } }),
    prisma.customerOrder.count({
      where: { customerId, status: { in: [...OPEN_ORDER_STATUSES] } },
    }),
    prisma.billing.count({ where: { customerOrder: { customerId } } }),
    prisma.lot.count({ where: { ownerType: "CUSTOMER", ownerCustomerId: customerId } }),
  ]);

  return {
    customer,
    counts: { products, projects, orders, openOrders, billings, materialLots },
  };
}

/**
 * O ID da URL nunca basta.
 *
 * `/consultas/clientes/CLI-A/projetos/PROJ-B` é um endereço perfeitamente
 * bem formado, e PROJ-B pode existir — pertencendo ao Cliente B. Sem esta
 * conferência o cabeçalho diria "Cliente A" sobre o projeto de outro.
 */
export async function getScopedProject(
  customerId: string,
  projectId: string,
): Promise<ProjectDTO> {
  await requireCustomer(customerId);
  const project = await getProjectById(projectId);
  if (!project) throw new NotInThisCustomerError("Projeto", projectId, customerId);
  if (project.customerId !== customerId) {
    throw new NotInThisCustomerError("Projeto", projectId, customerId);
  }
  return project;
}

export async function getScopedProduct(
  customerId: string,
  productId: string,
): Promise<ProductDTO> {
  await requireCustomer(customerId);
  const product = await getProductById(productId);
  if (!product) throw new NotInThisCustomerError("Produto", productId, customerId);
  if (product.customerId !== customerId) {
    throw new NotInThisCustomerError("Produto", productId, customerId);
  }
  return product;
}

export async function getScopedCustomerOrder(
  customerId: string,
  orderId: string,
): Promise<CustomerOrderDTO> {
  await requireCustomer(customerId);
  const order = await getCustomerOrderById(orderId);
  if (!order) throw new NotInThisCustomerError("Pedido", orderId, customerId);
  if (order.customerId !== customerId) {
    throw new NotInThisCustomerError("Pedido", orderId, customerId);
  }
  return order;
}

/**
 * O Faturamento não tem coluna de cliente própria — ele o herda do Pedido de
 * origem, que é onde o vínculo real está. `BillingDTO.customerId` já vem
 * dessa relação, então o escopo confere a MESMA fonte que o módulo de
 * Faturamento usa, não uma leitura paralela do snapshot.
 */
export async function getScopedBilling(
  customerId: string,
  billingId: string,
): Promise<BillingDTO> {
  await requireCustomer(customerId);
  const billing = await getBillingById(billingId);
  if (!billing) throw new NotInThisCustomerError("Faturamento", billingId, customerId);
  if (billing.customerId !== customerId) {
    throw new NotInThisCustomerError("Faturamento", billingId, customerId);
  }
  return billing;
}

/**
 * Estoque de PRODUTO ACABADO do Cliente.
 *
 * São os itens de produto acabado dos Produtos daquele Cliente — cada
 * Produto tem o seu, 1:1. Não é material do Cliente: produto acabado é
 * estoque da Veridi até ser expedido. E não entra matéria-prima aqui de
 * propósito: MP da Veridi é da Veridi, e mostrá-la sob o cabeçalho de um
 * Cliente afirmaria que pertence a ele.
 *
 * As somas vêm do inventory ledger — as MESMAS funções que o resto do
 * sistema usa. Recalcular físico/reservado/disponível aqui criaria um
 * segundo número para a mesma pergunta.
 */
export async function getCustomerFinishedGoods(
  customerId: string,
  pagination: Pagination,
): Promise<CustomerFinishedGoodsResponse> {
  await requireCustomer(customerId);
  const prisma = getPrisma();

  const produtos = await prisma.product.findMany({
    where: { customerId, finishedProductItemId: { not: null } },
    include: { finishedProductItem: true },
    orderBy: { code: "asc" },
  });

  const itens = produtos
    .map((produto) => produto.finishedProductItem)
    .filter((item): item is NonNullable<typeof item> => item !== null);
  const itemIds = itens.map((item) => item.id);

  // Três consultas para a lista inteira, não três por produto.
  const [onHandByItem, reservedByItem, availableByItem, lotes] = await Promise.all([
    getOnHandByItems(prisma, itemIds),
    getReservedByItems(prisma, itemIds),
    getAvailableByItems(prisma, itens),
    itemIds.length > 0
      ? prisma.lot.groupBy({
          by: ["itemId", "status"],
          where: { itemId: { in: itemIds } },
          _count: { _all: true },
        })
      : [],
  ]);

  const zero = new Prisma.Decimal(0);
  const rows: CustomerFinishedGoodsRowDTO[] = produtos.flatMap((produto) => {
    const item = produto.finishedProductItem;
    if (!item) return [];
    const doItem = lotes.filter((linha) => linha.itemId === item.id);
    return [
      {
        productId: produto.id,
        productCode: produto.code,
        productName: produto.name,
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        unitCode: item.unitCode,
        onHand: (onHandByItem.get(item.id) ?? zero).toString(),
        reserved: (reservedByItem.get(item.id) ?? zero).toString(),
        available: (availableByItem.get(item.id) ?? zero).toString(),
        lotCount: doItem.reduce((total, linha) => total + linha._count._all, 0),
        awaitingQualityLots: doItem
          .filter((linha) => linha.status === "AWAITING_RELEASE")
          .reduce((total, linha) => total + linha._count._all, 0),
      },
    ];
  });

  return { rows: slicePage(rows, pagination), ...pageMeta(pagination, rows.length) };
}
