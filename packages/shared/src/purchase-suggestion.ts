/**
 * Contratos da Sugestão de Compra — ANÁLISE dinâmica, nunca fonte de
 * verdade. `GET .../purchase-suggestion` é somente leitura, nunca persiste
 * nada. `POST .../purchase-drafts` é quem de fato cria as Ordens de Compra
 * DRAFT (documento persistido, único artefato real desta funcionalidade —
 * nunca um segundo módulo de compras).
 */

export interface PurchaseSuggestionRowDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  /** `requiredQuantity - consumido`, somado entre todas as OPs do Pedido para este Item, nunca negativo. */
  remainingRequired: string;
  /** Reserva ACTIVE das próprias OPs deste Pedido para este Item — cobertura já garantida. */
  ownReserved: string;
  /** Reserved global (todas as reservas, de qualquer OP/Pedido) — só informativo. */
  globalReserved: string;
  /** Available global (ledger) — já líquido de todas as reservas, inclusive `ownReserved`. */
  available: string;
  /** Soma de OCs `ORDERED`/`PARTIALLY_RECEIVED` — nunca `DRAFT`. */
  onOrder: string;
  /** `max(remainingRequired - ownReserved - available, 0)` — falta física real. */
  operationalShortage: string;
  /** Soma das linhas de OC `DRAFT` já vinculadas a este Pedido para este Item — nunca conta como On Order. */
  draftPurchaseQuantity: string;
  /** `max(operationalShortage - onOrder, 0)` — sugestão de planejamento, não falta física. */
  suggestedAdditionalPurchase: string;
  /** `max(suggestedAdditionalPurchase - draftPurchaseQuantity, 0)` — o que ainda falta rascunhar. */
  newSuggestedPurchase: string;
}

export interface PendingProductionOrderDTO {
  id: string;
  code: string;
  productCode: string;
  productName: string;
}

/**
 * Material que o CLIENTE deve enviar. Nunca vira Ordem de Compra da
 * Veridi: falta aqui não é "comprar", é "aguardando material do cliente".
 */
export interface CustomerSuppliedMaterialRowDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  customerId: string | null;
  customerName: string | null;
  remainingRequired: string;
  ownReserved: string;
  /** Disponível do estoque DESTE cliente — estoque Veridi nunca entra. */
  available: string;
  /** `max(remainingRequired - ownReserved - available, 0)` — o que ainda falta o cliente enviar. */
  shortage: string;
}

export interface PurchaseSuggestionDTO {
  customerOrderId: string;
  rows: PurchaseSuggestionRowDTO[];
  /** Linhas fornecidas pelo cliente — separadas justamente para explicar por que não geram OC. */
  customerSuppliedRows: CustomerSuppliedMaterialRowDTO[];
  /** OPs do Pedido sem Requirements ainda (sem Formulação ACTIVE) — não entram na análise quantitativa. */
  pendingProductionOrders: PendingProductionOrderDTO[];
}

export interface GeneratePurchaseDraftLineInput {
  itemId: string;
  supplierId: string;
  /** `>= 0`; `0` não gera linha. */
  quantity: string;
}

export interface GeneratePurchaseDraftsInput {
  lines: GeneratePurchaseDraftLineInput[];
}
