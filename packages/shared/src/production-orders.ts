/** Contratos do módulo de Ordem de Produção + Requirements, consumidos por `apps/api` e `apps/web`. */

import type { ItemType } from "./items.js";
import type { LotStatus } from "./lots.js";
import type { InventoryOwnerType, SupplyResponsibility } from "./ownership.js";
import type { ControlledDocumentRevisionDTO } from "./controlled-documents.js";

export const PRODUCTION_ORDER_CODE_PREFIX = "OP";

/**
 * Lifecycle completo: DRAFT→PLANNED→RELEASED→IN_PRODUCTION→COMPLETED,
 * com DRAFT/PLANNED/RELEASED→CANCELLED (nunca a partir de IN_PRODUCTION/
 * COMPLETED). `BLOCKED` reservado para uso futuro, ainda não alcançável.
 */
export type ProductionOrderStatus =
  | "DRAFT"
  | "PLANNED"
  | "RELEASED"
  | "IN_PRODUCTION"
  | "COMPLETED"
  | "BLOCKED"
  | "CANCELLED";

export const PRODUCTION_ORDER_STATUSES: readonly ProductionOrderStatus[] = [
  "DRAFT",
  "PLANNED",
  "RELEASED",
  "IN_PRODUCTION",
  "COMPLETED",
  "BLOCKED",
  "CANCELLED",
];

export const PRODUCTION_ORDER_STATUS_LABELS: Record<ProductionOrderStatus, string> = {
  DRAFT: "Rascunho",
  PLANNED: "Planejada",
  RELEASED: "Liberada",
  IN_PRODUCTION: "Em produção",
  COMPLETED: "Concluída",
  BLOCKED: "Bloqueada",
  CANCELLED: "Cancelada",
};

export type ProductionOrderOrigin = "MANUAL" | "STOCK_PRODUCTION" | "CUSTOMER_ORDER";

export const PRODUCTION_ORDER_ORIGIN_LABELS: Record<ProductionOrderOrigin, string> = {
  MANUAL: "Manual",
  STOCK_PRODUCTION: "Produção para Estoque",
  CUSTOMER_ORDER: "Pedido do Cliente",
};

/** Estado visual derivado — nunca persistido como status da OP. */
export type MaterialAvailabilityStatus = "AVAILABLE" | "SHORTAGE";
export type ProductionOrderMaterialsStatus = "MATERIALS_AVAILABLE" | "MATERIAL_SHORTAGE";

export interface SuggestedLotAllocationDTO {
  lotId: string;
  lotCode: string;
  expiryDate: string | null;
  location: string | null;
  suggestedQuantity: string;
}

export interface ProductionOrderRequirementDTO {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  /** Decimal como string — quantidade/unidade originais da fórmula. */
  formulaQuantity: string;
  formulaUnitCode: string;
  /**
   * SNAPSHOT vindo do componente da fórmula: de quem este material deve
   * vir. `CUSTOMER` só é atendível por lote do cliente desta OP.
   */
  supplyResponsibility: SupplyResponsibility;
  /** Dono elegível do estoque para esta necessidade — deriva de `supplyResponsibility` + cliente da OP. */
  eligibleOwnerType: InventoryOwnerType;
  eligibleOwnerCustomerId: string | null;
  eligibleOwnerCustomerName: string | null;
  /** `formulaQuantity × productionFactor`, já convertida para a unidade de estoque — fonte de verdade da necessidade técnica. */
  requiredQuantity: string;
  stockUnitCode: string;
  position: number;
  /** Calculado ao vivo a partir do Inventory Ledger — nunca persistido no Requirement. */
  onHand: string;
  /** Soma das MaterialReservationLine de reservas ACTIVE para este item — real a partir do RELEASE. */
  reserved: string;
  /** `onHand - reserved`, nunca negativo. */
  available: string;
  /** Informativo — nunca reduz `shortage`. */
  onOrder: string;
  /** `max(requiredQuantity - available, 0)`. */
  shortage: string;
  availabilityStatus: MaterialAvailabilityStatus;
  /** Sugestão FEFO/FIFO — nunca reserva, nunca persiste (a alocação oficial só existe em `ProductionOrderDTO.reservation` após RELEASED). */
  suggestedAllocations: SuggestedLotAllocationDTO[];
  /** Soma das linhas de reserva ATIVAS desta OP para este Requirement (próprias — nunca de outra OP). */
  allocatedQuantity: string;
  /** Soma do ProductionConsumption já confirmado para este Requirement. */
  consumedQuantity: string;
  /** `allocatedQuantity - consumedQuantity`, nunca negativo — o que ainda falta consumir do que foi reservado. */
  remainingReservedQuantity: string;
  /** Linhas de reserva (Picking/Consumo) deste Requirement — inclui linhas substituídas (histórico, `releasedAt` preenchido). */
  reservationLines: MaterialReservationLineDTO[];
}

/** ACTIVE conta em Reserved; RELEASED (reserva liberada, ex.: cancelamento de OP RELEASED) não conta mais. */
export type MaterialReservationStatus = "ACTIVE" | "RELEASED";

/** `PENDING` até o Picking confirmar fisicamente a linha; `CONFIRMED` depois. */
export type PickingStatus = "PENDING" | "CONFIRMED";

export interface MaterialReservationLineDTO {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  /** `null` quando o item não controla lote — quantidade reservada no nível do Item. */
  lotId: string | null;
  lotCode: string | null;
  supplierLot: string | null;
  expiryDate: string | null;
  location: string | null;
  lotStatus: string | null;
  quantity: string;
  unitCode: string;
  /** Soma do ProductionConsumption desta linha. */
  consumedQuantity: string;
  /** `quantity - consumedQuantity`, nunca negativo. */
  remainingQuantity: string;
  pickingStatus: PickingStatus;
  pickedAt: string | null;
  pickedBy: string | null;
  /** Preenchidos quando esta linha foi substituída no Picking — nunca apagada, só marcada. */
  releasedAt: string | null;
  releasedBy: string | null;
  releaseReason: string | null;
  /** `id` da linha original que esta linha substitui, quando esta linha nasceu de uma substituição. */
  replacesLineId: string | null;
}

export interface ProductionConsumptionDTO {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  lotId: string | null;
  lotCode: string | null;
  quantity: string;
  unitCode: string;
  consumedAt: string;
  consumedBy: string | null;
}

/**
 * Alocação oficial criada no RELEASE da OP — base do futuro Picking.
 * Nunca altera On Hand, nunca cria InventoryMovement. Histórica: nunca
 * deletada mesmo quando `status` vira `RELEASED`.
 */
export interface MaterialReservationDTO {
  id: string;
  productionOrderId: string;
  status: MaterialReservationStatus;
  createdAt: string;
  createdBy: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
  releaseReason: string | null;
  lines: MaterialReservationLineDTO[];
}

export interface ProductionOrderDTO {
  id: string;
  code: string;
  productId: string;
  productCode: string;
  productName: string;
  finishedItemId: string | null;
  finishedItemCode: string | null;
  finishedItemName: string | null;
  formulationVersionId: string | null;
  formulationVersionNumber: number | null;
  /** "V2" — `null` quando a OP ainda não tem versão de formulação definida. */
  formulationVersionLabel: string | null;
  plannedQuantity: string;
  outputUnitCode: string;
  /** `plannedQuantity / formulation.basisQuantity` — nunca persistido, sempre derivável. */
  productionFactor: string | null;
  status: ProductionOrderStatus;
  origin: ProductionOrderOrigin;
  materialsStatus: ProductionOrderMaterialsStatus;
  /** Quantos Requirements estão em SHORTAGE — para a coluna "Falta em N materiais" da listagem. */
  shortageItemCount: number;
  notes: string | null;
  /** Cliente da OP — obrigatório para liberar OP com material do cliente. */
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
  customerCnpj: string | null;
  /** Snapshot do cliente para o documento impresso — congelado no RELEASE. */
  customerTradeName: string | null;
  customerZipCode: string | null;
  customerStreet: string | null;
  customerNumber: string | null;
  customerComplement: string | null;
  customerDistrict: string | null;
  customerCity: string | null;
  customerState: string | null;
  /** `true` quando existe ao menos um Requirement com fornecimento do cliente. */
  hasCustomerSuppliedRequirements: boolean;
  /**
   * Numeração OFICIAL anual do documento (`023/26`), gerada no RELEASE.
   * `code` (OP-000123) continua sendo a identidade interna.
   */
  officialNumber: string | null;
  /** Em quantas frações a produção é executada. Congelado no RELEASE. */
  numberOfParts: number;
  /** Observações de rotulagem para a impressão do lote. */
  labelInstructions: string | null;
  /** Vida útil do produto (meses) — base da validade sugerida do lote. */
  shelfLifeMonths: number | null;
  /** Sugestão de lote comercial a partir da máscara configurada; `null` sem configuração. */
  suggestedBusinessLotNumber: string | null;
  /** Revisões dos documentos controlados congeladas nesta OP. */
  productionOrderRevision: ControlledDocumentRevisionDTO | null;
  recipeSheetRevision: ControlledDocumentRevisionDTO | null;
  requirements: ProductionOrderRequirementDTO[];
  plannedAt: string | null;
  plannedBy: string | null;
  releasedAt: string | null;
  releasedBy: string | null;
  /** `null` até o RELEASE. Depois disso, a alocação oficial de materiais da OP. */
  reservation: MaterialReservationDTO | null;
  /** Preenchido no PRIMEIRO consumo real confirmado (RELEASED → IN_PRODUCTION). */
  startedAt: string | null;
  startedBy: string | null;
  /** Histórico completo de eventos de consumo — nunca só o total agregado. */
  consumptions: ProductionConsumptionDTO[];
  /** Soma dos ProductionOutput da OP — nunca uma segunda coluna manual. */
  producedQuantity: string;
  /** `plannedQuantity - producedQuantity`, nunca negativo — "Restante" durante IN_PRODUCTION, "Variação" na conclusão (mesmo número). */
  remainingQuantity: string;
  /** Histórico completo de apontamentos de produção — nunca só o total agregado. */
  outputs: ProductionOutputDTO[];
  /** Lotes de produto acabado desta OP que ainda podem receber novo Output — para o seletor "Lote existente desta OP". */
  eligibleFinishedLots: EligibleFinishedLotDTO[];
  /** Preenchidos só quando `origin = "CUSTOMER_ORDER"` — a OP nasce DRAFT e segue o fluxo normal (nunca pula PLAN/RELEASE). */
  customerOrderId: string | null;
  customerOrderCode: string | null;
  customerOrderLineId: string | null;
  /** Preenchidos em IN_PRODUCTION → COMPLETED. */
  completedAt: string | null;
  completedBy: string | null;
  /** Obrigatório quando `remainingQuantity > 0` no momento da conclusão. */
  completionReason: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
}

/** Evento REAL e imutável de produção parcial — nunca só o total agregado. */
export interface ProductionOutputDTO {
  id: string;
  quantity: string;
  lotId: string | null;
  lotCode: string | null;
  businessLotNumber: string | null;
  producedAt: string;
  producedBy: string | null;
  notes: string | null;
}

/** Lote de produto acabado desta OP elegível para receber um novo Output (produção parcial no mesmo lote). */
export interface EligibleFinishedLotDTO {
  id: string;
  code: string;
  businessLotNumber: string | null;
  status: LotStatus;
  /** Soma dos Outputs já lançados neste lote. */
  producedQuantity: string;
}

export interface ProductionOrderListResponse {
  productionOrders: ProductionOrderDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateProductionOrderInput {
  productId: string;
  /** Omitido = usa a versão ACTIVE atual do Product, se houver. */
  formulationVersionId?: string;
  plannedQuantity?: string;
  notes?: string;
  origin?: ProductionOrderOrigin;
}

export interface UpdateProductionOrderInput {
  productId?: string;
  formulationVersionId?: string;
  plannedQuantity?: string;
  notes?: string;
}

export interface CancelProductionOrderInput {
  reason: string;
}

export interface ConfirmPickingInput {
  /** Código puro (`LT-...`) ou payload de QR (`LOT:LT-...`). Omitido para item sem controle de lote. */
  lotCode?: string;
}

export interface SubstituteReservationLineInput {
  /** Código puro (`LT-...`) ou payload de QR (`LOT:LT-...`) do lote alternativo. */
  lotCode: string;
}

export interface RecordConsumptionEntryInput {
  reservationLineId: string;
  quantity: string;
}

export interface RecordConsumptionInput {
  entries: RecordConsumptionEntryInput[];
}

/** `NEW_LOT`: cria lote de produto acabado novo. `EXISTING_LOT`: soma a um lote `PRODUCTION` já criado por esta mesma OP. */
export type ProductionOutputDestination = "NEW_LOT" | "EXISTING_LOT";

export interface RegisterProductionOutputInput {
  quantity: string;
  destination: ProductionOutputDestination;
  /** Obrigatório quando `destination = "EXISTING_LOT"`. */
  lotId?: string;
  /** Obrigatório quando `destination = "NEW_LOT"`. */
  businessLotNumber?: string;
  /** Obrigatório quando `destination = "NEW_LOT"` e o item controla validade. Ignorado em `EXISTING_LOT`. */
  expiryDate?: string;
  location?: string;
  notes?: string;
  /** Omitido = agora. */
  producedAt?: string;
}

export interface CompleteProductionOrderInput {
  /** Obrigatório quando `remainingQuantity > 0`. */
  completionReason?: string;
}

/* ─────────────── Folha de Receita (R.COQ.003) ─────────────── */

export type ProductionPartStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED";

export const PRODUCTION_PART_STATUS_LABELS: Record<ProductionPartStatus, string> = {
  PENDING: "Pendente",
  IN_PROGRESS: "Em execução",
  COMPLETED: "Concluída",
};

/** Uma pesagem real registrada por um operador identificado. */
export interface RecipeWeighingDTO {
  id: string;
  productionOrderPartId: string;
  productionOrderRequirementId: string;
  itemCode: string;
  itemName: string;
  lotId: string | null;
  lotCode: string | null;
  supplierLot: string | null;
  ownerType: InventoryOwnerType;
  plannedQuantity: string;
  actualQuantity: string;
  uomCode: string;
  executedByUserId: string;
  /** Nome no momento do registro — impressão histórica não depende do cadastro atual. */
  executedByName: string;
  executedAt: string;
  /** Consumo real gerado por esta pesagem — a baixa de estoque oficial. */
  productionConsumptionId: string | null;
  notes: string | null;
}

export interface RecipeSheetRequirementDTO {
  requirementId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  sourceName: string | null;
  declaredNutrient: string | null;
  supplyResponsibility: SupplyResponsibility;
  expectedOwnerCustomerName: string | null;
  /** Quanto esta parte deve pesar (divisão determinística em Decimal). */
  plannedQuantity: string;
  weighedQuantity: string;
  /** `pesado - planejado`: registrado e destacado, nunca bloqueado por tolerância inventada. */
  differenceQuantity: string;
  unitCode: string;
  reservedLots: { lotId: string | null; lotCode: string | null; quantity: string }[];
}

export interface RecipeSheetPartDTO {
  id: string;
  partNumber: number;
  status: ProductionPartStatus;
  startedAt: string | null;
  startedByName: string | null;
  completedAt: string | null;
  completedByName: string | null;
  requirements: RecipeSheetRequirementDTO[];
  weighings: RecipeWeighingDTO[];
}

export interface RecipeSheetPackagingDTO {
  requirementId: string;
  itemCode: string;
  itemName: string;
  supplyResponsibility: SupplyResponsibility;
  /** Embalagem nunca é fracionada: aparece com o total da OP. */
  totalQuantity: string;
  unitCode: string;
}

export interface RecipeSheetDTO {
  productionOrderId: string;
  /** Revisão do R.COQ.003 congelada nesta OP — a impressão usa esta, não a ativa de hoje. */
  recipeSheetRevision: ControlledDocumentRevisionDTO | null;
  productionOrderCode: string;
  officialNumber: string | null;
  productCode: string;
  productName: string;
  customerName: string | null;
  formulationVersionLabel: string | null;
  plannedQuantity: string;
  outputUnitCode: string;
  numberOfParts: number;
  status: ProductionOrderStatus;
  parts: RecipeSheetPartDTO[];
  packagingRequirements: RecipeSheetPackagingDTO[];
}

export interface RegisterWeighingInput {
  requirementId: string;
  lotCode: string;
  actualQuantity: string;
  notes?: string;
}
