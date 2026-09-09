import { Decimal, type DecimalInstance } from "./decimal-config.js";

/**
 * Entregas programadas — o compromisso de QUANDO cada parte do Pedido sai.
 *
 * A distinção que sustenta o modelo inteiro: **programar não é expedir**.
 * Programar é a promessa comercial; expedir é a saída física. Programar não
 * reserva estoque, não escolhe lote, não gera movimento e não fatura — quem
 * executa continua sendo a Expedição CONFIRMADA, e é dela que toda quantidade
 * atendida vem.
 *
 * Por isso não existe coluna de situação. "Programada", "Parcialmente
 * atendida", "Atendida" e "Atrasada" são LEITURAS da comparação entre o que
 * foi prometido e o que as Expedições confirmadas entregaram. Uma coluna
 * gravada envelheceria no primeiro `Shipment` confirmado por outro caminho, e
 * o sistema passaria a ter duas verdades sobre a mesma entrega. O único
 * estado persistido é o cancelamento, porque cancelar é um ato de alguém.
 *
 * Este módulo é aritmética pura: sem Prisma, sem data do sistema, sem I/O. A
 * API e a web leem daqui — não existe uma segunda conta em nenhum dos dois.
 */

/**
 * Situação de uma entrega programada. Derivada, sempre.
 *
 * A precedência é a ordem desta união e não é arbitrária: cancelada some da
 * conta antes de qualquer outra pergunta; atendida encerra antes de a data
 * importar (entrega cumprida nunca vira atrasada depois); e atraso vem antes
 * do progresso parcial, porque quem abre a tela precisa ver primeiro o que
 * está fora do prazo.
 */
export type DeliveryScheduleStatus =
  | "CANCELLED"
  | "FULFILLED"
  | "LATE"
  | "PARTIALLY_FULFILLED"
  | "SCHEDULED";

export const DELIVERY_SCHEDULE_STATUS_LABELS: Record<DeliveryScheduleStatus, string> = {
  CANCELLED: "Cancelada",
  FULFILLED: "Atendida",
  LATE: "Atrasada",
  PARTIALLY_FULFILLED: "Parcialmente atendida",
  SCHEDULED: "Programada",
};

/** Uma linha da promessa: quanto de um produto do Pedido sai nesta entrega. */
export interface DeliveryScheduleLineDTO {
  id: string;
  customerOrderLineId: string;
  productId: string;
  productCode: string;
  productName: string;
  unitCode: string;
  /** O que foi prometido nesta entrega. */
  quantity: string;
  /** Soma das linhas de Expedição CONFIRMADA ligadas a esta linha. */
  fulfilledQuantity: string;
  /** `quantity - fulfilledQuantity`, nunca negativo. */
  remainingQuantity: string;
}

/** A Expedição que atendeu (ou está separando) parte desta entrega. */
export interface DeliveryScheduleShipmentDTO {
  shipmentId: string;
  shipmentCode: string;
  /** Só CONFIRMED conta como atendimento; DRAFT aparece como separação em curso. */
  status: string;
  shipmentDate: string | null;
  quantity: string;
}

export interface DeliveryScheduleDTO {
  id: string;
  customerOrderId: string;
  /** "Entrega 1", "Entrega 2" — ordem de criação dentro do Pedido. */
  sequence: number;
  /** Data civil `YYYY-MM-DD`: o negócio promete um dia, nunca uma hora. */
  scheduledDate: string;
  notes: string | null;
  status: DeliveryScheduleStatus;
  lines: DeliveryScheduleLineDTO[];
  shipments: DeliveryScheduleShipmentDTO[];
  /** Somas do cabeçalho — as mesmas contas das linhas, agregadas. */
  totalQuantity: string;
  totalFulfilledQuantity: string;
  totalRemainingQuantity: string;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  /** Preenchido quando esta entrega SUBSTITUI outra (reprogramação). */
  replacesDeliveryId: string | null;
  replacesDeliverySequence: number | null;
  /** Preenchido quando esta entrega FOI substituída. */
  replacedByDeliveryId: string | null;
  replacedByDeliverySequence: number | null;
  createdAt: string;
  createdBy: string | null;
}

/** Quanto ainda pode ser prometido de cada linha do Pedido. */
export interface SchedulableLineDTO {
  customerOrderLineId: string;
  productId: string;
  productCode: string;
  productName: string;
  unitCode: string;
  orderedQuantity: string;
  /** Expedido em Expedições CONFIRMADAS — fonte canônica do Pedido. */
  shippedQuantity: string;
  /** Soma dos saldos pendentes das entregas NÃO canceladas. */
  scheduledPendingQuantity: string;
  /** `ordered - shipped - scheduledPending`, nunca negativo. */
  schedulableQuantity: string;
}

export interface CustomerOrderDeliveryScheduleDTO {
  deliveries: DeliveryScheduleDTO[];
  schedulable: SchedulableLineDTO[];
}

export interface DeliveryScheduleLineInput {
  customerOrderLineId: string;
  quantity: string;
}

export interface CreateDeliveryScheduleInput {
  /** Data civil `YYYY-MM-DD`. */
  scheduledDate: string;
  notes?: string | undefined;
  lines: DeliveryScheduleLineInput[];
}

export interface CancelDeliveryScheduleInput {
  reason: string;
}

/**
 * Reprogramar: a entrega original é cancelada e nasce uma substituta com os
 * saldos ainda pendentes. Quantidade não é informada — ela É o pendente.
 */
export interface RescheduleDeliveryInput {
  scheduledDate: string;
  reason: string;
  notes?: string | undefined;
}

/* ------------------------------------------------------------------ *
 * A aritmética
 * ------------------------------------------------------------------ */

/**
 * O saldo pendente de uma linha programada.
 *
 * Nunca negativo: expedir mais do que a linha prometia é impedido no servidor,
 * e se um dado antigo trouxer excesso, a leitura correta é "não falta nada" —
 * não um número negativo que a tela some ao próximo saldo.
 */
export function saldoDaLinhaProgramada(prometido: DecimalInstance, atendido: DecimalInstance): DecimalInstance {
  return Decimal.max(prometido.minus(atendido), 0);
}

/**
 * A situação de uma entrega, das suas linhas e do calendário.
 *
 * `hojeISO` e `scheduledDateISO` são dias civis `YYYY-MM-DD` — a comparação é
 * de texto porque para datas ISO isso é a mesma coisa que comparar
 * cronologicamente, e porque comparar um marcador de dia com um relógio é
 * exatamente o defeito que §72 e §73 documentam.
 *
 * Uma entrega SEM linhas é lida como programada: ela existe, ainda não promete
 * nada, e chamá-la de atendida seria dizer que uma promessa vazia foi cumprida.
 */
export function situacaoDaEntrega(entrada: {
  cancelada: boolean;
  scheduledDateISO: string;
  hojeISO: string;
  linhas: { prometido: DecimalInstance; atendido: DecimalInstance }[];
}): DeliveryScheduleStatus {
  if (entrada.cancelada) return "CANCELLED";

  const temLinhas = entrada.linhas.length > 0;
  const pendente = entrada.linhas.reduce(
    (soma, linha) => soma.plus(saldoDaLinhaProgramada(linha.prometido, linha.atendido)),
    new Decimal(0),
  );
  const atendido = entrada.linhas.reduce((soma, linha) => soma.plus(linha.atendido), new Decimal(0));

  // Atendida encerra antes de a data importar: entrega cumprida no dia 20 não
  // vira "atrasada" no dia 21.
  if (temLinhas && pendente.isZero()) return "FULFILLED";

  // Atraso é o dia da promessa TER PASSADO. No próprio dia a promessa ainda
  // vale — o dia inteiro conta (§73).
  if (pendente.greaterThan(0) && entrada.hojeISO > entrada.scheduledDateISO) return "LATE";

  if (atendido.greaterThan(0)) return "PARTIALLY_FULFILLED";
  return "SCHEDULED";
}

/**
 * Quanto ainda pode ser prometido de uma linha do Pedido.
 *
 * `pedido − expedido − pendente das entregas ativas`.
 *
 * As duas subtrações medem coisas diferentes e é por isso que uma entrega
 * cancelada entra nas duas contas de formas opostas: o que ela já expediu
 * continua descontado (a saída física aconteceu e não se desfaz), e o que
 * restava dela deixa de ocupar programação (a promessa acabou).
 *
 * O exemplo que define a regra: Pedido de 400, entrega A de 400, 250
 * confirmadas, A cancelada. Expedido 250, pendente ativo 0, programável 150 —
 * nunca os 400 originais.
 */
export function saldoProgramavel(entrada: {
  pedido: DecimalInstance;
  expedido: DecimalInstance;
  pendenteEmEntregasAtivas: DecimalInstance;
}): DecimalInstance {
  return Decimal.max(entrada.pedido.minus(entrada.expedido).minus(entrada.pendenteEmEntregasAtivas), 0);
}
