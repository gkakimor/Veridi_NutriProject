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
