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

import type { InventoryMovementDTO } from "./inventory.js";
import type { ItemType } from "./items.js";
import type { LotStatus } from "./lots.js";
import type { InventoryOwnerType } from "./ownership.js";
import type { UserRole } from "./users.js";

/** Prefixo canônico do documento de inventário — `INV-000001`. */
export const STOCK_COUNT_CODE_PREFIX = "INV";

/**
 * Quem OPERA o Inventário Físico — decisão D4 do PO: inicia, conta, adiciona e
 * retira posição, registra ocorrência, conclui a primeira contagem, revisa,
 * encerra e cancela. Contar e aprovar podem ser a mesma pessoa; cada passo
 * grava autor e a leitura sinaliza.
 *
 * Consultar é de qualquer sessão autenticada, como o resto do estoque. A API
 * recusa os outros perfis com 403; a tela usa a MESMA lista só para não
 * oferecer a ação que seria recusada (INVENTORY-PHYSICAL-COUNT-01, Fatia 2A).
 */
export const STOCK_COUNT_WRITE_ROLES: readonly UserRole[] = ["ADMIN", "PRODUCTION", "QUALITY"];

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
 * "Em aberto" — o inventário que ainda pede trabalho: em contagem ou em
 * revisão. É o recorte padrão da lista, e o conjunto em que uma posição fica
 * retida para os outros inventários.
 */
export const STOCK_COUNT_OPEN_STATUSES: readonly StockCountStatus[] = ["IN_PROGRESS", "IN_REVIEW"];

export const STOCK_COUNT_STATUS_LABELS: Record<StockCountStatus, string> = {
  IN_PROGRESS: "Em contagem",
  IN_REVIEW: "Em revisão",
  COMPLETED: "Encerrado",
  CANCELLED: "Cancelado",
};

export const STOCK_COUNT_MODE_LABELS: Record<StockCountMode, string> = {
  BLIND: "Contagem cega",
  ASSISTED: "Contagem com saldo",
};

export const STOCK_COUNT_KIND_LABELS: Record<StockCountKind, string> = {
  SESSION: "Inventário",
  QUICK: "Contagem rápida",
};

export const STOCK_COUNT_FINDING_KIND_LABELS: Record<StockCountFindingKind, string> = {
  UNREGISTERED_LOT: "Lote sem cadastro",
  UNREGISTERED_ITEM: "Item sem cadastro",
  OTHER: "Outra",
};

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
 * Rótulos da situação. `MATCHES` e `DIVERGENT` só chegam quando a leitura
 * revela a diferença — a tela nunca os deduz sozinha.
 */
export const STOCK_COUNT_POSITION_SITUATION_LABELS: Record<StockCountPositionSituation, string> = {
  PENDING: "Pendente",
  COUNTED: "Contada",
  MATCHES: "Confere",
  DIVERGENT: "Divergente",
  RECOUNT_REQUESTED: "Recontagem pedida",
  DECIDED: "Decidida",
  REMOVED: "Retirada",
};

/**
 * Leitura da sessão. `review` revela saldo, esperado e diferença quando o
 * estado permite; `counting` é a leitura de quem conta, e numa contagem cega
 * nunca revela.
 */
export type StockCountView = "review" | "counting";

export type StockCountBalanceFilter = "WITH_BALANCE" | "ANY";
export type StockCountOwnerFilter = "ALL" | "VERIDI" | "CUSTOMER";

/**
 * Validade do lote no escopo (Fatia 2B). `EXPIRING` é "vence em até N dias",
 * sem os já vencidos, e pede `expiringWithinDays`. A régua é a de
 * `isLotExpired`: o lote vale o dia da validade inteiro, no fuso comercial.
 */
export type StockCountExpiryFilter = "ANY" | "EXPIRED" | "NOT_EXPIRED" | "EXPIRING";

export const STOCK_COUNT_EXPIRY_FILTERS: readonly StockCountExpiryFilter[] = ["ANY", "EXPIRED", "NOT_EXPIRED", "EXPIRING"];

export const STOCK_COUNT_EXPIRY_FILTER_LABELS: Record<StockCountExpiryFilter, string> = {
  ANY: "Qualquer validade",
  EXPIRED: "Somente vencidos",
  NOT_EXPIRED: "Somente não vencidos",
  EXPIRING: "Vence em até N dias",
};

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
  /*
   * Filtros de LOTE (Fatia 2B). Qualquer um deles presente deixa de fora a
   * posição de item sem lote: ela não tem local, situação nem validade.
   */
  /** Local do lote contém o texto, sem diferenciar maiúsculas. */
  locationContains?: string;
  /** Situação do lote — OU dentro do grupo. Vazio ou ausente: todas. */
  lotStatuses?: LotStatus[];
  /** Ausente ou `ANY`: qualquer validade. */
  expiry?: StockCountExpiryFilter;
  /** Só com `expiry = EXPIRING`: de 1 a 3650 dias. */
  expiringWithinDays?: number;
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

/**
 * Posição do escopo que a pessoa retirou na prévia (`excludedPositionKeys`).
 * Sem número: está fora do percurso até ser recolocada.
 */
export type StockCountPreviewExcludedPositionDTO = Omit<StockCountPreviewPositionDTO, "sequence">;

export interface StockCountPreviewDTO {
  positions: StockCountPreviewPositionDTO[];
  itemCount: number;
  heldByOpenCounts: StockCountHeldPositionDTO[];
  excludedCount: number;
  /**
   * As retiradas que continuam no escopo, para a tela listar e oferecer
   * "Recolocar". Chave retirada que o filtro já não seleciona não aparece —
   * `excludedCount` é o tamanho desta lista.
   */
  excludedPositions: StockCountPreviewExcludedPositionDTO[];
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
  /** Contagem rápida: a posição única e o resultado. `null` em inventário. */
  quickResult: StockCountQuickResultDTO | null;
}

/**
 * O que a Contagem rápida gravou, para a aba "Contagens rápidas" (Fatia 2B).
 * Números do registro — contado e sistema no instante do confirmar — e o
 * ajuste que nasceu dele, quando houve.
 */
export interface StockCountQuickResultDTO {
  positionId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  lotId: string | null;
  lotCode: string | null;
  ownerType: InventoryOwnerType;
  ownerCustomerCode: string | null;
  ownerCustomerName: string | null;
  countedQuantity: string;
  systemQuantity: string;
  /** contado − sistema. */
  difference: string;
  adjustmentMovementId: string | null;
  adjustmentType: "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | null;
  /** Magnitude do ajuste; `null` quando conferiu. */
  adjustmentQuantity: string | null;
  reason: string | null;
  countedByName: string;
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

export const STOCK_COUNT_DECISION_LABELS: Record<StockCountDecision, string> = {
  ADJUST: "Ajustar",
  NO_ADJUSTMENT: "Não ajustar",
};

/** Um ajuste que a tela mostrou no diálogo de encerramento: a posição e o registro que vale. */
export interface StockCountExpectedAdjustment {
  positionId: string;
  entryId: string;
}

export interface CompleteStockCountInput {
  /**
   * Os ajustes que a tela mostrou (Fatia 2B). Informado e diferente do
   * conjunto que o servidor aplicaria, o encerramento é recusado com
   * `stock_count_changed` e nada é gravado: o que se confirma é o que se viu.
   */
  expectedAdjustments?: StockCountExpectedAdjustment[];
}

/**
 * Movimento do ledger da posição depois da referência — a leitura que explica
 * a marca "com movimentação" (Fatia 2B). Os números do ajuste nunca saem daqui:
 * vêm das somas gravadas no registro.
 */
export interface StockCountPositionMovementDTO extends InventoryMovementDTO {
  /** Lançado depois do registro de contagem que vale. */
  afterCount: boolean;
  /** Lançado depois da contagem com data de ocorrência anterior a ela — o caso que pede recontagem ou confirmação. */
  retroactive: boolean;
}

export interface StockCountPositionMovementsDTO {
  positionId: string;
  referenceAt: string;
  /** Instante do registro que vale; `null` sem contagem. */
  countedAt: string | null;
  /** Contagem cega antes da revelação: nenhum movimento é listado. */
  balancesHidden: boolean;
  /** Em ordem de lançamento, até `STOCK_COUNT_POSITION_MOVEMENTS_LIMIT`. */
  movements: StockCountPositionMovementDTO[];
  total: number;
}

export const STOCK_COUNT_POSITION_MOVEMENTS_LIMIT = 200;

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

export const STOCK_COUNT_CLOSE_ISSUE_LABELS: Record<StockCountCloseIssue, string> = {
  PENDING_COUNT: "Posição sem contagem",
  PENDING_RECOUNT: "Recontagem pedida e ainda não contada",
  UNDECIDED: "Divergência sem decisão",
  CONCURRENT_MOVEMENT_UNCONFIRMED: "Movimentação durante o inventário sem recontagem nem confirmação",
  UNIT_CHANGED: "A unidade do item mudou desde o início do inventário",
  NEGATIVE_BALANCE: "O ajuste deixaria o saldo negativo",
  BELOW_RESERVED: "O ajuste deixaria o saldo abaixo do reservado",
};

/** Códigos de recusa do Inventário Físico — o `error` do corpo. */
export type StockCountErrorCode =
  | "forbidden"
  | "not_found"
  | "position_not_found"
  | "invalid_stock_count_status"
  | "empty_scope"
  | "scope_too_large"
  | "scope_changed"
  | "customer_not_found"
  | "position_in_open_count"
  | "position_already_in_count"
  | "action_not_allowed"
  | "entry_not_allowed"
  | "client_request_reused"
  | "fractional_count_quantity"
  | "first_round_incomplete"
  | "nothing_to_review"
  | "recount_not_allowed"
  | "decision_not_allowed"
  | "stock_count_close_blocked"
  | "stock_count_changed"
  | "system_quantity_changed"
  | "invalid_finding"
  | "concurrent_write"
  | "stock_count_entry_conflict"
  | "item_not_found"
  | "lot_not_found"
  | "lot_item_mismatch"
  | "missing_lot"
  | "unexpected_lot"
  | "missing_count_reason"
  | "count_below_reserved";

/**
 * Corpo de uma recusa do Inventário Físico. A frase está em `message`; os
 * campos abaixo existem só no código que os traz, e é deles que a tela precisa
 * para agir — o delta do escopo, a posição atual no conflito, quantas faltam.
 */
export interface StockCountErrorBody {
  error: StockCountErrorCode;
  message: string;
  /** `invalid_stock_count_status`: o estado em que o inventário está agora. */
  status?: StockCountStatus;
  /** `scope_too_large`. */
  positionCount?: number;
  maxPositions?: number;
  /** `scope_changed`: chaves que entraram e que saíram desde a prévia. */
  added?: string[];
  removed?: string[];
  /** `position_in_open_count`: onde cada posição está retida. */
  held?: StockCountHeldPositionDTO[];
  /** `first_round_incomplete`: posições sem contagem nem retirada, contadas pelo servidor. */
  pendingCount?: number;
  /** `stock_count_close_blocked`. */
  issues?: StockCountCloseIssueDTO[];
  /** `stock_count_entry_conflict`: a posição como está agora, na leitura de quem conta. */
  position?: StockCountPositionDTO;
  /** `system_quantity_changed` (Contagem rápida). */
  shownQuantity?: string;
  currentQuantity?: string;
}
