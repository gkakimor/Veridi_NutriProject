import type {
  BillingDTO,
  CustomerConsultationSummaryDTO,
  CustomerFinishedGoodsResponse,
  CustomerFinishedGoodsRowDTO,
  CustomerOrderDTO,
  CustomerProductionOrderRowDTO,
  CustomerProductionOrdersResponse,
  LotStatus,
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
import { OPEN_PRODUCTION_ORDER_STATUSES } from "../dashboard/dashboard.queries.js";
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
  const [
    products,
    projects,
    orders,
    openOrders,
    billings,
    materialLots,
    productionOrders,
    openProductionOrders,
  ] = await Promise.all([
    prisma.product.count({ where: { customerId } }),
    prisma.project.count({ where: { customerId } }),
    prisma.customerOrder.count({ where: { customerId } }),
    prisma.customerOrder.count({
      where: { customerId, status: { in: [...OPEN_ORDER_STATUSES] } },
    }),
    prisma.billing.count({ where: { customerOrder: { customerId } } }),
    prisma.lot.count({ where: { ownerType: "CUSTOMER", ownerCustomerId: customerId } }),
    prisma.productionOrder.count({ where: { customerId } }),
    prisma.productionOrder.count({
      where: { customerId, status: { in: [...OPEN_PRODUCTION_ORDER_STATUSES] } },
    }),
  ]);

  return {
    customer,
    counts: {
      products,
      projects,
      orders,
      openOrders,
      billings,
      materialLots,
      productionOrders,
      openProductionOrders,
    },
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

/**
 * ORDENS DE PRODUÇÃO de um Cliente — a única lista com read model próprio,
 * junto com Produto Acabado.
 *
 * As outras abas reusam o endpoint operacional, que já filtra por
 * `customerId` e já pagina. Produção não cabe nesse padrão por duas razões
 * medidas, não estimadas:
 *
 * 1. `GET /production-orders` não aceita `customerId` — filtra por busca,
 *    situação e produto, e mais nada;
 * 2. o DTO operacional dispara **548 consultas para uma página de 25**. Ele
 *    monta necessidade de material, reserva, consumo e sugestão de lote —
 *    a conta que decide se dá para LIBERAR a ordem, feita por requirement,
 *    em `await` sequencial. A pergunta desta aba é outra, e responder a ela
 *    com aquela conta tornaria a aba cara demais para existir.
 *
 * A forma abaixo custa **quatro consultas por página**, independente do
 * tamanho dela: as ordens, a soma dos apontamentos, os lotes e o total.
 *
 * ## O filtro é `customerId` da própria ordem
 *
 * É FK real e indexada, resolvida na escrita por `resolveOrderCustomerId`,
 * que recusa gravar quando o cliente do produto discorda do cliente do
 * pedido. Os outros caminhos foram medidos e descartados: via Produto a
 * cobertura é idêntica e não recupera uma linha sequer; via Pedido alcança
 * um oitavo das ordens, deixando de fora toda a produção sem pedido.
 *
 * Ordem sem cliente não aparece aqui, e isso é a maioria delas hoje. É o
 * comportamento correto — mostrar sob o cabeçalho de um Cliente uma ordem
 * que não é dele seria pior que não mostrar nada.
 */
export async function getCustomerProductionOrders(
  customerId: string,
  pagination: Pagination,
): Promise<CustomerProductionOrdersResponse> {
  await requireCustomer(customerId);
  const prisma = getPrisma();

  const where = { customerId };
  const skip = pagination === "ALL" ? undefined : (pagination.page - 1) * pagination.pageSize;
  const take = pagination === "ALL" ? undefined : pagination.pageSize;

  const [ordens, total] = await Promise.all([
    prisma.productionOrder.findMany({
      where,
      // Um nível, e só o que a linha mostra. `include` do módulo operacional
      // traz dez relações, entre elas reserva e consumo com item e lote.
      include: {
        product: { select: { id: true, code: true, name: true } },
        customerOrder: { select: { id: true, code: true } },
      },
      // Mais recente primeiro: quem abre a aba quer saber o que está
      // acontecendo agora, não o que aconteceu em março.
      orderBy: { createdAt: "desc" },
      ...(skip === undefined ? {} : { skip }),
      ...(take === undefined ? {} : { take }),
    }),
    prisma.productionOrder.count({ where }),
  ]);

  const ids = ordens.map((ordem) => ordem.id);

  /*
   * Produzido é SOMA de apontamentos, nunca uma segunda coluna mantida à
   * mão — o schema diz isso explicitamente. Um `groupBy` resolve a página
   * inteira; somar por ordem daria uma consulta por linha, que é
   * exatamente o padrão que esta aba existe para não repetir.
   */
  const [apontamentos, lotes] = await Promise.all([
    ids.length > 0
      ? prisma.productionOutput.groupBy({
          by: ["productionOrderId"],
          where: { productionOrderId: { in: ids } },
          _sum: { quantity: true },
        })
      : [],
    ids.length > 0
      ? prisma.lot.findMany({
          where: { productionOrderId: { in: ids } },
          select: {
            id: true,
            code: true,
            businessLotNumber: true,
            status: true,
            productionOrderId: true,
          },
          orderBy: { code: "asc" },
        })
      : [],
  ]);

  const produzidoPorOrdem = new Map(
    apontamentos.map((linha) => [linha.productionOrderId, linha._sum.quantity]),
  );

  const rows: CustomerProductionOrderRowDTO[] = ordens.map((ordem) =>
    montarLinha(ordem, produzidoPorOrdem.get(ordem.id) ?? null, lotes),
  );

  return { rows, ...pageMeta(pagination, total) };
}

/**
 * A ordem como a consulta a lê: colunas próprias mais um nível de relação.
 * Deriva do `include` para não haver duas descrições da mesma forma.
 */
type OrdemComRelacoes = Prisma.ProductionOrderGetPayload<{
  include: {
    product: { select: { id: true; code: true; name: true } };
    customerOrder: { select: { id: true; code: true } };
  };
}>;

type LoteDaOrdem = {
  id: string;
  code: string;
  businessLotNumber: string | null;
  status: LotStatus;
  productionOrderId: string | null;
};

/** Uma linha do DTO consultivo. Fonte única para a lista e para o detalhe. */
function montarLinha(
  ordem: OrdemComRelacoes,
  produzidoBruto: Prisma.Decimal | null,
  lotes: LoteDaOrdem[],
): CustomerProductionOrderRowDTO {
  const zero = new Prisma.Decimal(0);
  const produzido = produzidoBruto ?? zero;
  // Saldo nunca negativo: apontar mais que o planejado é variação, não
  // dívida — e um saldo negativo na tela leria como "falta produzir".
  const saldo = Prisma.Decimal.max(ordem.plannedQuantity.minus(produzido), zero);

  return {
      id: ordem.id,
      code: ordem.code,
      status: ordem.status,
      /*
       * Snapshot primeiro, registro vivo como retorno. A ordem congela
       * código e nome do produto ao ser planejada; rascunho ainda não
       * congelou, e mostrar a linha sem produto seria pior que mostrar o
       * nome de agora.
       */
      productId: ordem.productId,
      productCode: ordem.productCode ?? ordem.product?.code ?? null,
      productName: ordem.productName ?? ordem.product?.name ?? null,
      finishedItemCode: ordem.finishedItemCode,
      customerOrderId: ordem.customerOrderId,
      customerOrderCode: ordem.customerOrder?.code ?? null,
      plannedQuantity: ordem.plannedQuantity.toString(),
      outputUnitCode: ordem.outputUnitCode,
      producedQuantity: produzido.toString(),
      remainingQuantity: saldo.toString(),
      createdAt: ordem.createdAt.toISOString(),
      plannedAt: ordem.plannedAt?.toISOString() ?? null,
      releasedAt: ordem.releasedAt?.toISOString() ?? null,
      startedAt: ordem.startedAt?.toISOString() ?? null,
      completedAt: ordem.completedAt?.toISOString() ?? null,
      finishedLots: lotes
        .filter((lote) => lote.productionOrderId === ordem.id)
        .map((lote) => ({
          id: lote.id,
          code: lote.code,
          businessLotNumber: lote.businessLotNumber,
          // `status` é a situação OPERACIONAL do lote — o material pode ser
          // usado? Não é `coaStatus`, que é o documento: aprovar o laudo
          // não libera o lote sozinho.
          status: lote.status,
        })),
  };
}

/**
 * Uma ordem de produção sob o cabeçalho de um Cliente.
 *
 * Mesma conferência dos outros detalhes consultivos, e mesmo 404 para
 * inexistente e para "existe, mas é de outro Cliente" — responder coisas
 * diferentes vazaria justamente o que o escopo protege.
 */
export async function getScopedProductionOrder(
  customerId: string,
  productionOrderId: string,
): Promise<CustomerProductionOrderRowDTO> {
  await requireCustomer(customerId);

  const prisma = getPrisma();
  /*
   * Busca por id E cliente na mesma condição. Buscar por id e conferir o
   * dono depois daria o mesmo resultado, mas passaria pela memória um
   * registro de outro Cliente — e é justamente isso que o escopo existe
   * para não fazer.
   */
  const ordem = await prisma.productionOrder.findFirst({
    where: { id: productionOrderId, customerId },
    include: {
      product: { select: { id: true, code: true, name: true } },
      customerOrder: { select: { id: true, code: true } },
    },
  });
  if (!ordem) {
    throw new NotInThisCustomerError("Ordem de produção", productionOrderId, customerId);
  }

  // Mesma montagem da lista: uma forma só do DTO, para as duas telas não
  // divergirem no dia em que um campo mudar.
  const [linhas, lotes] = await Promise.all([
    prisma.productionOutput.groupBy({
      by: ["productionOrderId"],
      where: { productionOrderId: ordem.id },
      _sum: { quantity: true },
    }),
    prisma.lot.findMany({
      where: { productionOrderId: ordem.id },
      select: {
        id: true,
        code: true,
        businessLotNumber: true,
        status: true,
        productionOrderId: true,
      },
      orderBy: { code: "asc" },
    }),
  ]);

  return montarLinha(ordem, linhas[0]?._sum.quantity ?? null, lotes);
}
