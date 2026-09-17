/**
 * Contratos do CONSUMO INTERNO — Uso e consumo, Fatia 2
 * (INTERNAL-CONSUMPTION-01).
 *
 * Consumo interno é a saída física real de material que a própria empresa
 * usa: papelaria, higiene, limpeza, material administrativo. Ele NÃO é
 * `ADJUSTMENT_OUT`: ajuste existe para CORRIGIR um saldo errado, e usá-lo
 * aqui apagaria a diferença entre "o estoque estava errado" e "a empresa
 * usou o material".
 *
 * A baixa continua saindo do Inventory Ledger — o registro `CI-` guarda o
 * CONTEXTO (destino, observação, quem, quando) e o SNAPSHOT do custo. Saldo
 * nunca se lê daqui.
 *
 * Fatia 1 = o tipo de Item Uso e consumo; Fatia 2 = esta movimentação;
 * Fatia 3 = o relatório gerencial, que ainda não existe.
 */

import type { CostSource } from "./costs.js";
import type { ItemType } from "./items.js";
import type { UserRole } from "./users.js";

export const INTERNAL_CONSUMPTION_CODE_PREFIX = "CI";

/**
 * Quem REGISTRA consumo interno.
 *
 * Mais larga que `STOCK_WRITE_ROLES` (ajuste/perda: ADMIN, PRODUCTION,
 * QUALITY) por decisão explícita do PO: `PURCHASING` compra o material de uso
 * e consumo e é quem o distribui na prática, e recusar-lhe a baixa deixaria a
 * pessoa que retira a luva do armário sem como registrar a retirada.
 *
 * A ampliação vale só para esta operação — ajuste e perda continuam com o
 * gate de antes, porque corrigir saldo é outra autoridade.
 *
 * `COMMERCIAL` não registra e `VIEWER` é leitura por definição.
 */
export const INTERNAL_CONSUMPTION_WRITE_ROLES: readonly UserRole[] = [
  "ADMIN",
  "PURCHASING",
  "PRODUCTION",
  "QUALITY",
];

/** O perfil pode registrar consumo interno? */
export function podeRegistrarConsumoInterno(role: UserRole): boolean {
  return INTERNAL_CONSUMPTION_WRITE_ROLES.some((aceito) => aceito === role);
}

export interface InternalConsumptionDTO {
  id: string;
  /** CI-000001. */
  code: string;

  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;

  lotId: string | null;
  lotCode: string | null;

  /** Decimal como string — sempre positivo; a baixa é do movimento. */
  quantity: string;
  uomCode: string;

  occurredAt: string;

  /** Destino/uso, texto livre. Centro de Custo é decisão futura do PO. */
  purpose: string | null;
  notes: string | null;

  /**
   * Custo unitário congelado no instante do registro, na unidade do item.
   *
   * `null` quando `costSource = "NO_COST"`. Ausência de custo NUNCA é
   * R$ 0,00 — zero é custo real zero, e confundir os dois inventa despesa
   * que não houve ou apaga despesa que houve.
   */
  unitCost: string | null;
  /** `unitCost x quantity`; `null` pelo mesmo motivo. */
  totalCost: string | null;
  costSource: CostSource;
  /** Como o número foi obtido (lote, janela, data do último real). */
  costDetails: string | null;

  /** O movimento `INTERNAL_CONSUMPTION` que fez a baixa. */
  inventoryMovementId: string | null;

  registeredByUserId: string;
  registeredByName: string;
  createdAt: string;
}

export interface CreateInternalConsumptionInput {
  itemId: string;
  /** Obrigatório quando o item controla lote; recusado quando não controla. */
  lotId?: string | undefined;
  /** Decimal como string, `> 0`. */
  quantity: string;
  /** Dia civil (`yyyy-mm-dd`). Padrão: hoje no dia comercial. */
  occurredOn?: string | undefined;
  purpose?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface InternalConsumptionListResponse {
  consumptions: InternalConsumptionDTO[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Disponibilidade de um Item de uso e consumo para a tela do consumo.
 *
 * A tela precisa mostrar o saldo ANTES de confirmar, e o saldo que vale é o
 * mesmo que o servidor vai conferir na gravação (`Available`, nunca On Hand
 * cru) — duas leituras diferentes fariam a tela prometer o que a gravação
 * recusa.
 */
export interface InternalConsumptionAvailabilityDTO {
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  controlsLot: boolean;
  itemActive: boolean;
  onHand: string;
  available: string;
  /** Uma entrada por lote elegível; vazio quando o item não controla lote. */
  lots: InternalConsumptionLotDTO[];
}

export interface InternalConsumptionLotDTO {
  lotId: string;
  lotCode: string;
  expiryDate: string | null;
  available: string;
}
