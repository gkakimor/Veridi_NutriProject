/**
 * Contratos do Plano de Atendimento — ANÁLISE/PROJEÇÃO, nunca fonte de
 * verdade de estoque. `GET .../fulfillment-plan` é somente leitura, nunca
 * persiste reserva/OP. `POST .../apply-fulfillment-plan` é quem de fato
 * reserva Produto Acabado e gera OPs DRAFT para o déficit.
 */

export type FulfillmentLineSituation =
  /** `available >= orderedQuantity` — estoque cobre o pedido inteiro. */
  | "ESTOQUE_SUFICIENTE"
  /** Há déficit e o Product tem Formulação ACTIVE para cobri-lo. */
  | "REQUER_PRODUCAO"
  /** Há déficit, mas o Product não tem Formulação ACTIVE — Plano ainda mostra o número, mas aplicar exige revisão. */
  | "SEM_FORMULACAO_ATIVA";

export interface FulfillmentPlanLineDTO {
  customerOrderLineId: string;
  productId: string;
  productCode: string;
  productName: string;
  orderedQuantity: string;
  unitCode: string;
  finishedGoodsOnHand: string;
  finishedGoodsReserved: string;
  finishedGoodsAvailable: string;
  /** `min(orderedQuantity, available)` — proposta padrão, estoque primeiro. */
  suggestedReserveQuantity: string;
  /** `orderedQuantity - suggestedReserveQuantity`. */
  suggestedProductionQuantity: string;
  situation: FulfillmentLineSituation;
}

export interface MaterialImpactRowDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  /** Soma da necessidade deste material entre todas as linhas do Pedido com déficit. */
  requiredQuantity: string;
  unitCode: string;
  onHand: string;
  reserved: string;
  available: string;
  /** Informativo — nunca reduz `shortage`. */
  onOrder: string;
  shortage: string;
}

export interface FulfillmentPlanDTO {
  customerOrderId: string;
  lines: FulfillmentPlanLineDTO[];
  /** Impacto agregado de matéria-prima/embalagem para o déficit do Pedido inteiro — nunca reserva MP. */
  materialImpact: MaterialImpactRowDTO[];
}

export interface ApplyFulfillmentPlanLineInput {
  customerOrderLineId: string;
  /** Deve ser `<= Available` do Finished Product Item no momento da aplicação (revalidado no backend). */
  reserveQuantity: string;
  /** `reserveQuantity + produceQuantity` deve ser exatamente `orderedQuantity` da linha. */
  produceQuantity: string;
}

export interface ApplyFulfillmentPlanInput {
  lines: ApplyFulfillmentPlanLineInput[];
}
