/** Contratos do módulo de Itens, consumidos por `apps/api` e `apps/web`. */

export type ItemType = "RAW_MATERIAL" | "PACKAGING" | "FINISHED_PRODUCT";

export const ITEM_TYPES: readonly ItemType[] = [
  "RAW_MATERIAL",
  "PACKAGING",
  "FINISHED_PRODUCT",
];

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  RAW_MATERIAL: "Matéria-prima",
  PACKAGING: "Material de embalagem",
  FINISHED_PRODUCT: "Produto acabado",
};

/** Prefixo do código interno exibido ao usuário (ex.: MP-000001). */
export const ITEM_TYPE_PREFIXES: Record<ItemType, string> = {
  RAW_MATERIAL: "MP",
  PACKAGING: "ME",
  FINISHED_PRODUCT: "PA",
};

/**
 * Defaults de UX por tipo — ver docs/PRODUCT_RULES.md#4.
 * Editáveis pelo usuário no cadastro; aplicados pelo backend quando o
 * cliente não informa `controlsLot`/`controlsExpiry` explicitamente.
 */
export const ITEM_TYPE_DEFAULTS: Record<
  ItemType,
  { controlsLot: boolean; controlsExpiry: boolean; requiresQualityRelease: boolean }
> = {
  RAW_MATERIAL: { controlsLot: true, controlsExpiry: true, requiresQualityRelease: true },
  PACKAGING: { controlsLot: true, controlsExpiry: false, requiresQualityRelease: false },
  FINISHED_PRODUCT: { controlsLot: true, controlsExpiry: true, requiresQualityRelease: true },
};

export type UomDimension = "MASS" | "COUNT" | "VOLUME";

export interface UnitOfMeasureDTO {
  code: string;
  label: string;
  dimension: UomDimension;
}

export interface ItemDTO {
  id: string;
  code: string;
  type: ItemType;
  name: string;
  unitCode: string;
  unit: UnitOfMeasureDTO;
  controlsLot: boolean;
  controlsExpiry: boolean;
  requiresQualityRelease: boolean;
  externalBarcode: string | null;
  active: boolean;
  /**
   * `true` quando o item já tem referência em PurchaseOrderLine, ReceiptLine,
   * Lot ou InventoryMovement — nesse caso `type`/`unitCode`/`controlsLot`/
   * `controlsExpiry` ficam bloqueados para nunca corromper o significado de
   * histórico já registrado.
   */
  operationallyUsed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ItemListResponse {
  items: ItemDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateItemInput {
  type: ItemType;
  name: string;
  unitCode: string;
  controlsLot?: boolean;
  controlsExpiry?: boolean;
  requiresQualityRelease?: boolean;
  externalBarcode?: string;
}

export interface UpdateItemInput {
  type?: ItemType;
  name?: string;
  unitCode?: string;
  controlsLot?: boolean;
  controlsExpiry?: boolean;
  requiresQualityRelease?: boolean;
  externalBarcode?: string;
}
