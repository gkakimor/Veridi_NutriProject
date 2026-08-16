/**
 * Contratos da visão operacional de Produto Acabado.
 *
 * **Consulta read-only** — não existe entidade nova nem segundo estoque.
 * Cada linha é um `Lot` com `origin = PRODUCTION`, e os números vêm das
 * fontes que já são verdade:
 * - produzido → soma dos `ProductionOutput` do lote;
 * - On Hand/Reserved/Available → Inventory Ledger (nunca a quantidade
 *   produzida como se fosse saldo);
 * - qualidade → status efetivo do lote (mesma regra de sempre);
 * - custo → serviço da Fundação de Custos, nunca recalculado aqui.
 */

import type { CostQuality, CostSource } from "./costs.js";
import type { LotStatus } from "./lots.js";

export interface FinishedGoodRowDTO {
  lotId: string;
  lotCode: string;
  businessLotNumber: string | null;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  productionOrderId: string | null;
  productionOrderCode: string | null;
  /** Data do primeiro apontamento de produção deste lote. */
  producedAt: string | null;
  /** Soma dos `ProductionOutput` do lote — quantidade produzida, nunca saldo. */
  producedQuantity: string;
  onHand: string;
  reserved: string;
  available: string;
  status: LotStatus;
  isExpired: boolean;
  expiryDate: string | null;
  location: string | null;
  /** `null` quando a qualidade do custo é `PARTIAL`/`NO_COST` — nunca um valor parcial disfarçado de completo. */
  materialUnitCost: string | null;
  costQuality: CostQuality;
  /** Origem predominante do custo, quando aplicável. */
  costSource: CostSource | null;
}

export interface FinishedGoodsListResponse {
  rows: FinishedGoodRowDTO[];
  page: number;
  pageSize: number;
  total: number;
}
