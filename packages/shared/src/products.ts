/** Contratos do módulo de Produtos, consumidos por `apps/api` e `apps/web`. */

export const PRODUCT_CODE_PREFIX = "PROD";

export interface ProductCustomerSummary {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
}

export interface ProductFinishedItemSummary {
  id: string;
  code: string;
  name: string;
}

/** Forma farmacêutica do produto. */
export type DosageForm = "CAPSULE" | "POWDER" | "TABLET" | "LIQUID" | "OTHER";

export const DOSAGE_FORMS: readonly DosageForm[] = [
  "CAPSULE",
  "POWDER",
  "TABLET",
  "LIQUID",
  "OTHER",
];

export const DOSAGE_FORM_LABELS: Record<DosageForm, string> = {
  CAPSULE: "Cápsula",
  POWDER: "Pó",
  TABLET: "Comprimido",
  LIQUID: "Líquido",
  OTHER: "Outro",
};

/** Apresentação comercial — não confundir com o Item de embalagem. */
export type PresentationType = "POT" | "POUCH" | "CARTON" | "BULK" | "BOTTLE" | "OTHER";

export const PRESENTATION_TYPES: readonly PresentationType[] = [
  "POT",
  "POUCH",
  "CARTON",
  "BULK",
  "BOTTLE",
  "OTHER",
];

export const PRESENTATION_TYPE_LABELS: Record<PresentationType, string> = {
  POT: "Pote",
  POUCH: "Sachê/Pouch",
  CARTON: "Cartucho",
  BULK: "Granel",
  BOTTLE: "Frasco",
  OTHER: "Outra",
};

/**
 * Público-alvo declarado. **Somente cadastro descritivo** nesta fase:
 * nenhuma regra regulatória (IDR, %VD, limites ANVISA) depende dele — isso
 * é o gate do Bloco H.
 */
export type TargetAgeGroup = "ADULT" | "CHILD" | "PREGNANT" | "LACTATING" | "OTHER";

export const TARGET_AGE_GROUPS: readonly TargetAgeGroup[] = [
  "ADULT",
  "CHILD",
  "PREGNANT",
  "LACTATING",
  "OTHER",
];

export const TARGET_AGE_GROUP_LABELS: Record<TargetAgeGroup, string> = {
  ADULT: "Adulto",
  CHILD: "Infantil",
  PREGNANT: "Gestante",
  LACTATING: "Lactante",
  OTHER: "Outro",
};

/**
 * Produto em DESENVOLVIMENTO é entidade técnica do projeto: formulação,
 * custo e preço sim; pedido, produção comercial, expedição e faturamento
 * não. Aprovar não troca o produto — promove o mesmo.
 */
export type ProductLifecycle = "DEVELOPMENT" | "APPROVED";

export const PRODUCT_LIFECYCLE_LABELS: Record<ProductLifecycle, string> = {
  DEVELOPMENT: "Em desenvolvimento",
  APPROVED: "Aprovado",
};

export interface ProductDTO {
  id: string;
  code: string;
  name: string;
  customerId: string | null;
  customer: ProductCustomerSummary | null;
  lifecycle: ProductLifecycle;
  /** Projeto que criou o produto técnico; `null` em produto legado. */
  originProjectId: string | null;
  finishedProductItemId: string | null;
  finishedProductItem: ProductFinishedItemSummary | null;
  /** Perfil industrial (capacidade 33) — cadastro, sem efeito em cálculo. */
  dosageForm: DosageForm | null;
  presentationType: PresentationType | null;
  capsulesPerDose: number | null;
  /** Dose declarada; `doseUomCode` pode diferir da unidade de estoque. */
  doseAmount: string | null;
  doseUomCode: string | null;
  dosesPerPackage: number | null;
  unitsPerShippingBox: number | null;
  targetAgeGroup: TargetAgeGroup | null;
  /** Vida útil padrão em meses — referência, não altera lote automaticamente. */
  shelfLifeMonths: number | null;
  /** Código do produto na máscara de lote comercial (ex.: "0340") — só alimenta a sugestão. */
  businessLotCode: string | null;
  /** Na unidade do Finished Product Item (por isso não há `minimumBatchUom`). */
  minimumBatchQuantity: string | null;
  /** Versão ACTIVE da formulação, quando existir. */
  activeFormulationVersionId: string | null;
  activeFormulationVersionLabel: string | null;
  externalCode: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListResponse {
  products: ProductDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateProductInput {
  name: string;
  customerId?: string;
  finishedProductItemId?: string;
  /**
   * Enum ou `""` para limpar — o backend valida o domínio. Números chegam
   * como string do formulário e são convertidos no servidor, nunca por
   * float no browser.
   */
  dosageForm?: DosageForm | "" | null;
  presentationType?: PresentationType | "" | null;
  capsulesPerDose?: number | string | null;
  doseAmount?: string | null;
  doseUomCode?: string | null;
  dosesPerPackage?: number | string | null;
  unitsPerShippingBox?: number | string | null;
  targetAgeGroup?: TargetAgeGroup | "" | null;
  shelfLifeMonths?: number | string | null;
  businessLotCode?: string | null;
  minimumBatchQuantity?: string | null;
  externalCode?: string;
  notes?: string;
}

export interface UpdateProductInput {
  name?: string;
  customerId?: string;
  finishedProductItemId?: string;
  externalCode?: string;
  notes?: string;
}
