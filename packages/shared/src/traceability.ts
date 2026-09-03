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
  /**
   * Para quem este lote foi produzido e para onde saiu.
   *
   * SEMPRE presente em lote de produto acabado, mesmo sem pedido de origem e
   * sem nenhuma saída — nesse caso os campos de origem vêm `null` e a lista
   * de saídas vem vazia, e a tela diz que o lote não foi expedido. Devolver
   * `null` fazia a seção sumir por inteiro, e silêncio não é resposta para a
   * pergunta de recall.
   *
   * Deliberadamente **fora** de `consumedMaterials`: cliente não é origem
   * de material, e a tela apresenta os dois como seções distintas —
   * genealogia de produção de um lado, destino comercial do outro.
   */
  commercialDestination: TraceabilityCommercialDestinationDTO | null;
}

/**
 * Origem comercial e destino físico são duas perguntas diferentes.
 *
 * **Origem** é por que o lote foi produzido: o Pedido que motivou a OP. Pode
 * não existir — uma OP para estoque não tem pedido.
 *
 * **Destino** é para onde o lote de fato saiu, e é a pergunta de recall.
 * Estoque acabado é fungível: um lote produzido para um pedido pode
 * legitimamente atender outro, e isso não é anomalia. Enquanto as expedições
 * eram buscadas pelo pedido da OP, um lote expedido por outro pedido era
 * reportado como **não expedido** — negativa falsa na única pergunta que
 * precisa ser respondida quando um lote é recolhido do mercado.
 */
export interface TraceabilityCommercialDestinationDTO {
  /** Pedido que motivou a produção. `null` quando a OP foi para estoque. */
  customerOrderId: string | null;
  customerOrderCode: string | null;
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  /**
   * Saídas físicas: expedições CONFIRMED cujas linhas apontam para **este**
   * lote, qualquer que seja o pedido atendido.
   */
  shipments: TraceabilityShipmentDTO[];
}

export interface TraceabilityShipmentDTO {
  shipmentId: string;
  shipmentCode: string;
  shipmentDate: string | null;
  quantity: string;
  /** O pedido REALMENTE atendido por esta saída — nem sempre o da OP. */
  customerOrderId: string;
  customerOrderCode: string;
  customerId: string;
  customerCode: string;
  customerName: string;
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
  /** Identidade do projeto — a rastreabilidade cita, e a citação abre. */
  projectId: string;
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
