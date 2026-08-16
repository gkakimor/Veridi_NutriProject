/**
 * Contratos do Dashboard operacional.
 *
 * O Dashboard **nunca é fonte de verdade**: tudo é derivado ao vivo das
 * entidades operacionais (Pedido, Expedição, Faturamento, OC, Recebimento,
 * Movimento, Lote, OP) e dos serviços centrais de disponibilidade e custo.
 * Nenhum agregado é persistido só para alimentar tela.
 *
 * Duas categorias sempre separadas e nunca misturadas:
 * - **Estado atual** — não muda quando o usuário troca o filtro de período;
 * - **Período** — só métricas históricas respondem ao filtro.
 */

/** Severidade derivada, nunca persistida. */
export type AttentionSeverity = "CRITICAL" | "WARNING" | "INFO";

export const ATTENTION_SEVERITY_LABELS: Record<AttentionSeverity, string> = {
  CRITICAL: "Crítico",
  WARNING: "Atenção",
  INFO: "Informativo",
};

export type AttentionType =
  | "LOT_EXPIRED"
  | "LOT_BLOCKED"
  | "LOT_AWAITING_QUALITY"
  | "LOT_NEAR_EXPIRY"
  | "PRODUCTION_ORDER_SHORTAGE"
  | "PURCHASE_ORDER_LATE"
  | "ORDER_AWAITING_PRODUCTION"
  | "ORDER_AWAITING_SHIPMENT"
  | "SHIPMENT_AWAITING_BILLING"
  | "PRODUCTION_ORDER_INCOMPLETE_COST";

export const ATTENTION_TYPE_LABELS: Record<AttentionType, string> = {
  LOT_EXPIRED: "Lote vencido com saldo",
  LOT_BLOCKED: "Lote bloqueado com saldo",
  LOT_AWAITING_QUALITY: "Lote aguardando Qualidade",
  LOT_NEAR_EXPIRY: "Lote próximo do vencimento",
  PRODUCTION_ORDER_SHORTAGE: "OP com falta de material",
  PURCHASE_ORDER_LATE: "Ordem de compra atrasada",
  ORDER_AWAITING_PRODUCTION: "Pedido aguardando produção",
  ORDER_AWAITING_SHIPMENT: "Pedido aguardando expedição",
  SHIPMENT_AWAITING_BILLING: "Expedição aguardando faturamento",
  PRODUCTION_ORDER_INCOMPLETE_COST: "OP concluída com custo incompleto",
};

/** Destino de navegação do item — sempre o documento relevante. */
export type AttentionTargetKind =
  | "LOT"
  | "PRODUCTION_ORDER"
  | "PURCHASE_ORDER"
  | "CUSTOMER_ORDER"
  | "SHIPMENT";

export interface AttentionItemDTO {
  type: AttentionType;
  severity: AttentionSeverity;
  /** Descrição curta e acionável. */
  description: string;
  /** Código do documento (LT-…, OP-…, OC-…, PED-…, EXP-…). */
  code: string;
  /** Data relevante para o item (vencimento, previsão, confirmação…). */
  relevantDate: string | null;
  targetKind: AttentionTargetKind;
  targetId: string;
}

export interface DashboardPeriodDTO {
  from: string;
  to: string;
  /** Contagem de DOCUMENTOS/eventos — nunca soma de quantidades de UOMs distintas. */
  customerOrdersCreated: number;
  receiptsCompleted: number;
  productionOrdersCompleted: number;
  shipmentsConfirmed: number;
  billingsIssued: number;
  /**
   * Só existe quando TODOS os faturamentos emitidos do período têm preço
   * completo. Com qualquer documento incompleto fica `null` — nunca uma
   * soma parcial apresentada como total.
   */
  billedAmount: string | null;
  /** Quantos dos `billingsIssued` têm precificação completa. */
  billingsWithCompletePricing: number;
}

export interface DashboardCommercialStateDTO {
  confirmedOrders: number;
  inFulfillmentOrders: number;
  partiallyShippedOrders: number;
  /** Pedidos operacionais com saldo reservado pronto para a próxima expedição. */
  ordersAwaitingShipment: number;
  /** Expedições CONFIRMED sem faturamento emitido (pendentes + em preparação). */
  shipmentsAwaitingBilling: number;
}

export interface DashboardProductionStateDTO {
  draft: number;
  planned: number;
  released: number;
  inProduction: number;
  /** OPs DRAFT/PLANNED com falta de material — mesma semântica exibida na própria OP. */
  withShortage: number;
  /** OPs COMPLETED cuja qualidade de custo é PARTIAL/NO_COST. */
  completedWithIncompleteCost: number;
}

export interface DashboardPurchasingStateDTO {
  openOrders: number;
  partiallyReceived: number;
  lateOrders: number;
  /** Itens DISTINTOS com quantidade aberta — nunca soma de kg + un. */
  itemsOnOrder: number;
}

export interface DashboardInventoryStateDTO {
  lotsAwaitingQuality: number;
  lotsBlocked: number;
  lotsExpired: number;
  /** Vencem nos próximos 30 dias (ainda não vencidos), com saldo. */
  lotsNearExpiry: number;
}

export interface DashboardCurrentStateDTO {
  commercial: DashboardCommercialStateDTO;
  production: DashboardProductionStateDTO;
  purchasing: DashboardPurchasingStateDTO;
  inventory: DashboardInventoryStateDTO;
}

export interface MovementSummaryDTO {
  receiptIn: number;
  productionConsumption: number;
  /** Consumo de material em amostra/piloto — saída física de desenvolvimento. */
  sampleConsumption: number;
  finishedGoodProduction: number;
  shipmentOut: number;
  /** `ADJUSTMENT_IN` + `ADJUSTMENT_OUT` agrupados para o card. */
  adjustments: number;
  loss: number;
}

export interface RecentMovementDTO {
  id: string;
  occurredAt: string;
  type: string;
  itemCode: string;
  itemName: string;
  lotCode: string | null;
  /** Sempre exibida com a própria unidade — nunca somada entre linhas. */
  quantity: string;
  unitCode: string;
  /** Código do documento de origem, quando derivável. */
  sourceCode: string | null;
  sourceKind: "RECEIPT" | "PRODUCTION_ORDER" | "SHIPMENT" | "PROJECT_SAMPLE" | "ADJUSTMENT" | null;
  sourceId: string | null;
}

/** Contagem de EVENTOS por dia e tipo — nunca soma física de UOMs distintas. */
export interface MovementActivityPointDTO {
  date: string;
  receiptIn: number;
  productionConsumption: number;
  sampleConsumption: number;
  finishedGoodProduction: number;
  shipmentOut: number;
  adjustments: number;
  loss: number;
}

export interface DashboardDTO {
  period: DashboardPeriodDTO;
  currentState: DashboardCurrentStateDTO;
  /** Priorizadas por severidade e data; limitadas a `attentionLimit`. */
  attention: AttentionItemDTO[];
  attentionTotal: number;
  attentionLimit: number;
  movementSummary: MovementSummaryDTO;
  recentMovements: RecentMovementDTO[];
  movementActivity: MovementActivityPointDTO[];
}
