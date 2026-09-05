/**
 * Contratos de Expedição (Shipment) — separação e saída física de produto
 * acabado de um Pedido. Só uma Expedição CONFIRMED altera estoque; DRAFT é
 * apenas separação. O futuro Faturamento se baseia no realmente expedido
 * (`ShipmentLine.quantity` de Expedições CONFIRMED), nunca na quantidade
 * pedida/reservada/planejada.
 */

import Decimal from "decimal.js";
import type { ShipmentBillingStatus } from "./billings.js";

export const SHIPMENT_CODE_PREFIX = "EXP";

export interface LinhaDaPreviaDeExpedicao {
  id: string;
  /** Teto da linha: o que continua reservado a este pedido naquele lote. */
  reservedRemaining: string;
  /** Quantidade que se pretende enviar agora, já legível. */
  quantity: string;
}

export interface PreviaDeExpedicaoDoProduto {
  /** Soma das linhas deste produto como estão na tela. */
  expedindoAgora: string;
  /** `falta expedir − expedindo agora`; negativo só para dizer que passou — nunca se mostra como saldo. */
  restanteDepois: string;
  /** Linhas cuja quantidade passa do reservado disponível do lote. */
  linhasAcimaDoReservado: string[];
  /** A soma passa do que ainda falta expedir do produto no pedido. */
  acimaDoQueFalta: boolean;
}

/**
 * O que esta expedição faz com o produto do pedido, ANTES de confirmar.
 *
 * Três conceitos que a tela misturava num "Total": o que já saiu em
 * expedições confirmadas (histórico), o que sai nesta (as linhas em edição) e
 * o que sobra do pedido depois. A conta é a mesma que o servidor aplica ao
 * confirmar — soma por produto contra `outstandingQuantity`, linha a linha
 * contra `reservedRemaining` — sem mover estoque, reserva ou linha alguma.
 */
export function previaDeExpedicaoDoProduto(input: {
  outstandingQuantity: string;
  linhas: LinhaDaPreviaDeExpedicao[];
}): PreviaDeExpedicaoDoProduto {
  let soma = new Decimal(0);
  const linhasAcimaDoReservado: string[] = [];
  for (const linha of input.linhas) {
    const quantidade = new Decimal(linha.quantity);
    soma = soma.plus(quantidade);
    if (quantidade.greaterThan(linha.reservedRemaining)) linhasAcimaDoReservado.push(linha.id);
  }
  const restante = new Decimal(input.outstandingQuantity).minus(soma);
  return {
    expedindoAgora: soma.toString(),
    restanteDepois: restante.toString(),
    linhasAcimaDoReservado,
    acimaDoQueFalta: restante.lessThan(0),
  };
}

/** `CONFIRMED` é histórico imutável — reversão exigiria devolução/reentrada explícita, fora desta fase. */
export type ShipmentStatus = "DRAFT" | "CONFIRMED" | "CANCELLED";

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  DRAFT: "Rascunho",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
};

export const SHIPMENT_STATUSES: readonly ShipmentStatus[] = ["DRAFT", "CONFIRMED", "CANCELLED"];

export interface ShipmentLineDTO {
  id: string;
  customerOrderLineId: string;
  customerOrderReservationLineId: string;
  productId: string;
  productCode: string;
  productName: string;
  itemId: string;
  finishedItemCode: string | null;
  finishedItemName: string | null;
  lotId: string | null;
  lotCode: string | null;
  businessLotNumber: string | null;
  expiryDate: string | null;
  location: string | null;
  quantity: string;
  unitCode: string;
  position: number;
  /** `reservedRemaining` da linha de reserva de origem — o teto do que esta linha pode enviar. */
  reservedRemaining: string;
  /** Linha loteada com quantidade > 0 exige conferência física antes da confirmação. */
  requiresVerification: boolean;
  /** Conferência física do lote — auditoria, nunca movimento de estoque. */
  verifiedAt: string | null;
  verifiedBy: string | null;
}

/**
 * Situação de conferência de um produto da Expedição — **derivada, nunca
 * persistida**. `READY` = há quantidade separada e nenhum lote conferido
 * ainda; `VERIFIED` = todos os lotes com quantidade > 0 foram conferidos.
 */
export type ShipmentProductStatus = "PENDING" | "READY" | "PARTIAL" | "VERIFIED";

export const SHIPMENT_PRODUCT_STATUS_LABELS: Record<ShipmentProductStatus, string> = {
  PENDING: "Pendente",
  READY: "Pronto",
  PARTIAL: "Parcial",
  VERIFIED: "Conferido",
};

/**
 * Progresso por linha do Pedido dentro da Expedição. Todos os totais são
 * derivados na leitura — nada aqui é armazenado.
 */
export interface ShipmentProductGroupDTO {
  customerOrderLineId: string;
  productId: string;
  productCode: string;
  productName: string;
  /** `null` enquanto o Pedido não tem snapshot do Finished Product Item. */
  itemId: string | null;
  finishedItemCode: string | null;
  finishedItemName: string | null;
  unitCode: string;
  orderedQuantity: string;
  /** Já expedido em Expedições CONFIRMED (inclui esta, depois de confirmada). */
  shippedQuantity: string;
  /** `ordered - shipped`, nunca negativo. */
  outstandingQuantity: string;
  /** Soma dos `reservedRemaining` das linhas desta Expedição. */
  reservedRemaining: string;
  /** Soma das quantidades desta Expedição para este produto. */
  shippingNow: string;
  lotsRequired: number;
  lotsVerified: number;
  status: ShipmentProductStatus;
}

export interface ShipmentVerificationSummaryDTO {
  /** Produtos com quantidade > 0 nesta Expedição. */
  productCount: number;
  lotsRequired: number;
  lotsVerified: number;
  allLotsVerified: boolean;
}

export interface VerifyShipmentLineInput {
  /** Código puro (`LT-...`) ou payload de QR (`LOT:LT-...`). */
  lotCode: string;
}

export interface ShipmentDTO {
  id: string;
  code: string;
  customerOrderId: string;
  customerOrderCode: string;
  customerId: string;
  customerName: string | null;
  status: ShipmentStatus;
  shipmentDate: string | null;
  notes: string | null;
  lines: ShipmentLineDTO[];
  /** Um grupo por linha do Pedido — inclusive produtos ainda sem reserva nesta Expedição. */
  products: ShipmentProductGroupDTO[];
  /** Contagem de produtos/lotes conferidos — nunca soma de unidades incompatíveis. */
  verification: ShipmentVerificationSummaryDTO;
  /** Soma das quantidades das linhas. */
  totalQuantity: string;
  /** Estado de faturamento derivado — só relevante quando `CONFIRMED`. */
  billingStatus: ShipmentBillingStatus;
  /** Preenchidos quando existe um Billing ativo (DRAFT/ISSUED) para esta Expedição. */
  billingId: string | null;
  billingCode: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
}

export interface ShipmentListResponse {
  shipments: ShipmentDTO[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ShipmentLineInput {
  customerOrderReservationLineId: string;
  /** `0 <= quantity <= reservedRemaining`; `0` não gera linha. */
  quantity: string;
}

export interface UpdateShipmentInput {
  notes?: string;
  lines?: ShipmentLineInput[];
}

export interface CancelShipmentInput {
  reason: string;
}

/**
 * Status de reserva por linha do Pedido — base da Reserva Complementar
 * (produto produzido depois do Plano precisa ser explicitamente reservado
 * antes de poder ser expedido). Análise pura, nunca persistida.
 */
export interface ReservationStatusLineDTO {
  customerOrderLineId: string;
  productId: string;
  productCode: string;
  productName: string;
  itemId: string;
  unitCode: string;
  orderedQuantity: string;
  shippedQuantity: string;
  /** Soma dos `reservedRemaining` das linhas de reserva ativas desta linha do Pedido. */
  reservedRemaining: string;
  /** `ordered - shipped - reservedRemaining`, nunca negativo. */
  stillToReserve: string;
  /** Available atual do Finished Product Item (ledger) — respeita Quality/validade. */
  currentAvailable: string;
  /** `min(stillToReserve, currentAvailable)`. */
  suggestedAdditionalReserve: string;
}

export interface ReservationStatusDTO {
  customerOrderId: string;
  lines: ReservationStatusLineDTO[];
}

export interface ReserveAvailableLineInput {
  customerOrderLineId: string;
  quantity: string;
}

export interface ReserveAvailableInput {
  lines: ReserveAvailableLineInput[];
}

export interface ReallocateReservationLineInput {
  /** Linha de reserva cujo remanescente (não expedido) será realocado via FEFO/FIFO. */
  customerOrderReservationLineId: string;
}
