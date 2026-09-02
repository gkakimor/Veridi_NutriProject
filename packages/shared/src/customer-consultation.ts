/**
 * Contratos da CONSULTA DO CLIENTE.
 *
 * A Consulta é uma capacidade de LEITURA sobre dados que já existem: nenhuma
 * entidade nova, nenhuma migration, nenhum saldo ou total persistido. Ela só
 * responde "o que está acontecendo com este cliente?" sem obrigar o operador
 * a saber em qual módulo procurar.
 *
 * Regra central: dentro da Consulta o Cliente é a raiz da navegação. As
 * listas continuam vindo dos endpoints operacionais já existentes, filtrados
 * por `customerId`; o que vive aqui é apenas o resumo e o ESCOPO — a garantia
 * de que uma entidade de outro Cliente nunca aparece sob este cabeçalho.
 */

import type { CustomerDTO } from "./customers.js";

/**
 * Contadores do Resumo.
 *
 * Todos derivam de `count` direto no banco — nenhum deles carrega listas para
 * contar em memória. Valores financeiros ficam DE FORA de propósito: o total
 * faturado não é persistido (nasce de `quantidade × preço` linha a linha em
 * `toBillingDTO`), e somá-lo aqui seria uma segunda matemática de dinheiro em
 * paralelo à do módulo de Faturamento.
 */
import type { LotStatus } from "./lots.js";
import type { ProductionOrderStatus } from "./production-orders.js";

export interface CustomerConsultationCountsDTO {
  /** Produtos daquele Cliente — cada um com o seu item de produto acabado. */
  products: number;
  projects: number;
  /** Pedidos do cliente em qualquer situação, inclusive cancelados. */
  orders: number;
  /** Pedidos ainda em curso: nem expedidos por completo, nem cancelados. */
  openOrders: number;
  billings: number;
  /** Lotes de propriedade do Cliente fisicamente dentro da Veridi. */
  materialLots: number;
  /** Ordens de produção do cliente, em qualquer situação. */
  productionOrders: number;
  /**
   * Ordens ainda EM ABERTO — rascunho, planejada, liberada ou em produção.
   *
   * "Em aberto" e não "em andamento": é o recorte que o domínio já tem
   * (`OPEN_PRODUCTION_ORDER_STATUSES`), usado pelo painel e pelos relatórios.
   * Inventar um segundo agrupamento aqui daria dois números para a mesma
   * pergunta, divergindo no dia em que um status novo aparecesse.
   */
  openProductionOrders: number;
}

export interface CustomerConsultationSummaryDTO {
  customer: CustomerDTO;
  counts: CustomerConsultationCountsDTO;
}


/**
 * Estoque de PRODUTO ACABADO de um Cliente.
 *
 * É o estoque da Veridi produzido para aquele Cliente, não material dele: o
 * produto acabado só passa a ser do Cliente quando expedido. Não confundir
 * com `CustomerMaterialRowDTO`, que é material de propriedade do Cliente
 * guardado aqui dentro.
 *
 * Não existe linha para matéria-prima: MP da Veridi é da Veridi, e mostrá-la
 * sob o cabeçalho de um Cliente diria que ela pertence a ele.
 */
export interface CustomerFinishedGoodsRowDTO {
  productId: string;
  productCode: string;
  productName: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  /** Somas do mesmo ledger que o resto do sistema usa — nunca recalculadas aqui. */
  onHand: string;
  reserved: string;
  available: string;
  /** Lotes existentes do item, com ou sem saldo. */
  lotCount: number;
  /** Lotes que a Qualidade ainda não liberou. */
  awaitingQualityLots: number;
}

export interface CustomerFinishedGoodsResponse {
  rows: CustomerFinishedGoodsRowDTO[];
  page: number;
  pageSize: number;
  total: number;
}


/**
 * Uma ordem de produção vista pela Consulta do Cliente.
 *
 * É DELIBERADAMENTE menor que o DTO operacional. Aquele carrega necessidade
 * de material, reserva, consumo e sugestão de lote — a conta que decide se dá
 * para liberar a ordem —, e paga por isso com centenas de consultas por
 * página. A pergunta aqui é outra: "o que este cliente tem em produção?".
 * Responder a ela não exige a conta, e responder com a conta tornaria a aba
 * cara o bastante para não valer a pena existir.
 *
 * Quem precisa operar abre a ordem completa, pela saída explícita.
 */
export interface CustomerProductionOrderRowDTO {
  id: string;
  code: string;
  status: ProductionOrderStatus;
  /**
   * Snapshot de quando a ordem foi planejada, com retorno ao registro vivo.
   *
   * Rascunho ainda não congelou nada, então o snapshot vem vazio — e mostrar
   * a linha sem produto seria pior que mostrar o nome atual.
   */
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  finishedItemCode: string | null;
  /** Pedido que originou a ordem. Produção para estoque não tem. */
  customerOrderId: string | null;
  customerOrderCode: string | null;
  plannedQuantity: string;
  outputUnitCode: string;
  /** Soma dos apontamentos — nunca uma segunda coluna mantida à mão. */
  producedQuantity: string;
  /** `planejado − produzido`, nunca negativo. */
  remainingQuantity: string;
  createdAt: string;
  plannedAt: string | null;
  releasedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /**
   * Lotes de produto acabado que a ordem gerou.
   *
   * Lista, não objeto: o schema permite mais de um por ordem. Hoje não
   * acontece, e escrever 1:1 aqui transformaria um dado que o banco aceita
   * num campo que a tela perde em silêncio.
   */
  finishedLots: CustomerProductionLotDTO[];
}

export interface CustomerProductionLotDTO {
  id: string;
  code: string;
  /** Número de lote comercial, quando existir. */
  businessLotNumber: string | null;
  /**
   * Situação OPERACIONAL do lote — o material pode ser usado?
   *
   * Não confundir com `coaStatus`, que é a situação do documento. Aprovar o
   * laudo não libera o lote sozinho.
   */
  status: LotStatus;
}

export interface CustomerProductionOrdersResponse {
  rows: CustomerProductionOrderRowDTO[];
  page: number;
  pageSize: number;
  total: number;
}
