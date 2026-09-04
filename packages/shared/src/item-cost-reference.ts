/**
 * Referência manual de custo do Item.
 *
 * Uma referência é uma ESTIMATIVA declarada por gente. Não representa
 * compra, recebimento, valor efetivamente pago nem custo real histórico.
 * Serve para calcular CMV e estimativas antes de existir compra real ou
 * oferta válida de fornecedor.
 *
 * Histórico por vigência: alterar a referência cria uma linha nova; a
 * anterior permanece. A referência válida numa data é a de maior "válido
 * desde" até aquele dia.
 */

import type { IndustrialMaterialCostSource } from "./industrial-cost-calculation.js";

export interface ItemCostReferenceDTO {
  id: string;
  itemId: string;
  /** Decimal como string — nunca float. Por `uomCode`. */
  unitCost: string;
  currencyCode: string;
  uomCode: string;
  /** Dia de calendário (ISO) a partir do qual vale. */
  effectiveFrom: string;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
  /** `true` na vigência que vale na data consultada. */
  current: boolean;
}

export interface CreateItemCostReferenceInput {
  /** `>= 0`. Zero é zero explícito. */
  unitCost: string;
  /** Padrão: unidade do item. Precisa ser da mesma dimensão. */
  uomCode?: string | undefined;
  /** Padrão: hoje. */
  effectiveFrom?: string | undefined;
  note?: string | null | undefined;
}

/**
 * O que a seleção automática escolhe para o item numa data — a MESMA
 * regra canônica do cálculo de custo, exposta para a tela do item dizer
 * se a referência manual está sendo usada ou se uma compra real vence.
 */
export interface ItemCostSelectionDTO {
  /** Na unidade do item; `null` quando desconhecido — nunca zero. */
  unitCost: string | null;
  unitCode: string;
  source: IndustrialMaterialCostSource;
  details: string | null;
  referenceDate: string;
}

export interface ItemCostReferencesResponse {
  itemId: string;
  itemCode: string;
  itemName: string;
  itemUnitCode: string;
  /** Referência válida na data consultada; `null` = "Não informado". */
  current: ItemCostReferenceDTO | null;
  /** Todas as vigências, da mais recente para a mais antiga. */
  history: ItemCostReferenceDTO[];
  /** Fonte que a seleção automática usaria HOJE para este item. */
  automatic: ItemCostSelectionDTO;
}
