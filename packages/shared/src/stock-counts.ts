/**
 * Inventário Físico em sessão — contratos (INVENTORY-PHYSICAL-COUNT-01).
 *
 * A sessão é o documento `INV-`: posições (item, ou item + lote) com saldo de
 * referência congelado na entrada; registros de contagem que só acrescentam,
 * cada um com o próprio saldo esperado; e um encerramento que aplica a
 * diferença do registro que vale como DELTA sobre o saldo daquele instante.
 *
 * A Contagem rápida grava o mesmo documento, com `kind = QUICK`.
 */

import type { ItemType } from "./items.js";
import type { LotStatus } from "./lots.js";
import type { InventoryOwnerType } from "./ownership.js";

/** Prefixo canônico do documento de inventário — `INV-000001`. */
export const STOCK_COUNT_CODE_PREFIX = "INV";

/** Máximo inicial de posições por sessão (decisão P1 do PO). */
export const STOCK_COUNT_MAX_POSITIONS = 3000;

export type StockCountKind = "SESSION" | "QUICK";
export type StockCountMode = "BLIND" | "ASSISTED";
export type StockCountStatus = "IN_PROGRESS" | "IN_REVIEW" | "COMPLETED" | "CANCELLED";
export type StockCountPositionOrigin = "SCOPE" | "ADDED";
export type StockCountEntrySource = "GRID" | "QUICK";
export type StockCountDecision = "ADJUST" | "NO_ADJUSTMENT";
export type StockCountFindingKind = "UNREGISTERED_LOT" | "UNREGISTERED_ITEM" | "OTHER";

export const STOCK_COUNT_KINDS: readonly StockCountKind[] = ["SESSION", "QUICK"];
export const STOCK_COUNT_MODES: readonly StockCountMode[] = ["BLIND", "ASSISTED"];
export const STOCK_COUNT_STATUSES: readonly StockCountStatus[] = [
  "IN_PROGRESS",
  "IN_REVIEW",
  "COMPLETED",
  "CANCELLED",
];
export const STOCK_COUNT_DECISIONS: readonly StockCountDecision[] = ["ADJUST", "NO_ADJUSTMENT"];
export const STOCK_COUNT_FINDING_KINDS: readonly StockCountFindingKind[] = [
  "UNREGISTERED_LOT",
  "UNREGISTERED_ITEM",
  "OTHER",
];

/**
 * Situação da posição — derivada, nunca gravada.
 *
 * Enquanto a contagem cega esconde o saldo, `MATCHES`, `DIVERGENT` e
 * `DECIDED` não aparecem: dizer que a posição confere já revelaria a
 * diferença. A posição contada é só `COUNTED`.
 */
export type StockCountPositionSituation =
  | "PENDING"
  | "COUNTED"
  | "MATCHES"
  | "DIVERGENT"
  | "RECOUNT_REQUESTED"
  | "DECIDED"
  | "REMOVED";

/**
 * Leitura da sessão. `review` revela saldo, esperado e diferença quando o
 * estado permite; `counting` é a leitura de quem conta, e numa contagem cega
 * nunca revela.
 */
export type StockCountView = "review" | "counting";

export type StockCountBalanceFilter = "WITH_BALANCE" | "ANY";
export type StockCountOwnerFilter = "ALL" | "VERIDI" | "CUSTOMER";

export interface StockCountScopeInput {
  /** Vazio ou ausente: todos os tipos. */
  itemTypes?: ItemType[];
  /** `ANY` inclui lote com saldo zero; `WITH_BALANCE` só saldo positivo (P5). */
  balance: StockCountBalanceFilter;
  /** Ausente: `ALL`. */
  owner?: StockCountOwnerFilter;
  /** Só com `owner = CUSTOMER`: um cliente específico. */
  customerId?: string;
  itemIds?: string[];
  /** Presente: só estes lotes, e nenhuma posição de item sem lote. */
  lotIds?: string[];
}

export interface PreviewStockCountInput {
  mode: StockCountMode;
  scope: StockCountScopeInput;
  /** Posições retiradas no preview, por `positionKey`. */
  excludedPositionKeys?: string[];
}

export interface StartStockCountInput extends PreviewStockCountInput {
  description?: string;
  /**
   * As posições que a tela mostrou. O servidor reavalia o escopo ao iniciar;
   * se o conjunto mudou, responde conflito com a diferença — o que foi visto é
   * o que se conta.
   */
  expectedPositionKeys?: string[];
}

export interface StockCountPreviewPositionDTO {
  positionKey: string;
  /** Número provisório: a ordem de percurso (local, código do item, lote). */
  sequence: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  unitCode: string;
  lotId: string | null;
  lotCode: string | null;
  ownerType: InventoryOwnerType;
  ownerCustomerId: string | null;
  ownerCustomerCode: string | null;
  ownerCustomerName: string | null;
  lotStatus: LotStatus | null;
  expiryDate: string | null;
  isExpired: boolean;
  location: string | null;
  /** Saldo atual; `null` em contagem cega. */
  balance: string | null;
}

/** Posição que ficou fora por já estar em outro inventário aberto. */
export interface StockCountHeldPositionDTO {
  positionKey: string;
  itemCode: string;
  lotCode: string | null;
  stockCountId: string;
  stockCountCode: string;
}

export interface StockCountPreviewDTO {
  positions: StockCountPreviewPositionDTO[];
  itemCount: number;
  heldByOpenCounts: StockCountHeldPositionDTO[];
  excludedCount: number;
  maxPositions: number;
}

export interface StockCountEntryDTO {
  id: string;
  round: number;
  countedQuantity: string;
  /** E — saldo lido no registro; `null` quando a contagem cega esconde. */
  expectedQuantity: string | null;
  /** C − E; `null` quando a contagem cega esconde. */
  difference: string | null;
  countedAt: string;
  countedByName: string;
  source: StockCountEntrySource;
  note: string | null;
}

export interface StockCountPositionDTO {
  id: string;
  sequence: number;
  positionKey: string;
  origin: StockCountPositionOrigin;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  unitCode: string;
  lotId: string | null;
  lotCode: string | null;
  ownerType: InventoryOwnerType;
  ownerCustomerId: string | null;
  ownerCustomerCode: string | null;
  ownerCustomerName: string | null;
  lotStatusAtReference: LotStatus | null;
  expiryDateAtReference: string | null;
  locationAtReference: string | null;
  referenceAt: string;
  /** R — saldo de referência; `null` quando a contagem cega esconde. */
  referenceQuantity: string | null;
  /** Rodada em que um registro novo entra. */
  currentRound: number;
  /**
   * Último registro da rodada atual. É o que o próximo registro informa como
   * visto (`expectedLastEntryId`); se mudou, o servidor responde conflito.
   */
  lastEntryId: string | null;
  /** O registro que vale para a decisão final. */
  validEntryId: string | null;
  /** Diferença do registro que vale; `null` sem registro ou quando escondida. */
  finalDifference: string | null;
  /**
   * Houve movimento no ledger da posição depois da referência (ou o esperado
   * do registro que vale difere dela); `null` quando escondido.
   */
  hasConcurrentMovement: boolean | null;
  situation: StockCountPositionSituation;
  entries: StockCountEntryDTO[];
  recountRequestedRound: number | null;
  recountRequestedAt: string | null;
  recountRequestedByName: string | null;
  /** Recontada pela mesma pessoa que pediu a recontagem — permitido e sinalizado. */
  recountedByRequester: boolean;
  addedAt: string | null;
  addedByName: string | null;
  addReason: string | null;
  removedAt: string | null;
  removedByName: string | null;
  removeReason: string | null;
  decision: StockCountDecision | null;
  decisionReason: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  concurrentMovementConfirmed: boolean;
  /** Ajuste gerado no encerramento, quando houve. */
  adjustmentMovementId: string | null;
}

export interface StockCountFindingDTO {
  id: string;
  kind: StockCountFindingKind;
  itemId: string | null;
  itemCode: string | null;
  itemName: string | null;
  identification: string;
  quantity: string | null;
  unitCode: string | null;
  note: string | null;
  createdAt: string;
  createdByName: string;
}

export interface StockCountSummaryDTO {
  id: string;
  code: string;
  kind: StockCountKind;
  mode: StockCountMode;
  status: StockCountStatus;
  description: string | null;
  referenceAt: string;
  createdAt: string;
  createdByName: string;
  firstRoundClosedAt: string | null;
  firstRoundClosedByName: string | null;
  completedAt: string | null;
  completedByName: string | null;
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancelReason: string | null;
  /** Posições não retiradas. */
  positionCount: number;
  removedCount: number;
  /** Posições não retiradas com registro na rodada atual. */
  countedCount: number;
  /** `null` enquanto a contagem cega esconde a diferença. */
  divergentCount: number | null;
}

export interface StockCountListResponse {
  stockCounts: StockCountSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface StockCountDetailDTO extends StockCountSummaryDTO {
  view: StockCountView;
  /** Saldo de referência, esperado e diferença escondidos nesta leitura. */
  balancesHidden: boolean;
  scopeFilters: unknown;
  /** Quem encerrou também registrou contagem nesta sessão — permitido (D4) e sinalizado. */
  completedByCounter: boolean;
  positions: StockCountPositionDTO[];
  findings: StockCountFindingDTO[];
}

export interface RegisterStockCountEntryInput {
  /** A rodada que a tela estava contando. */
  round: number;
  /** O `lastEntryId` que a tela recebeu para a posição; `null` se não havia. */
  expectedLastEntryId: string | null;
  countedQuantity: string;
  /** Idempotência: reenviar o mesmo id devolve o registro já criado. */
  clientRequestId: string;
  note?: string;
}

export interface RegisterStockCountEntryResultDTO {
  /** `false` quando o envio repetiu um registro que já existia. */
  created: boolean;
  entry: StockCountEntryDTO;
  position: StockCountPositionDTO;
}

export interface AddStockCountPositionInput {
  itemId: string;
  lotId?: string;
  reason: string;
}

export interface RemoveStockCountPositionInput {
  reason: string;
}

export interface RequestStockCountRecountInput {
  positionIds: string[];
}

export interface StockCountDecisionInput {
  positionId: string;
  decision: StockCountDecision;
  reason: string;
  /** Confirma que a movimentação durante o inventário não invalida a contagem. */
  confirmConcurrentMovement?: boolean;
}

export interface DecideStockCountInput {
  decisions: StockCountDecisionInput[];
}

export interface CancelStockCountInput {
  reason: string;
}

export interface CreateStockCountFindingInput {
  kind: StockCountFindingKind;
  itemId?: string;
  identification: string;
  quantity?: string;
  unitCode?: string;
  note?: string;
}

/** Por que o encerramento foi recusado numa posição. */
export type StockCountCloseIssue =
  | "PENDING_COUNT"
  | "PENDING_RECOUNT"
  | "UNDECIDED"
  | "CONCURRENT_MOVEMENT_UNCONFIRMED"
  | "UNIT_CHANGED"
  | "NEGATIVE_BALANCE"
  | "BELOW_RESERVED";

export interface StockCountCloseIssueDTO {
  positionId: string;
  sequence: number;
  itemCode: string;
  lotCode: string | null;
  issue: StockCountCloseIssue;
  /** Saldo no encerramento, ajuste e reservado — preenchidos nas guardas de saldo. */
  balance: string | null;
  adjustment: string | null;
  reserved: string | null;
}
