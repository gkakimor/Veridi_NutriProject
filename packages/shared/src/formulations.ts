/** Contratos do módulo de Formulações/Versionamento, consumidos por `apps/api` e `apps/web`. */

import type { ItemType } from "./items.js";
import type { SupplyResponsibility } from "./ownership.js";

export type FormulationVersionStatus = "DRAFT" | "ACTIVE" | "INACTIVE";

export const FORMULATION_VERSION_STATUSES: readonly FormulationVersionStatus[] = [
  "DRAFT",
  "ACTIVE",
  "INACTIVE",
];

export const FORMULATION_VERSION_STATUS_LABELS: Record<FormulationVersionStatus, string> = {
  DRAFT: "Rascunho",
  ACTIVE: "Ativa",
  INACTIVE: "Inativa",
};

/**
 * Modo de cálculo da versão. `FIXED_BASIS` é o modelo original ("estas
 * quantidades produzem esta base"); `PER_DOSE` declara a fórmula por dose
 * do produto acabado, como a indústria trabalha.
 */
export type FormulationCalculationMode = "FIXED_BASIS" | "PER_DOSE";

export const FORMULATION_CALCULATION_MODES: readonly FormulationCalculationMode[] = [
  "FIXED_BASIS",
  "PER_DOSE",
];

export const FORMULATION_CALCULATION_MODE_LABELS: Record<FormulationCalculationMode, string> = {
  FIXED_BASIS: "Base fixa",
  PER_DOSE: "Por dose",
};

/** Base de cálculo do COMPONENTE — declarada linha a linha. */
export type FormulationComponentBasis = "FIXED_BASIS" | "PER_DOSE" | "PER_FINISHED_UNIT";

export const FORMULATION_COMPONENT_BASES: readonly FormulationComponentBasis[] = [
  "FIXED_BASIS",
  "PER_DOSE",
  "PER_FINISHED_UNIT",
];

export const FORMULATION_COMPONENT_BASIS_LABELS: Record<FormulationComponentBasis, string> = {
  FIXED_BASIS: "Base da fórmula",
  PER_DOSE: "Por dose",
  PER_FINISHED_UNIT: "Por unidade acabada",
};

export interface FormulationComponentDTO {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  itemActive: boolean;
  /** Decimal como string — nunca float JS. */
  quantity: string;
  unitCode: string;
  basis: FormulationComponentBasis;
  /**
   * Quem deve fornecer este componente. Intenção declarada na fórmula e
   * congelada na versão — nunca é o dono do lote físico.
   */
  supplyResponsibility: SupplyResponsibility;
  /**
   * SNAPSHOT da pureza aplicada (0 < x <= 100). `null` significa
   * DESCONHECIDA: nenhuma correção é aplicada — nunca se assume 100%.
   * Alterar `Item.defaultPurityPercent` depois não muda esta versão.
   */
  purityPercentApplied: string | null;
  /** Perda/excesso de processo em %; `null` = não informado. */
  overagePercent: string | null;
  /** Referência histórica da planilha — nunca entra no cálculo. */
  legacyTotalQuantity: string | null;
  legacyTotalUnitCode: string | null;
  legacyBatchUnits: string | null;
  /** Só exibição — equivalente na unidade de estoque do Item; nunca fonte de verdade. */
  stockEquivalentQuantity: string;
  stockUnitCode: string;
  /** Necessidade teórica para uma unidade acabada, antes de pureza/overage. */
  theoreticalPerUnit: string;
  /** Necessidade física para uma unidade acabada, já com pureza/overage. */
  physicalPerUnit: string;
  notes: string | null;
  position: number;
}

/**
 * Problema num componente que impede ativar a versão.
 *
 * Existe porque uma versão pode ser criada a partir de outra criada meses
 * antes: o item pode ter sido inativado, mudado de tipo ou trocado de
 * unidade nesse intervalo. A cópia mantém a receita — alterar uma fórmula
 * em silêncio seria pior que copiá-la quebrada — e diz o que vai barrar a
 * ativação, em vez de deixar a descoberta para o clique final.
 */
export interface FormulationComponentIssueDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  code: "ITEM_INACTIVE" | "ITEM_IS_FINISHED_PRODUCT" | "UOM_INCOMPATIBLE" | "INVALID_QUANTITY";
  description: string;
}

export interface FormulationVersionDTO {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  versionNumber: number;
  /** Rótulo de apresentação — "V1", "V2"... nunca persistido separadamente. */
  versionLabel: string;
  status: FormulationVersionStatus;
  basisQuantity: string;
  calculationMode: FormulationCalculationMode;
  /** Obrigatório no modo `PER_DOSE`; `null` no `FIXED_BASIS`. */
  dosesPerPackage: number | null;
  outputItemId: string;
  outputItemCode: string;
  outputItemName: string;
  outputUnitCode: string;
  notes: string | null;
  components: FormulationComponentDTO[];
  createdAt: string;
  createdBy: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  inactivatedAt: string | null;
  inactivatedBy: string | null;
  /**
   * Versão que serviu de molde. `null` na V1 e nas versões criadas antes de
   * o campo existir.
   */
  sourceVersionId: string | null;
  sourceVersionNumber: number | null;
  /**
   * Só para versões em RASCUNHO: uma versão ativa ou histórica é um
   * documento fechado, e apontar problema nela seria sugerir edição onde
   * não há edição possível.
   */
  componentIssues: FormulationComponentIssueDTO[];
}

export interface FormulationSummaryDTO {
  productId: string;
  productCode: string;
  productName: string;
  customerName: string | null;
  finishedProductItemId: string | null;
  finishedProductItemCode: string | null;
  activeVersionId: string | null;
  activeVersionLabel: string | null;
  /** `true` se existe ao menos uma versão (DRAFT/ACTIVE/INACTIVE) para o produto. */
  hasFormulation: boolean;
  updatedAt: string | null;
}

/**
 * O que fica defasado se esta versão virar a ativa.
 *
 * Ativar não muda documento nenhum — é justamente por isso que a lista
 * existe. O raio de impacto só é útil ANTES do clique, quando ainda dá para
 * cancelar; depois, viraria constatação.
 *
 * Estrutura de custos ATIVA aparece para ser lida, não consertada: a receita
 * dela é o que o custo já significa. Rascunho de estrutura e OP em rascunho
 * aparecem porque têm saída — um clique e uma troca de versão.
 */
export interface FormulationActivationImpactDTO {
  costStructures: {
    id: string;
    code: string;
    label: string;
    status: "DRAFT" | "ACTIVE";
    formulationVersionNumber: number;
  }[];
  /**
   * Só ordens em RASCUNHO: uma OP planejada já congelou seus requisitos, e
   * trocar a formulação ativa não a alcança.
   */
  productionOrders: {
    id: string;
    code: string;
    formulationVersionNumber: number;
  }[];
}

export interface FormulationListResponse {
  formulations: FormulationSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface FormulationVersionListResponse {
  versions: FormulationVersionDTO[];
}

export interface FormulationComponentInput {
  itemId: string;
  quantity: string;
  unitCode: string;
  basis?: FormulationComponentBasis;
  supplyResponsibility?: SupplyResponsibility;
  purityPercentApplied?: string | null;
  overagePercent?: string | null;
  legacyTotalQuantity?: string | null;
  legacyTotalUnitCode?: string | null;
  legacyBatchUnits?: string | null;
  notes?: string;
}

export interface CreateFormulationVersionInput {
  notes?: string;
}

export interface UpdateFormulationVersionInput {
  basisQuantity?: string;
  calculationMode?: FormulationCalculationMode;
  dosesPerPackage?: number | string | null;
  notes?: string;
  components?: FormulationComponentInput[];
}
