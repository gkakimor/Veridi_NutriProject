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

/**
 * Família industrial do Item (capacidade 33). Lista fixa nesta fase — não
 * existe cadastro configurável de famílias.
 */
export type ItemFamily =
  | "VITAMIN"
  | "MINERAL"
  | "AMINO_ACID"
  | "EXCIPIENT"
  | "BOTANICAL"
  | "OTHER_RAW_MATERIAL"
  | "PACKAGING"
  | "OTHER";

export const ITEM_FAMILIES: readonly ItemFamily[] = [
  "VITAMIN",
  "MINERAL",
  "AMINO_ACID",
  "EXCIPIENT",
  "BOTANICAL",
  "OTHER_RAW_MATERIAL",
  "PACKAGING",
  "OTHER",
];

export const ITEM_FAMILY_LABELS: Record<ItemFamily, string> = {
  VITAMIN: "Vitamina",
  MINERAL: "Mineral",
  AMINO_ACID: "Aminoácido",
  EXCIPIENT: "Excipiente",
  BOTANICAL: "Botânico",
  OTHER_RAW_MATERIAL: "Outra matéria-prima",
  PACKAGING: "Embalagem",
  OTHER: "Outro",
};

/** Subtipo de embalagem — só se aplica a `type = PACKAGING`. */
export type PackagingSubtype =
  | "POT"
  | "CAP"
  | "SCOOP"
  | "SEAL"
  | "LABEL"
  | "BOX"
  | "POUCH"
  | "CARTON"
  | "BOTTLE"
  | "OTHER";

export const PACKAGING_SUBTYPES: readonly PackagingSubtype[] = [
  "POT",
  "CAP",
  "SCOOP",
  "SEAL",
  "LABEL",
  "BOX",
  "POUCH",
  "CARTON",
  "BOTTLE",
  "OTHER",
];

export const PACKAGING_SUBTYPE_LABELS: Record<PackagingSubtype, string> = {
  POT: "Pote",
  CAP: "Tampa",
  SCOOP: "Dosador",
  SEAL: "Selo",
  LABEL: "Rótulo",
  BOX: "Caixa",
  POUCH: "Sachê/Pouch",
  CARTON: "Cartucho",
  BOTTLE: "Frasco",
  OTHER: "Outro",
};

export type UomDimension = "MASS" | "COUNT" | "VOLUME";

export interface UnitOfMeasureDTO {
  code: string;
  label: string;
  dimension: UomDimension;
  /**
   * Fator para a base da dimensão, como decimal-string.
   *
   * A tela precisa dele para converter unidade sem pedir ao servidor — a
   * Formulação mostra o físico por unidade de estoque enquanto a pessoa digita
   * em mg. Sem o fator, a prévia teria de escolher entre uma ida ao servidor a
   * cada tecla ou uma tabela de conversão duplicada no front.
   */
  toBaseFactor: string;
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
  /** Exige laudo/CoA aprovado no lote. Conceito independente da liberação manual. */
  requiresCoa: boolean;
  /** Fonte / forma química realmente utilizada (ex.: "Cloridrato de tiamina"). */
  sourceName: string | null;
  /** Denominação nutricional declarada (ex.: "Vitamina B1"). */
  declaredNutrient: string | null;
  family: ItemFamily | null;
  /**
   * Pureza padrão em % (0 < x <= 100). `null` significa DESCONHECIDA — nunca
   * deve ser interpretada como 100%. É apenas o default de novas
   * formulações; a pureza aplicada será congelada no componente (cap. 34).
   */
  defaultPurityPercent: string | null;
  /** Preenchido apenas quando `type = PACKAGING`. */
  packagingSubtype: PackagingSubtype | null;
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
  requiresCoa?: boolean;
  externalBarcode?: string;
}

export interface UpdateItemInput {
  type?: ItemType;
  name?: string;
  unitCode?: string;
  controlsLot?: boolean;
  controlsExpiry?: boolean;
  requiresQualityRelease?: boolean;
  requiresCoa?: boolean;
  externalBarcode?: string;
}
