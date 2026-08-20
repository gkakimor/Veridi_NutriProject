/**
 * Item × Fornecedor.
 *
 * A relação é estável (existe, tem código no fornecedor, está homologada,
 * é preferencial); preço e MOQ mudam no tempo e vivem em ofertas
 * imutáveis. Oferta é REFERÊNCIA COMERCIAL — nunca custo real de
 * aquisição, que continua vindo do recebimento.
 */

export type SupplierItemQualificationStatus = "PENDING" | "APPROVED" | "BLOCKED";

export const SUPPLIER_ITEM_QUALIFICATION_STATUSES: readonly SupplierItemQualificationStatus[] = [
  "PENDING",
  "APPROVED",
  "BLOCKED",
];

export const SUPPLIER_ITEM_QUALIFICATION_LABELS: Record<
  SupplierItemQualificationStatus,
  string
> = {
  // "Pendente" é só ausência de homologação aprovada — não é reprovação.
  PENDING: "Pendente",
  APPROVED: "Homologado",
  BLOCKED: "Bloqueado",
};

export type SupplierItemOfferSource = "MANUAL" | "LEGACY_IMPORT";

export const SUPPLIER_ITEM_OFFER_SOURCE_LABELS: Record<SupplierItemOfferSource, string> = {
  MANUAL: "Cadastrada no sistema",
  LEGACY_IMPORT: "Planilha (histórico)",
};

/** Moeda default de oferta nova. Não existe tabela de moedas nesta fase. */
export const DEFAULT_OFFER_CURRENCY = "BRL";

/** Aceita apenas o formato ISO de 3 letras; não valida contra uma lista fechada. */
export function isValidCurrencyCode(value: string): boolean {
  return /^[A-Za-z]{3}$/.test(value.trim());
}

export function normalizeCurrencyCode(value: string): string {
  return value.trim().toUpperCase();
}

export interface SupplierItemOfferDTO {
  id: string;
  supplierItemId: string;
  unitPrice: string;
  currencyCode: string;
  priceUomCode: string;
  minimumOrderQuantity: string | null;
  minimumOrderUomCode: string | null;
  /** `null` = observação histórica de preço, nunca preço vigente. */
  effectiveAt: string | null;
  validUntil: string | null;
  source: SupplierItemOfferSource;
  notes: string | null;
  createdAt: string;
  createdByName: string | null;
  /** Vigente agora segundo `effectiveAt`/`validUntil`. */
  isCurrent: boolean;
}

export interface SupplierItemQualificationEventDTO {
  id: string;
  fromStatus: SupplierItemQualificationStatus | null;
  toStatus: SupplierItemQualificationStatus;
  note: string | null;
  changedAt: string;
  changedByName: string | null;
}

export interface SupplierItemDTO {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemExternalCode: string | null;
  itemUnitCode: string;
  itemType: string;
  itemFamily: string | null;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  supplierActive: boolean;
  supplierItemCode: string | null;
  qualificationStatus: SupplierItemQualificationStatus;
  preferred: boolean;
  active: boolean;
  commercialNotes: string | null;
  /** Oferta vigente; `null` quando só existem referências históricas. */
  currentOffer: SupplierItemOfferDTO | null;
  /** Última oferta sem vigência confiável — mostrada como referência, nunca como preço atual. */
  latestLegacyOffer: SupplierItemOfferDTO | null;
  offerCount: number;
  createdAt: string;
  createdByName: string | null;
  updatedAt: string;
  updatedByName: string | null;
}

export interface SupplierItemDetailDTO extends SupplierItemDTO {
  offers: SupplierItemOfferDTO[];
  qualificationHistory: SupplierItemQualificationEventDTO[];
}

export interface SupplierItemListResponse {
  supplierItems: SupplierItemDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateSupplierItemInput {
  itemId: string;
  supplierId: string;
  supplierItemCode?: string | null;
  commercialNotes?: string | null;
  /**
   * Homologação, preferência e primeira oferta no mesmo cadastro.
   *
   * Todos opcionais: relação sem oferta continua sendo registro legítimo.
   * A oferta permanece entidade própria e imutável — o que mudou é apenas
   * quando ela pode ser informada, não como é guardada.
   */
  qualificationStatus?: "PENDING" | "APPROVED" | "BLOCKED";
  qualificationNote?: string | null;
  preferred?: boolean;
  initialOffer?: CreateSupplierItemOfferInput;
}

export interface UpdateSupplierItemInput {
  supplierItemCode?: string | null;
  commercialNotes?: string | null;
  active?: boolean;
}

export interface ChangeSupplierItemQualificationInput {
  status: SupplierItemQualificationStatus;
  note?: string | null;
}

export interface CreateSupplierItemOfferInput {
  unitPrice: string;
  currencyCode?: string;
  priceUomCode: string;
  minimumOrderQuantity?: string | null;
  minimumOrderUomCode?: string | null;
  effectiveAt?: string | null;
  validUntil?: string | null;
  notes?: string | null;
}
