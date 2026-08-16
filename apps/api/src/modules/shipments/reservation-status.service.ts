import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { CustomerOrderDTO, ReservationStatusDTO, ReservationStatusLineDTO } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { getAvailableByItems, isLotAvailableForUse } from "../../lib/inventory-ledger.js";
import { getAllocationSuggestion } from "../inventory/allocation.service.js";
import { CustomerOrderNotFoundError } from "../customer-orders/customer-orders.errors.js";
import { getCustomerOrderById } from "../customer-orders/customer-orders.service.js";
import { itemScopesFor } from "../customer-orders/fulfillment-plan.service.js";
import {
  ExcessiveReserveRequestError,
  InsufficientAvailableError,
  NothingToReallocateError,
  OrderNotShippableError,
  ReservationLineNotFoundError,
} from "./shipments.errors.js";
import { getReservedRemainingByLines, getShippedByOrderLines } from "./shipments.service.js";
import type { ReserveAvailableInput } from "./shipments.schemas.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/** Sem autenticacao/Usuarios no MVP ainda — mesma string ja usada na topbar. */
const SYSTEM_ACTOR = "Ambiente local";
const REALLOCATION_RELEASE_REASON = "Realocação de reserva (lote inelegível)";

const SHIPPABLE_ORDER_STATUSES = ["IN_FULFILLMENT", "PARTIALLY_SHIPPED"] as const;

function assertOrderOperational(status: string): void {
  if (!SHIPPABLE_ORDER_STATUSES.includes(status as (typeof SHIPPABLE_ORDER_STATUSES)[number])) {
    throw new OrderNotShippableError(
      "Somente pedidos em atendimento ou parcialmente expedidos permitem reservar/realocar produto acabado.",
    );
  }
}

/**
 * Soma dos `reservedRemaining` das linhas de reserva ATIVAS, por linha do
 * Pedido — quanto do compromisso ainda esta de pe (nao expedido, nao
 * realocado).
 */
async function reservedRemainingByOrderLine(
  prisma: PrismaOrTx,
  customerOrderId: string,
): Promise<Map<string, Prisma.Decimal>> {
  const reservationLines = await prisma.customerOrderReservationLine.findMany({
    where: { releasedAt: null, reservation: { customerOrderId, status: "ACTIVE" } },
    select: { id: true, customerOrderLineId: true },
  });
  const remainingByLine = await getReservedRemainingByLines(
    prisma,
    reservationLines.map((line) => line.id),
  );

  const map = new Map<string, Prisma.Decimal>();
  for (const line of reservationLines) {
    const remaining = remainingByLine.get(line.id) ?? new Prisma.Decimal(0);
    const current = map.get(line.customerOrderLineId) ?? new Prisma.Decimal(0);
    map.set(line.customerOrderLineId, current.plus(remaining));
  }
  return map;
}

/**
 * Analise da Reserva Complementar — produto produzido DEPOIS do Plano nao
 * pode ser expedido so por ter sido produzido; precisa ser explicitamente
 * reservado ao Pedido. Nunca persiste nada. `currentAvailable` vem do
 * ledger e ja respeita Quality/validade: lote AWAITING_RELEASE aparece em
 * On Hand mas contribui 0 aqui, e volta a contar apos a liberacao — sem
 * nenhuma integracao especial.
 */
export async function getReservationStatus(customerOrderId: string): Promise<ReservationStatusDTO> {
  const prisma = getPrisma();
  const order = await prisma.customerOrder.findUnique({
    where: { id: customerOrderId },
    include: { lines: true },
  });
  if (!order) throw new CustomerOrderNotFoundError(customerOrderId);
  assertOrderOperational(order.status);

  const finishedItemIds = [...new Set(order.lines.map((line) => line.finishedItemId!))];
  const [availableByItem, shippedByLine, remainingByOrderLine] = await Promise.all([
    getAvailableByItems(prisma, await itemScopesFor(prisma, finishedItemIds)),
    getShippedByOrderLines(
      prisma,
      order.lines.map((line) => line.id),
    ),
    reservedRemainingByOrderLine(prisma, customerOrderId),
  ]);

  const lines: ReservationStatusLineDTO[] = order.lines.map((line) => {
    const shipped = shippedByLine.get(line.id) ?? new Prisma.Decimal(0);
    const reservedRemaining = remainingByOrderLine.get(line.id) ?? new Prisma.Decimal(0);
    const stillToReserve = Prisma.Decimal.max(
      line.orderedQuantity.minus(shipped).minus(reservedRemaining),
      0,
    );
    const currentAvailable = availableByItem.get(line.finishedItemId!) ?? new Prisma.Decimal(0);
    const suggested = Prisma.Decimal.min(stillToReserve, currentAvailable);

    return {
      customerOrderLineId: line.id,
      productId: line.productId,
      productCode: line.productCode!,
      productName: line.productName!,
      itemId: line.finishedItemId!,
      unitCode: line.unitCode,
      orderedQuantity: line.orderedQuantity.toString(),
      shippedQuantity: shipped.toString(),
      reservedRemaining: reservedRemaining.toString(),
      stillToReserve: stillToReserve.toString(),
      currentAvailable: currentAvailable.toString(),
      suggestedAdditionalReserve: suggested.toString(),
    };
  });

  return { customerOrderId, lines };
}

/**
 * Reserva Complementar — operacao EXPLICITA (nunca automatica ao criar um
 * ProductionOutput). Transacional: trava o Pedido e os Finished Items,
 * recalcula Available agora, aloca por FEFO/FIFO com o MESMO
 * `allocation.service.ts` de sempre e acrescenta linhas a reserva ACTIVE
 * existente (nunca sobrescreve linhas historicas). Nunca cria
 * InventoryMovement.
 */
export async function reserveAvailable(
  customerOrderId: string,
  input: ReserveAvailableInput,
): Promise<CustomerOrderDTO> {
  const requested = input.lines.filter((line) => new Prisma.Decimal(line.quantity).greaterThan(0));
  if (requested.length === 0) {
    throw new ExcessiveReserveRequestError("o pedido", "0");
  }

  await getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM customer_orders WHERE id = ${customerOrderId} FOR UPDATE`;

    const order = await tx.customerOrder.findUnique({
      where: { id: customerOrderId },
      include: { lines: true },
    });
    if (!order) throw new CustomerOrderNotFoundError(customerOrderId);
    assertOrderOperational(order.status);

    const orderLinesById = new Map(order.lines.map((line) => [line.id, line]));
    for (const line of requested) {
      if (!orderLinesById.has(line.customerOrderLineId)) {
        throw new ReservationLineNotFoundError(line.customerOrderLineId);
      }
    }

    // Trava os Finished Items em ordem deterministica — serializa Pedidos
    // concorrentes disputando o mesmo produto acabado.
    const finishedItemIds = [...new Set(order.lines.map((line) => line.finishedItemId!))].sort();
    await tx.$queryRaw`SELECT id FROM items WHERE id IN (${Prisma.join(finishedItemIds)}) ORDER BY id FOR UPDATE`;

    const [shippedByLine, remainingByOrderLine] = await Promise.all([
      getShippedByOrderLines(
        tx,
        order.lines.map((line) => line.id),
      ),
      reservedRemainingByOrderLine(tx, customerOrderId),
    ]);

    let reservation = await tx.customerOrderReservation.findFirst({
      where: { customerOrderId, status: "ACTIVE" },
    });
    if (!reservation) {
      reservation = await tx.customerOrderReservation.create({
        data: { customerOrderId, status: "ACTIVE", createdBy: SYSTEM_ACTOR },
      });
    }

    for (const requestedLine of requested) {
      const orderLine = orderLinesById.get(requestedLine.customerOrderLineId)!;
      const quantity = new Prisma.Decimal(requestedLine.quantity);

      const shipped = shippedByLine.get(orderLine.id) ?? new Prisma.Decimal(0);
      const reservedRemaining = remainingByOrderLine.get(orderLine.id) ?? new Prisma.Decimal(0);
      const stillToReserve = Prisma.Decimal.max(
        orderLine.orderedQuantity.minus(shipped).minus(reservedRemaining),
        0,
      );
      if (quantity.greaterThan(stillToReserve)) {
        throw new ExcessiveReserveRequestError(
          orderLine.productCode ?? orderLine.productId,
          stillToReserve.toString(),
        );
      }

      // Recalcula FEFO/FIFO AGORA, sob lock — nunca reaproveita a sugestao
      // antiga exibida na UI.
      const suggestion = await getAllocationSuggestion(tx, orderLine.finishedItemId!, quantity.toString());
      if (new Prisma.Decimal(suggestion.shortageQuantity).greaterThan(0)) {
        throw new InsufficientAvailableError(
          orderLine.productCode ?? orderLine.productId,
          suggestion.availableQuantity,
        );
      }

      const item = await tx.item.findUniqueOrThrow({ where: { id: orderLine.finishedItemId! } });
      if (item.controlsLot) {
        for (const allocation of suggestion.allocations) {
          await tx.customerOrderReservationLine.create({
            data: {
              reservationId: reservation.id,
              customerOrderLineId: orderLine.id,
              productId: orderLine.productId,
              itemId: item.id,
              lotId: allocation.lotId,
              quantity: new Prisma.Decimal(allocation.suggestedQuantity),
            },
          });
        }
      } else {
        await tx.customerOrderReservationLine.create({
          data: {
            reservationId: reservation.id,
            customerOrderLineId: orderLine.id,
            productId: orderLine.productId,
            itemId: item.id,
            lotId: null,
            quantity,
          },
        });
      }
    }
  });

  return (await getCustomerOrderById(customerOrderId))!;
}

/**
 * Realocacao explicita do REMANESCENTE nao expedido de uma linha de reserva
 * cujo lote deixou de ser elegivel (venceu/foi bloqueado) — evita Pedido
 * permanentemente travado. A linha original nunca e apagada: fica marcada
 * como liberada e as novas linhas apontam de volta via `replacesLineId`. O
 * que ja foi expedido continua referenciando a linha (e o lote) original —
 * genealogia preservada. Rollback completo se nao houver estoque.
 */
export async function reallocateReservationLine(
  customerOrderId: string,
  reservationLineId: string,
): Promise<CustomerOrderDTO> {
  await getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM customer_orders WHERE id = ${customerOrderId} FOR UPDATE`;

    const order = await tx.customerOrder.findUnique({ where: { id: customerOrderId } });
    if (!order) throw new CustomerOrderNotFoundError(customerOrderId);
    assertOrderOperational(order.status);

    const reservationLine = await tx.customerOrderReservationLine.findUnique({
      where: { id: reservationLineId },
      include: { reservation: true, item: true, lot: true },
    });
    if (
      !reservationLine ||
      reservationLine.reservation.customerOrderId !== customerOrderId ||
      reservationLine.releasedAt !== null ||
      reservationLine.reservation.status !== "ACTIVE"
    ) {
      throw new ReservationLineNotFoundError(reservationLineId);
    }

    // Trava o Item — serializa contra outra realocacao/reserva disputando o
    // mesmo saldo.
    await tx.$queryRaw`SELECT id FROM items WHERE id = ${reservationLine.itemId} FOR UPDATE`;

    const remaining =
      (await getReservedRemainingByLines(tx, [reservationLine.id])).get(reservationLine.id) ??
      new Prisma.Decimal(0);
    if (remaining.lessThanOrEqualTo(0)) throw new NothingToReallocateError();

    // Libera o remanescente ANTES de realocar — assim o Available ja
    // considera a devolucao e a nova alocacao pode inclusive reaproveitar
    // parte do mesmo saldo, se o lote ainda fosse elegivel.
    await tx.customerOrderReservationLine.update({
      where: { id: reservationLine.id },
      data: {
        releasedAt: new Date(),
        releasedBy: SYSTEM_ACTOR,
        releaseReason: REALLOCATION_RELEASE_REASON,
      },
    });

    const suggestion = await getAllocationSuggestion(tx, reservationLine.itemId, remaining.toString());
    if (new Prisma.Decimal(suggestion.shortageQuantity).greaterThan(0)) {
      throw new InsufficientAvailableError(reservationLine.item.code, suggestion.availableQuantity);
    }

    // Nunca realoca para o mesmo lote inelegivel — `getAllocationSuggestion`
    // ja filtra por `isLotAvailableForUse`, mas a checagem explicita deixa
    // a intencao clara e protege contra qualquer regressao futura.
    for (const allocation of suggestion.allocations) {
      const lot = await tx.lot.findUniqueOrThrow({ where: { id: allocation.lotId } });
      if (!isLotAvailableForUse(lot)) throw new InsufficientAvailableError(reservationLine.item.code, "0");

      await tx.customerOrderReservationLine.create({
        data: {
          reservationId: reservationLine.reservationId,
          customerOrderLineId: reservationLine.customerOrderLineId,
          productId: reservationLine.productId,
          itemId: reservationLine.itemId,
          lotId: allocation.lotId,
          quantity: new Prisma.Decimal(allocation.suggestedQuantity),
          replacesLineId: reservationLine.id,
        },
      });
    }
  });

  return (await getCustomerOrderById(customerOrderId))!;
}
