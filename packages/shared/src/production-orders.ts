/** Contratos do módulo de Ordem de Produção + Requirements, consumidos por `apps/api` e `apps/web`. */

import type { ItemType } from "./items.js";

export const PRODUCTION_ORDER_CODE_PREFIX = "OP";

/**
 * Lifecycle completo do roadmap — esta entrega só implementa
 * DRAFT→PLANNED e DRAFT/PLANNED→CANCELLED. RELEASED em diante chega
 * junto de Material Reservation.
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

/** CUSTOMER_ORDER fica para o Bloco D — não criar referência fake agora. */
export type ProductionOrderOrigin = "MANUAL" | "STOCK_PRODUCTION";

export const PRODUCTION_ORDER_ORIGIN_LABELS: Record<ProductionOrderOrigin, string> = {
  MANUAL: "Manual",
  STOCK_PRODUCTION: "Produção para Estoque",
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
  /** `formulaQuantity × productionFactor`, já convertida para a unidade de estoque — fonte de verdade da necessidade técnica. */
  requiredQuantity: string;
  stockUnitCode: string;
  position: number;
  /** Calculado ao vivo a partir do Inventory Ledger — nunca persistido no Requirement. */
  onHand: string;
  /** Sempre "0" nesta entrega — Reservation ainda não existe. */
  reserved: string;
  available: string;
  /** Informativo — nunca reduz `shortage`. */
  onOrder: string;
  /** `max(requiredQuantity - available, 0)`. */
  shortage: string;
  availabilityStatus: MaterialAvailabilityStatus;
  /** Sugestão FEFO/FIFO — nunca reserva, nunca persiste. */
  suggestedAllocations: SuggestedLotAllocationDTO[];
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
  customerCode: string | null;
  customerName: string | null;
  customerCnpj: string | null;
  requirements: ProductionOrderRequirementDTO[];
  plannedAt: string | null;
  plannedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
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
