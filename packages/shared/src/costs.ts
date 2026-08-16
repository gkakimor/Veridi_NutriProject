/**
 * Contratos da fundação de custos.
 *
 * Três conceitos SEMPRE distintos, nunca colapsados:
 * 1. **Preço da OC** (`PurchaseOrderLine.unitPrice`) — previsto/negociado;
 * 2. **Custo efetivo de aquisição** (`ReceiptLine.actualUnitCost`) — a
 *    referência real de custo do material recebido;
 * 3. **Valor efetivamente pago** — camada financeira futura, fora do MVP.
 *
 * Preço de OC nunca vira custo real automaticamente, e nunca alimenta as
 * médias de custo. Custo desconhecido é sempre `null`, nunca `0`.
 */

import type { InventoryOwnerType } from "./ownership.js";

/**
 * Qualidade/origem de uma referência unitária de custo.
 * - `REAL`: custo efetivo informado para a aquisição exata em questão.
 * - `ESTIMATED_30D`/`ESTIMATED_90D`: média ponderada por quantidade dos
 *   custos reais recebidos na janela, relativa à data de referência.
 * - `LAST_REAL_COST`: custo real mais recente conhecido (sem limite de idade).
 * - `NO_COST`: nenhum custo real aplicável — `unitCost` é `null`.
 */
export type CostSource = "REAL" | "ESTIMATED_30D" | "ESTIMATED_90D" | "LAST_REAL_COST" | "NO_COST";

export const COST_SOURCE_LABELS: Record<CostSource, string> = {
  REAL: "Real",
  ESTIMATED_30D: "Estimado 30 dias",
  ESTIMATED_90D: "Estimado 90 dias",
  LAST_REAL_COST: "Último custo real",
  NO_COST: "Sem custo",
};

export interface CostReferenceDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  /** `null` quando `source = "NO_COST"` — desconhecido nunca é `0`. */
  unitCost: string | null;
  source: CostSource;
  referenceDate: string;
  /** Contexto de como o número foi obtido (janela usada, nº de recebimentos, data do último custo). */
  details: string | null;
}

/** Qualidade agregada de um custo composto por vários itens/consumos. */
export type CostQuality = "REAL" | "ESTIMATED" | "PARTIAL" | "NO_COST";

export const COST_QUALITY_LABELS: Record<CostQuality, string> = {
  REAL: "Real",
  ESTIMATED: "Estimado",
  PARTIAL: "Parcial",
  NO_COST: "Sem custo",
};

export interface FormulationCostComponentDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  /** Quantidade/unidade originais da fórmula. */
  formulaQuantity: string;
  formulaUnitCode: string;
  /** Já convertida para a unidade de estoque do item. */
  normalizedQuantity: string;
  stockUnitCode: string;
  unitCost: string | null;
  costSource: CostSource;
  /** `normalizedQuantity × unitCost`; `null` quando o componente não tem custo. */
  estimatedComponentCost: string | null;
}

/**
 * Custo estimado de uma versão de formulação — SEMPRE uma previsão, mesmo
 * quando todos os componentes têm referência `REAL`. Nunca persistido: a
 * fórmula é histórica/imutável, a referência de custo muda com o tempo.
 * Por isso a qualidade agregada nunca é `REAL` aqui.
 */
export interface FormulationCostEstimateDTO {
  formulationVersionId: string;
  basisQuantity: string;
  outputUnitCode: string;
  referenceDate: string;
  components: FormulationCostComponentDTO[];
  /** `ESTIMATED` (todos com custo) / `PARTIAL` (alguns) / `NO_COST` (nenhum). */
  quality: Extract<CostQuality, "ESTIMATED" | "PARTIAL" | "NO_COST">;
  /** Só existe quando TODOS os componentes têm custo — `PARTIAL` nunca preenche isto. */
  estimatedMaterialCost: string | null;
  /** `estimatedMaterialCost / basisQuantity`. */
  estimatedMaterialUnitCost: string | null;
  /** Soma do que é conhecido — útil em `PARTIAL`, nunca apresentado como total. */
  knownCostSubtotal: string | null;
  /** Códigos dos itens sem referência de custo. */
  missingCostItems: string[];
}

export interface ProductionConsumptionCostDTO {
  consumptionId: string;
  /**
   * Dono do lote consumido. `CUSTOMER` = material fornecido pelo cliente:
   * fica FORA do custo de material da Veridi, e sua ausência de custo não
   * é "custo desconhecido" — é propriedade de terceiro.
   */
  ownerType: InventoryOwnerType;
  ownerCustomerName: string | null;
  itemId: string;
  itemCode: string;
  itemName: string;
  lotId: string | null;
  lotCode: string | null;
  quantity: string;
  unitCode: string;
  unitCost: string | null;
  costSource: CostSource;
  /** `quantity × unitCost`; `null` quando não há custo aplicável. */
  materialCost: string | null;
  /** Data usada como referência para o fallback — sempre o `consumedAt` do evento. */
  referenceDate: string;
}

/**
 * Custo de materiais de uma Ordem de Produção, calculado SEMPRE a partir
 * do `ProductionConsumption` realmente registrado — nunca de Requirement,
 * Reservation, sugestão FEFO ou formulação planejada.
 */
export interface ProductionOrderMaterialCostDTO {
  productionOrderId: string;
  consumptions: ProductionConsumptionCostDTO[];
  /**
   * Qualidade avaliada SOMENTE sobre os consumos da Veridi — material do
   * cliente nunca rebaixa a qualidade para `PARTIAL`.
   */
  quality: CostQuality;
  /** `true` quando ao menos um consumo veio de lote do cliente. */
  hasCustomerSuppliedMaterials: boolean;
  /** Quantos consumos foram de material do cliente — nunca valorados. */
  customerSuppliedConsumptionCount: number;
  /** Só existe quando a qualidade é `REAL` ou `ESTIMATED` — `PARTIAL` deixa `null`. */
  totalMaterialCost: string | null;
  /** Soma do que é conhecido — útil em `PARTIAL`, nunca apresentado como total. */
  knownMaterialCostSubtotal: string | null;
  /** Soma dos `ProductionOutput` — divisor do custo unitário, nunca `plannedQuantity`. */
  producedQuantity: string;
  outputUnitCode: string;
  /** `totalMaterialCost / producedQuantity`; `null` sem produção ou sem total. */
  materialUnitCost: string | null;
  /** Códigos dos itens consumidos sem referência de custo. */
  missingCostItems: string[];
}

export interface SetAcquisitionCostInput {
  /** `>= 0`; string vazia limpa o custo (volta a desconhecido). */
  unitCost: string;
  note?: string;
}
