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
