import type { ProductionOrderMaterialCostDTO } from "./costs.js";
import type { CustomerOrderDTO } from "./customer-orders.js";
import type { ProductionOrderDTO } from "./production-orders.js";

/**
 * Seleção em massa como contrato entre tela e servidor
 * (BULK-SELECTION-FOUNDATION-01, BULK-DOCUMENTS-01).
 *
 * `ids`: os registros escolhidos um a um. `filtered`: o filtro da listagem —
 * o MESMO objeto da consulta e do CSV — menos as exceções desmarcadas. O
 * servidor resolve o conjunto no momento da ação.
 */
export type BulkSelectionDescriptor<F> =
  | { mode: "ids"; ids: string[] }
  | { mode: "filtered"; filters: F; excludedIds: string[] };

/**
 * Teto do PDF combinado. Acima dele a seleção é recusada inteira — nunca
 * cortada nos primeiros. O CSV não tem este teto.
 */
export const BULK_PDF_SELECTION_LIMIT = 500;

/** Os Pedidos da seleção, prontos para o documento oficial de cada um. */
export interface CustomerOrderSelectionDocumentsResponse {
  total: number;
  documents: CustomerOrderDTO[];
}

/** O que o documento oficial da OP recebe: a ordem e o custo complementar. */
export interface ProductionOrderSelectionDocument {
  order: ProductionOrderDTO;
  cost: ProductionOrderMaterialCostDTO | null;
}

export interface ProductionOrderSelectionDocumentsResponse {
  total: number;
  documents: ProductionOrderSelectionDocument[];
}
