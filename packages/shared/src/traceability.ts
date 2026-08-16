/**
 * Contratos de rastreabilidade bidirecional de lote, consumidos por
 * `apps/api` e `apps/web`. Genealogia baseada SEMPRE em
 * ProductionConsumption (o que foi realmente consumido) e
 * ProductionOutput (o que foi realmente produzido) — nunca no que foi
 * planejado/requerido/reservado/sugerido pelo FEFO.
 */

import type { InventoryOwnerType } from "./ownership.js";
import type { CoaStatus } from "./lots.js";
import type { ProjectSampleStatus } from "./samples.js";

export interface TraceabilityConsumedMaterialDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  lotId: string | null;
  lotCode: string | null;
  supplierLot: string | null;
  supplierName: string | null;
  /** Proprietário do lote consumido — a genealogia preserva de quem era o material. */
  ownerType: InventoryOwnerType;
  ownerCustomerName: string | null;
  /** Situação documental do lote consumido, preservada na genealogia. */
  coaStatus: CoaStatus;
  quantity: string;
  unitCode: string;
}

/** Rastreabilidade BACKWARD — de um lote de produto acabado até as matérias-primas realmente consumidas. */
/** Metadados do documento — a genealogia nunca embute o binário. */
export interface TraceabilityDocumentDTO {
  id: string;
  originalFileName: string;
  uploadedAt: string;
  uploadedByName: string;
}

export interface FinishedLotTraceabilityDTO {
  kind: "FINISHED_GOOD";
  lotId: string;
  lotCode: string;
  businessLotNumber: string | null;
  productionOrderId: string;
  productionOrderCode: string;
  productId: string;
  productCode: string;
  productName: string;
  /** Soma dos ProductionOutput deste lote. */
  producedQuantity: string;
  unitCode: string;
  consumedMaterials: TraceabilityConsumedMaterialDTO[];
}

export interface RawMaterialUsageFinishedLotDTO {
  lotId: string;
  lotCode: string;
  businessLotNumber: string | null;
  producedQuantity: string;
}

export interface RawMaterialUsageDTO {
  productionOrderId: string;
  productionOrderCode: string;
  productId: string;
  productCode: string;
  productName: string;
  /** Quanto deste lote de matéria-prima/embalagem foi realmente consumido nesta OP. */
  consumedQuantity: string;
  unitCode: string;
  /** Lote(s) de produto acabado gerados por esta OP — nunca inferido, sempre os ProductionOutput reais. */
  finishedLots: RawMaterialUsageFinishedLotDTO[];
}

/** Rastreabilidade FORWARD — de um lote de matéria-prima/embalagem até os produtos acabados gerados. */
export interface RawMaterialSampleUsageDTO {
  sampleId: string;
  sampleCode: string;
  testLabel: string;
  projectCode: string;
  projectName: string;
  customerName: string;
  sampleStatus: ProjectSampleStatus;
  consumedQuantity: string;
  unitCode: string;
  consumedAt: string;
}

export interface RawMaterialLotTraceabilityDTO {
  kind: "RAW_MATERIAL";
  lotId: string;
  lotCode: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  /** Situação documental do lote — parte da rastreabilidade, não do estoque. */
  coaStatus: CoaStatus;
  /** Metadados dos laudos anexados; o conteúdo binário nunca entra aqui. */
  coaDocuments: TraceabilityDocumentDTO[];
  usedIn: RawMaterialUsageDTO[];
  /**
   * Amostras/pilotos que consumiram este lote. Material usado em teste saiu
   * fisicamente do estoque — a rastreabilidade para frente precisa mostrar
   * isso mesmo sem Ordem de Produção envolvida.
   */
  usedInSamples: RawMaterialSampleUsageDTO[];
}

export type LotTraceabilityDTO = FinishedLotTraceabilityDTO | RawMaterialLotTraceabilityDTO;
