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
 * Fatia 3 = o relatório gerencial R-21 (INTERNAL-CONSUMPTION-REPORT-01), que
 * lê os snapshots daqui e não recalcula custo.
 */

import type { CostSource } from "./costs.js";
import type { ItemType } from "./items.js";
import type { LotStatus } from "./lots.js";
import type { UserRole } from "./users.js";

export const INTERNAL_CONSUMPTION_CODE_PREFIX = "CI";

/**
 * ESTORNO DE CONSUMO INTERNO — ECI-000001 (INTERNAL-CONSUMPTION-REVERSAL-01).
 * "EC" já é Estrutura de Custo.
 */
export const INTERNAL_CONSUMPTION_REVERSAL_CODE_PREFIX = "ECI";

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

/**
 * Quem ESTORNA consumo interno — decisão do PO (INTERNAL-CONSUMPTION-REVERSAL-01, P2).
 *
 * Lista PRÓPRIA e menor que a de quem registra: estornar desfaz uma saída já
 * confirmada e muda o relatório de despesa, então é exceção controlada, com
 * um segundo olhar — o mesmo precedente de anular arquivo do Rótulo
 * (Qualidade e Administrador). Compras, Produção, Comercial e consulta não
 * estornam: quem registrou errado pede o estorno.
 */
export const INTERNAL_CONSUMPTION_REVERSAL_ROLES: readonly UserRole[] = ["ADMIN", "QUALITY"];

/** O perfil pode estornar consumo interno? */
export function podeEstornarConsumoInterno(role: UserRole): boolean {
  return INTERNAL_CONSUMPTION_REVERSAL_ROLES.some((aceito) => aceito === role);
}

/** Motivo do estorno: obrigatório, de 3 a 500 caracteres depois do `trim`. */
export const INTERNAL_CONSUMPTION_REVERSAL_REASON_MIN = 3;
export const INTERNAL_CONSUMPTION_REVERSAL_REASON_MAX = 500;

/**
 * Situação do consumo diante dos estornos — DERIVADA da soma, nunca gravada.
 *
 * `REVERSED` = estornado por inteiro: continua listado no histórico e no R-21,
 * mas não conta mais como consumo.
 */
export type InternalConsumptionReversalStatus = "NOT_REVERSED" | "PARTIALLY_REVERSED" | "REVERSED";

export const INTERNAL_CONSUMPTION_REVERSAL_STATUS_LABELS: Record<InternalConsumptionReversalStatus, string> = {
  NOT_REVERSED: "—",
  PARTIALLY_REVERSED: "Estornado parcialmente",
  REVERSED: "Estornado",
};

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

  /*
   * Estornos (INTERNAL-CONSUMPTION-REVERSAL-01). Tudo SOMA dos registros ECI-
   * no instante da leitura — o CI nunca guarda contador, e nunca é editado.
   */

  /** Soma das quantidades estornadas; `"0"` sem estorno. */
  reversedQuantity: string;
  /**
   * `quantity − reversedQuantity`: o que ainda pode ser estornado — e, pelo
   * mesmo número, a quantidade LÍQUIDA do consumo.
   */
  reversibleQuantity: string;
  /** Soma do custo total dos estornos; `null` quando o CI não tem custo. */
  reversedTotalCost: string | null;
  /** `totalCost − reversedTotalCost`; `null` quando o CI não tem custo. */
  netTotalCost: string | null;
  reversalStatus: InternalConsumptionReversalStatus;
  reversalCount: number;
}

/** Um estorno ECI- como a tela, o extrato e o relatório o leem. */
export interface InternalConsumptionReversalDTO {
  id: string;
  /** ECI-000001. */
  code: string;
  originalConsumptionId: string;
  originalConsumptionCode: string;

  /** Sempre positiva, na unidade do CI — a entrada é do movimento. */
  quantity: string;
  uomCode: string;
  reason: string;

  /** CÓPIA do custo unitário do CI; `null` quando ele é `NO_COST`. */
  unitCost: string | null;
  /** Pró-rata do total do CI; o estorno que zera o saldo leva o resto. */
  totalCost: string | null;
  costSource: CostSource;
  costDetails: string | null;

  /** O movimento `INTERNAL_CONSUMPTION_REVERSAL` que devolveu a quantidade. */
  inventoryMovementId: string;

  registeredByUserId: string;
  registeredByName: string;
  /** Instante do estorno — o mesmo `occurredAt` da entrada no ledger. */
  createdAt: string;
}

/**
 * Ajuste MANUAL de entrada na mesma posição depois do consumo.
 *
 * Só informação para quem vai estornar: o sistema NÃO deduz que ele corrigiu
 * este consumo e não bloqueia o estorno por causa dele (PO).
 */
export interface InternalConsumptionLaterAdjustmentDTO {
  id: string;
  quantity: string;
  occurredAt: string;
  reason: string | null;
  createdBy: string | null;
}

/**
 * O consumo aberto para estornar: tudo da linha do histórico, os estornos já
 * feitos e o que a tela precisa AVISAR (item inativo, lote bloqueado ou
 * vencido, ajuste manual posterior). Nenhum desses avisos bloqueia.
 */
export interface InternalConsumptionDetailDTO extends InternalConsumptionDTO {
  /** Do mais recente para o mais antigo. */
  reversals: InternalConsumptionReversalDTO[];
  itemActive: boolean;
  /** Situação atual do lote do consumo; `null` quando o consumo não tem lote. */
  lotStatus: LotStatus | null;
  lotExpired: boolean;
  /** Até 5, do mais recente para o mais antigo; `laterManualAdjustmentCount` é o total. */
  laterManualAdjustments: InternalConsumptionLaterAdjustmentDTO[];
  laterManualAdjustmentCount: number;
}

export interface CreateInternalConsumptionReversalInput {
  /** Decimal como string, `0 < quantity ≤ reversibleQuantity`. */
  quantity: string;
  reason: string;
  /**
   * O "já estornado" que a tela mostrou. Diferente do atual no instante do
   * confirmar, o servidor responde conflito — duplo clique ou aba velha nunca
   * estornam duas vezes em silêncio.
   */
  expectedReversedQuantity: string;
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

/**
 * O que a tela e o relatório escrevem no lugar de um custo `null`.
 *
 * Nunca "R$ 0,00": zero é custo real zero. A frase diz que a despesa existe e
 * que o sistema não sabe quanto ela custou.
 */
export const CUSTO_NAO_DISPONIVEL = "Custo não disponível";

/** O destino que ninguém escreveu — linha própria no resumo por destino. */
export const SEM_DESTINO_INFORMADO = "Sem destino informado";

/**
 * Filtro "com custo / sem custo" do relatório R-21 (`hasCost`), pelo valor que
 * vai na URL. O mesmo mapa monta o seletor da tela e escreve o filtro no PDF.
 */
export const INTERNAL_CONSUMPTION_COST_FILTER_LABELS: Readonly<Record<"true" | "false", string>> = {
  true: "Com custo conhecido",
  false: CUSTO_NAO_DISPONIVEL,
};
