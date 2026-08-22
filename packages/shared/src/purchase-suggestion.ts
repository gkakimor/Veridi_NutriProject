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
  /** Fornecedores homologados e ativos para este item; vazio não impede ver a falta. */
  supplierCandidates: PurchaseSupplierCandidateDTO[];
  /**
   * Fornecedor recomendado: o preferencial, ou o único homologado. Com
   * vários homologados e nenhum preferencial fica `null` — o sistema nunca
   * escolhe "o mais barato" sozinho.
   */
  recommendedSupplierItemId: string | null;
}

/**
 * Fornecedor homologado candidato para cobrir a falta de um item.
 *
 * Preço aqui é REFERÊNCIA comercial (oferta vigente), nunca custo real. O
 * MOQ é recomendação: nada bloqueia a compra abaixo dele, porque o sistema
 * não sabe se o fornecedor realmente recusa.
 */
export interface PurchaseSupplierCandidateDTO {
  supplierItemId: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  supplierItemCode: string | null;
  preferred: boolean;
  /** Oferta vigente; `null` quando só existem referências históricas. */
  referenceUnitPrice: string | null;
  referenceCurrencyCode: string | null;
  referencePriceUomCode: string | null;
  /** Preço convertido para a unidade de estoque do item — só quando a conversão é segura. */
  referencePriceInItemUom: string | null;
  minimumOrderQuantity: string | null;
  minimumOrderUomCode: string | null;
  /** MOQ na unidade do item; `null` quando as unidades não são convertíveis. */
  minimumOrderInItemUom: string | null;
  /** `max(falta, MOQ)` quando comparável; caso contrário a própria falta. */
  recommendedPurchaseQuantity: string;
  /** `true` só quando o MOQ elevou a quantidade recomendada. */
  moqRaisedQuantity: boolean;
  /** Existe referência histórica sem vigência confiável (nunca é preço atual). */
  hasLegacyPriceReference: boolean;
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

/**
 * Sourcing na fase de PLANO — antes de existir OP.
 *
 * Mesma capacidade de fornecedores/MOQ/oferta da Sugestão de Compra, lida a
 * partir da falta que o próprio Plano já calculou. Não é um segundo motor:
 * reusa `buildSupplierCandidatesByItem`. Material do cliente nunca entra
 * aqui — ele não se resolve com compra da Veridi.
 */
export interface PlanPurchaseSourcingRowDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  requiredQuantity: string;
  available: string;
  /** Informativo — nunca reduz a falta. */
  onOrder: string;
  shortage: string;
  supplierCandidates: PurchaseSupplierCandidateDTO[];
  recommendedSupplierItemId: string | null;
}

export interface PlanPurchaseSourcingDTO {
  customerOrderId: string;
  rows: PlanPurchaseSourcingRowDTO[];
  /** Materiais do cliente com falta — mostrados para explicar por que não há compra. */
  customerSuppliedShortages: {
    itemId: string;
    itemCode: string;
    itemName: string;
    unitCode: string;
    requiredQuantity: string;
    available: string;
    shortage: string;
    ownerCustomerName: string | null;
  }[];
}
