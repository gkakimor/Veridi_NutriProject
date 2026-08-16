import { Prisma } from "@prisma/client";
import type {
  Customer,
  CustomerOrder,
  CustomerOrderLine,
  CustomerOrderReservationLine,
  Item,
  Lot,
  PrismaClient,
  Product,
  Shipment,
  ShipmentLine,
} from "@prisma/client";
import type {
  ShipmentDTO,
  ShipmentLineDTO,
  ShipmentListResponse,
  ShipmentProductGroupDTO,
  ShipmentProductStatus,
} from "@veridi/shared";
import { SHIPMENT_CODE_PREFIX, normalizeLotLookupCode } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { getOnHand, isLotAvailableForUse } from "../../lib/inventory-ledger.js";
import { CustomerOrderNotFoundError } from "../customer-orders/customer-orders.errors.js";
import { getBillingStatusByShipments } from "../billings/billings.service.js";
import {
  DraftShipmentAlreadyExistsError,
  EmptyShipmentError,
  ExceedsOutstandingError,
  ExceedsReservedRemainingError,
  InsufficientOnHandError,
  LineNotVerifiableError,
  LotMismatchError,
  LotNotFoundError,
  LotNotShippableError,
  NothingToShipError,
  OrderNotShippableError,
  ReservationLineNotFoundError,
  ShipmentLineNotFoundError,
  ShipmentNotDraftError,
  ShipmentNotFoundError,
  UnverifiedShipmentLinesError,
} from "./shipments.errors.js";
import type { ListShipmentsQuery, UpdateShipmentInput } from "./shipments.schemas.js";

type PrismaOrTx = PrismaClient | Prisma.TransactionClient;

/** Sem autenticacao/Usuarios no MVP ainda — mesma string ja usada na topbar. */
const SYSTEM_ACTOR = "Ambiente local";
const CODE_SEQUENCE = "shipment_code_seq";
const ORDER_SHIPPED_RELEASE_REASON = "ORDER_SHIPPED";

/** Status do Pedido em que ainda e possivel operar reserva/expedicao. */
const SHIPPABLE_ORDER_STATUSES = ["IN_FULFILLMENT", "PARTIALLY_SHIPPED"] as const;

type ReservationLineWithRelations = CustomerOrderReservationLine & {
  product: Product;
  item: Item;
  lot: Lot | null;
};
type ShipmentLineWithRelations = ShipmentLine & {
  product: Product;
  item: Item;
  lot: Lot | null;
  customerOrderReservationLine: ReservationLineWithRelations;
};
type ShipmentWithRelations = Shipment & {
  customerOrder: CustomerOrder & { customer: Customer; lines: CustomerOrderLine[] };
  lines: ShipmentLineWithRelations[];
};

const shipmentInclude = {
  customerOrder: { include: { customer: true, lines: { orderBy: { position: "asc" as const } } } },
  lines: {
    include: {
      product: true,
      item: true,
      lot: true,
      customerOrderReservationLine: { include: { product: true, item: true, lot: true } },
    },
    orderBy: { position: "asc" as const },
  },
} as const;

/**
 * `reservedRemaining` por linha de reserva de produto acabado — quantidade
 * reservada menos o que ja saiu fisicamente em Expedicoes CONFIRMED. Mesma
 * base usada pelo `inventory-ledger.ts` para o Reserved global; nunca uma
 * segunda interpretacao paralela. Expedicoes DRAFT/CANCELLED nunca contam.
 */
export async function getReservedRemainingByLines(
  prisma: PrismaOrTx,
  reservationLineIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (reservationLineIds.length === 0) return new Map();
  const [lines, shipped] = await Promise.all([
    prisma.customerOrderReservationLine.findMany({
      where: { id: { in: reservationLineIds } },
      select: { id: true, quantity: true },
    }),
    prisma.shipmentLine.groupBy({
      by: ["customerOrderReservationLineId"],
      where: {
        customerOrderReservationLineId: { in: reservationLineIds },
        shipment: { status: "CONFIRMED" },
      },
      _sum: { quantity: true },
    }),
  ]);

  const shippedByLine = new Map<string, Prisma.Decimal>();
  for (const row of shipped) {
    shippedByLine.set(row.customerOrderReservationLineId, row._sum.quantity ?? new Prisma.Decimal(0));
  }

  const map = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    const alreadyShipped = shippedByLine.get(line.id) ?? new Prisma.Decimal(0);
    map.set(line.id, Prisma.Decimal.max(line.quantity.minus(alreadyShipped), 0));
  }
  return map;
}

/** Linhas de reserva ATIVAS (nao realocadas) de um Pedido, com relacoes. */
async function getActiveReservationLines(
  prisma: PrismaOrTx,
  customerOrderId: string,
): Promise<ReservationLineWithRelations[]> {
  return prisma.customerOrderReservationLine.findMany({
    where: {
      releasedAt: null,
      reservation: { customerOrderId, status: "ACTIVE" },
    },
    include: { product: true, item: true, lot: true },
    orderBy: { createdAt: "asc" },
  });
}

/** Expedido por CustomerOrderLine (Expedicoes CONFIRMED) — sempre derivado. */
export async function getShippedByOrderLines(
  prisma: PrismaOrTx,
  customerOrderLineIds: string[],
): Promise<Map<string, Prisma.Decimal>> {
  if (customerOrderLineIds.length === 0) return new Map();
  const grouped = await prisma.shipmentLine.groupBy({
    by: ["customerOrderLineId"],
    where: {
      customerOrderLineId: { in: customerOrderLineIds },
      shipment: { status: "CONFIRMED" },
    },
    _sum: { quantity: true },
  });
  const map = new Map<string, Prisma.Decimal>();
  for (const row of grouped) {
    map.set(row.customerOrderLineId, row._sum.quantity ?? new Prisma.Decimal(0));
  }
  return map;
}

function toShipmentLineDTO(
  line: ShipmentLineWithRelations,
  reservedRemaining: Prisma.Decimal,
): ShipmentLineDTO {
  const usingSnapshot = line.productCode !== null;
  const lot = line.lot;
  return {
    id: line.id,
    customerOrderLineId: line.customerOrderLineId,
    customerOrderReservationLineId: line.customerOrderReservationLineId,
    productId: line.productId,
    productCode: usingSnapshot ? line.productCode! : line.product.code,
    productName: usingSnapshot ? line.productName! : line.product.name,
    itemId: line.itemId,
    finishedItemCode: usingSnapshot ? line.finishedItemCode : line.item.code,
    finishedItemName: usingSnapshot ? line.finishedItemName : line.item.name,
    lotId: line.lotId,
    lotCode: usingSnapshot ? line.lotCode : (lot ? lot.code : null),
    businessLotNumber: usingSnapshot ? line.businessLotNumber : (lot ? lot.businessLotNumber : null),
    expiryDate: lot?.expiryDate ? lot.expiryDate.toISOString() : null,
    location: lot ? lot.location : null,
    quantity: line.quantity.toString(),
    unitCode: line.unitCode,
    position: line.position,
    reservedRemaining: reservedRemaining.toString(),
    // Item loteado com quantidade real e o unico caso que exige conferencia
    // fisica antes da saida.
    requiresVerification: line.lotId !== null && line.quantity.greaterThan(0),
    verifiedAt: line.verifiedAt ? line.verifiedAt.toISOString() : null,
    verifiedBy: line.verifiedBy,
  };
}

/**
 * Progresso por produto do Pedido — SEMPRE derivado na leitura. Um Pedido
 * com varios produtos gera varios grupos, inclusive para produtos que ainda
 * nao tem reserva nesta Expedicao (aparecem com `shippingNow = 0`, para o
 * operador enxergar o que falta em vez de achar que o pedido esta completo).
 */
function buildProductGroups(
  shipment: ShipmentWithRelations,
  lineDTOs: ShipmentLineDTO[],
  shippedByOrderLine: Map<string, Prisma.Decimal>,
): ShipmentProductGroupDTO[] {
  const linesByOrderLine = new Map<string, ShipmentLineDTO[]>();
  for (const line of lineDTOs) {
    const bucket = linesByOrderLine.get(line.customerOrderLineId) ?? [];
    bucket.push(line);
    linesByOrderLine.set(line.customerOrderLineId, bucket);
  }

  return shipment.customerOrder.lines.map((orderLine) => {
    const lines = linesByOrderLine.get(orderLine.id) ?? [];
    const shipped = shippedByOrderLine.get(orderLine.id) ?? new Prisma.Decimal(0);
    const outstanding = Prisma.Decimal.max(orderLine.orderedQuantity.minus(shipped), 0);

    let shippingNow = new Prisma.Decimal(0);
    let reservedRemaining = new Prisma.Decimal(0);
    let lotsRequired = 0;
    let lotsVerified = 0;
    for (const line of lines) {
      shippingNow = shippingNow.plus(line.quantity);
      reservedRemaining = reservedRemaining.plus(line.reservedRemaining);
      if (!line.requiresVerification) continue;
      lotsRequired += 1;
      if (line.verifiedAt !== null) lotsVerified += 1;
    }

    // Status puramente visual: nunca persistido, nunca usado como regra.
    let status: ShipmentProductStatus;
    if (lotsRequired === 0) status = "PENDING";
    else if (lotsVerified === 0) status = "READY";
    else if (lotsVerified < lotsRequired) status = "PARTIAL";
    else status = "VERIFIED";

    const reference = lines[0];
    return {
      customerOrderLineId: orderLine.id,
      productId: orderLine.productId,
      productCode: orderLine.productCode ?? reference?.productCode ?? "—",
      productName: orderLine.productName ?? reference?.productName ?? "—",
      itemId: orderLine.finishedItemId ?? reference?.itemId ?? null,
      finishedItemCode: orderLine.finishedItemCode ?? reference?.finishedItemCode ?? null,
      finishedItemName: orderLine.finishedItemName ?? reference?.finishedItemName ?? null,
      unitCode: orderLine.unitCode,
      orderedQuantity: orderLine.orderedQuantity.toString(),
      shippedQuantity: shipped.toString(),
      outstandingQuantity: outstanding.toString(),
      reservedRemaining: reservedRemaining.toString(),
      shippingNow: shippingNow.toString(),
      lotsRequired,
      lotsVerified,
      status,
    };
  });
}

async function toShipmentDTO(shipment: ShipmentWithRelations): Promise<ShipmentDTO> {
  const billingInfo = (await getBillingStatusByShipments(getPrisma(), [shipment.id])).get(shipment.id) ?? {
    status: "PENDING" as const,
    billingId: null,
    billingCode: null,
  };
  // Numa Expedicao CONFIRMED o "reservado disponivel" ja considera a
  // propria saida — a UI read-only mostra o historico, nao um teto de
  // edicao. Em DRAFT e o teto real do que ainda pode ser enviado.
  const [reservedRemainingByLine, shippedByOrderLine] = await Promise.all([
    getReservedRemainingByLines(
      getPrisma(),
      shipment.lines.map((line) => line.customerOrderReservationLineId),
    ),
    getShippedByOrderLines(
      getPrisma(),
      shipment.customerOrder.lines.map((line) => line.id),
    ),
  ]);
  const totalQuantity = shipment.lines.reduce((sum, line) => sum.plus(line.quantity), new Prisma.Decimal(0));

  const lineDTOs = shipment.lines.map((line) =>
    toShipmentLineDTO(
      line,
      reservedRemainingByLine.get(line.customerOrderReservationLineId) ?? new Prisma.Decimal(0),
    ),
  );
  const products = buildProductGroups(shipment, lineDTOs, shippedByOrderLine);

  // Contagem de produtos/lotes — nunca soma de unidades incompativeis.
  const linesRequiringVerification = lineDTOs.filter((line) => line.requiresVerification);
  const verification = {
    productCount: products.filter((group) => new Prisma.Decimal(group.shippingNow).greaterThan(0)).length,
    lotsRequired: linesRequiringVerification.length,
    lotsVerified: linesRequiringVerification.filter((line) => line.verifiedAt !== null).length,
    allLotsVerified: linesRequiringVerification.every((line) => line.verifiedAt !== null),
  };

  return {
    id: shipment.id,
    code: shipment.code,
    customerOrderId: shipment.customerOrderId,
    customerOrderCode: shipment.customerOrder.code,
    customerId: shipment.customerOrder.customerId,
    customerName: shipment.customerOrder.customerName ?? shipment.customerOrder.customer.legalName,
    status: shipment.status,
    shipmentDate: shipment.shipmentDate ? shipment.shipmentDate.toISOString() : null,
    notes: shipment.notes,
    lines: lineDTOs,
    products,
    verification,
    totalQuantity: totalQuantity.toString(),
    billingStatus: billingInfo.status,
    billingId: billingInfo.billingId,
    billingCode: billingInfo.billingCode,
    confirmedAt: shipment.confirmedAt ? shipment.confirmedAt.toISOString() : null,
    confirmedBy: shipment.confirmedBy,
    cancelledAt: shipment.cancelledAt ? shipment.cancelledAt.toISOString() : null,
    cancelledBy: shipment.cancelledBy,
    cancelReason: shipment.cancelReason,
    createdAt: shipment.createdAt.toISOString(),
    createdBy: shipment.createdBy,
    updatedAt: shipment.updatedAt.toISOString(),
  };
}

export async function listShipments(query: ListShipmentsQuery): Promise<ShipmentListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.status) where["status"] = query.status;
  if (query.customerOrderId) where["customerOrderId"] = query.customerOrderId;
  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { customerOrder: { is: { code: { contains: query.search, mode: "insensitive" } } } },
      { customerOrder: { is: { customerName: { contains: query.search, mode: "insensitive" } } } },
    ];
  }

  const [shipments, total] = await Promise.all([
    prisma.shipment.findMany({
      where,
      include: shipmentInclude,
      orderBy: { code: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.shipment.count({ where }),
  ]);

  return {
    shipments: await Promise.all(shipments.map(toShipmentDTO)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

export async function getShipmentById(id: string): Promise<ShipmentDTO | null> {
  const shipment = await getPrisma().shipment.findUnique({ where: { id }, include: shipmentInclude });
  return shipment ? toShipmentDTO(shipment) : null;
}

/**
 * Cria a Expedicao DRAFT ja pre-preenchida com o reservado disponivel de
 * cada lote (limitado pelo que ainda falta expedir de cada linha do
 * Pedido). Nunca cria InventoryMovement, nunca toca a Reserva. No maximo
 * uma DRAFT por Pedido (garantido tambem por indice parcial no banco).
 */
export async function createShipmentDraft(customerOrderId: string): Promise<ShipmentDTO> {
  const prisma = getPrisma();
  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, SHIPMENT_CODE_PREFIX);

  const shipmentId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM customer_orders WHERE id = ${customerOrderId} FOR UPDATE`;

    const order = await tx.customerOrder.findUnique({
      where: { id: customerOrderId },
      include: { lines: true },
    });
    if (!order) throw new CustomerOrderNotFoundError(customerOrderId);
    if (!SHIPPABLE_ORDER_STATUSES.includes(order.status as (typeof SHIPPABLE_ORDER_STATUSES)[number])) {
      throw new OrderNotShippableError(
        "Somente pedidos em atendimento ou parcialmente expedidos permitem preparar uma expedição.",
      );
    }

    const existingDraft = await tx.shipment.findFirst({
      where: { customerOrderId, status: "DRAFT" },
    });
    if (existingDraft) throw new DraftShipmentAlreadyExistsError(existingDraft.code);

    const reservationLines = await getActiveReservationLines(tx, customerOrderId);
    const reservedRemainingByLine = await getReservedRemainingByLines(
      tx,
      reservationLines.map((line) => line.id),
    );
    const shippedByOrderLine = await getShippedByOrderLines(
      tx,
      order.lines.map((line) => line.id),
    );

    // Teto por linha do Pedido: nunca propor mais do que ainda falta
    // expedir daquele produto, mesmo que haja reserva sobrando.
    const outstandingByOrderLine = new Map<string, Prisma.Decimal>();
    for (const line of order.lines) {
      const shipped = shippedByOrderLine.get(line.id) ?? new Prisma.Decimal(0);
      outstandingByOrderLine.set(line.id, Prisma.Decimal.max(line.orderedQuantity.minus(shipped), 0));
    }

    const linesToCreate: {
      customerOrderLineId: string;
      customerOrderReservationLineId: string;
      productId: string;
      itemId: string;
      lotId: string | null;
      quantity: Prisma.Decimal;
      unitCode: string;
    }[] = [];

    for (const reservationLine of reservationLines) {
      const remaining = reservedRemainingByLine.get(reservationLine.id) ?? new Prisma.Decimal(0);
      if (remaining.lessThanOrEqualTo(0)) continue;

      const outstanding = outstandingByOrderLine.get(reservationLine.customerOrderLineId) ?? new Prisma.Decimal(0);
      const quantity = Prisma.Decimal.min(remaining, outstanding);
      if (quantity.lessThanOrEqualTo(0)) continue;

      outstandingByOrderLine.set(reservationLine.customerOrderLineId, outstanding.minus(quantity));
      linesToCreate.push({
        customerOrderLineId: reservationLine.customerOrderLineId,
        customerOrderReservationLineId: reservationLine.id,
        productId: reservationLine.productId,
        itemId: reservationLine.itemId,
        lotId: reservationLine.lotId,
        quantity,
        unitCode: reservationLine.item.unitCode,
      });
    }

    if (linesToCreate.length === 0) throw new NothingToShipError();

    const shipment = await tx.shipment.create({
      data: { code, customerOrderId, status: "DRAFT", createdBy: SYSTEM_ACTOR },
    });
    await tx.shipmentLine.createMany({
      data: linesToCreate.map((line, index) => ({
        shipmentId: shipment.id,
        customerOrderLineId: line.customerOrderLineId,
        customerOrderReservationLineId: line.customerOrderReservationLineId,
        productId: line.productId,
        itemId: line.itemId,
        lotId: line.lotId,
        quantity: line.quantity,
        unitCode: line.unitCode,
        position: index,
      })),
    });

    return shipment.id;
  });

  return (await getShipmentById(shipmentId))!;
}

/**
 * Ajusta a separacao (quantidades por linha de reserva e observacoes).
 * Nunca altera Reserva nem estoque — DRAFT e so planejamento.
 */
export async function updateShipment(id: string, input: UpdateShipmentInput): Promise<ShipmentDTO> {
  await getPrisma().$transaction(async (tx) => {
    const shipment = await tx.shipment.findUnique({ where: { id } });
    if (!shipment) throw new ShipmentNotFoundError(id);
    if (shipment.status !== "DRAFT") {
      throw new ShipmentNotDraftError("Somente expedições em rascunho podem ser editadas.");
    }

    if (input.lines !== undefined) {
      const reservationLines = await getActiveReservationLines(tx, shipment.customerOrderId);
      const reservationLinesById = new Map(reservationLines.map((line) => [line.id, line]));
      const reservedRemainingByLine = await getReservedRemainingByLines(
        tx,
        reservationLines.map((line) => line.id),
      );

      const nonZero = input.lines.filter((line) => new Prisma.Decimal(line.quantity).greaterThan(0));
      for (const line of nonZero) {
        const reservationLine = reservationLinesById.get(line.customerOrderReservationLineId);
        if (!reservationLine) throw new ReservationLineNotFoundError(line.customerOrderReservationLineId);

        const remaining = reservedRemainingByLine.get(reservationLine.id) ?? new Prisma.Decimal(0);
        if (new Prisma.Decimal(line.quantity).greaterThan(remaining)) {
          throw new ExceedsReservedRemainingError(
            reservationLine.lot?.code ?? reservationLine.item.code,
            remaining.toString(),
          );
        }
      }

      // A separacao e reescrita a cada save, mas a conferencia fisica ja
      // feita nao pode ser perdida por isso: ela vale para o LOTE daquela
      // linha de reserva, e quantidade e um conceito separado. Se a reserva
      // for realocada, a linha de reserva antiga deixa de existir e a
      // conferencia naturalmente nao e reaproveitada.
      const existingLines = await tx.shipmentLine.findMany({
        where: { shipmentId: id },
        select: { customerOrderReservationLineId: true, verifiedAt: true, verifiedBy: true },
      });
      const verificationByReservationLine = new Map(
        existingLines
          .filter((line) => line.verifiedAt !== null)
          .map((line) => [
            line.customerOrderReservationLineId,
            { verifiedAt: line.verifiedAt, verifiedBy: line.verifiedBy },
          ]),
      );

      await tx.shipmentLine.deleteMany({ where: { shipmentId: id } });
      if (nonZero.length > 0) {
        await tx.shipmentLine.createMany({
          data: nonZero.map((line, index) => {
            const reservationLine = reservationLinesById.get(line.customerOrderReservationLineId)!;
            const verification = verificationByReservationLine.get(reservationLine.id);
            return {
              shipmentId: id,
              customerOrderLineId: reservationLine.customerOrderLineId,
              customerOrderReservationLineId: reservationLine.id,
              productId: reservationLine.productId,
              itemId: reservationLine.itemId,
              lotId: reservationLine.lotId,
              quantity: new Prisma.Decimal(line.quantity),
              unitCode: reservationLine.item.unitCode,
              position: index,
              ...(verification
                ? { verifiedAt: verification.verifiedAt, verifiedBy: verification.verifiedBy }
                : {}),
            };
          }),
        });
      }
    }

    await tx.shipment.update({
      where: { id },
      data: { ...(input.notes !== undefined ? { notes: input.notes } : {}) },
    });
  });

  return (await getShipmentById(id))!;
}

/**
 * Confere fisicamente o lote de uma linha da Expedicao (§12-19 do handoff).
 *
 * Aceita o codigo puro ou o payload de QR (`LOT:LT-...`), reutilizando a
 * MESMA normalizacao do lookup de lotes — nao existe segundo padrao de QR.
 *
 * A conferencia responde apenas "o lote certo esta fisicamente aqui?".
 * NUNCA cria InventoryMovement, nunca altera On Hand/Reserved/Available e
 * nunca mexe no status do Pedido: a saida fisica continua acontecendo
 * exclusivamente na confirmacao da Expedicao. Tambem nunca troca o lote da
 * linha — lote divergente e erro, e trocar exige realocacao explicita da
 * reserva.
 */
export async function verifyShipmentLine(
  shipmentId: string,
  shipmentLineId: string,
  rawLotCode: string,
): Promise<ShipmentDTO> {
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    const shipment = await tx.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw new ShipmentNotFoundError(shipmentId);
    if (shipment.status !== "DRAFT") {
      throw new ShipmentNotDraftError(
        "Somente expedições em rascunho permitem conferir lotes — uma expedição confirmada é histórico.",
      );
    }

    const line = await tx.shipmentLine.findFirst({
      where: { id: shipmentLineId, shipmentId },
      include: { item: true, customerOrderReservationLine: { include: { reservation: true, lot: true } } },
    });
    if (!line) throw new ShipmentLineNotFoundError(shipmentLineId);
    if (line.quantity.lessThanOrEqualTo(0)) {
      throw new LineNotVerifiableError(
        "Informe a quantidade a expedir desta linha antes de conferir o lote.",
      );
    }
    if (line.lotId === null) {
      throw new LineNotVerifiableError("Esta linha não controla lote — não há conferência a fazer.");
    }

    const normalized = normalizeLotLookupCode(rawLotCode);
    if (!normalized) throw new LotNotFoundError(rawLotCode);

    const lot = await tx.lot.findUnique({ where: { code: normalized } });
    if (!lot) throw new LotNotFoundError(normalized);

    const reservationLine = line.customerOrderReservationLine;
    // A reserva tem que ser deste Pedido — o contexto comercial vem da
    // Expedicao, nunca do lote.
    if (reservationLine.reservation.customerOrderId !== shipment.customerOrderId) {
      throw new ReservationLineNotFoundError(line.customerOrderReservationLineId);
    }

    // Identidade: um lote pertence a exatamente UM Item. Um lote de
    // componente usado na OP nunca vira produto expedivel, e o lote de outro
    // produto acabado tambem nao serve.
    const expectedLot = reservationLine.lot;
    if (!expectedLot || lot.id !== expectedLot.id) {
      throw new LotMismatchError(expectedLot?.code ?? line.lotCode ?? "—", lot.code);
    }
    if (lot.itemId !== line.itemId) {
      throw new LotMismatchError(expectedLot.code, lot.code);
    }

    // Lote precisa estar operacionalmente utilizavel AGORA — bloqueado,
    // aguardando Qualidade ou vencido nunca sai.
    if (!isLotAvailableForUse(lot)) throw new LotNotShippableError(lot.code);

    const remaining =
      (await getReservedRemainingByLines(tx, [reservationLine.id])).get(reservationLine.id) ??
      new Prisma.Decimal(0);
    if (remaining.lessThanOrEqualTo(0)) {
      throw new ExceedsReservedRemainingError(lot.code, "0");
    }
    if (line.quantity.greaterThan(remaining)) {
      throw new ExceedsReservedRemainingError(lot.code, remaining.toString());
    }

    // Só auditoria: nenhum InventoryMovement é criado aqui.
    await tx.shipmentLine.update({
      where: { id: line.id },
      data: { verifiedAt: new Date(), verifiedBy: SYSTEM_ACTOR },
    });
  });

  return (await getShipmentById(shipmentId))!;
}

/**
 * Confirma a Expedicao — a UNICA operacao que altera estoque fisico.
 * Transacional (secao 13 do handoff): trava Shipment/Pedido/Items/Lotes em
 * ordem deterministica, revalida reserva, elegibilidade do lote e saldo
 * fisico, cria exatamente 1 InventoryMovement SHIPMENT_OUT por linha e
 * atualiza o status do Pedido a partir do que foi REALMENTE expedido.
 * Rollback completo em qualquer falha — nunca expedicao parcial dentro do
 * mesmo submit.
 */
export async function confirmShipment(id: string): Promise<ShipmentDTO> {
  await getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM shipments WHERE id = ${id} FOR UPDATE`;

    const shipment = await tx.shipment.findUnique({ where: { id }, include: { lines: true } });
    if (!shipment) throw new ShipmentNotFoundError(id);
    if (shipment.status !== "DRAFT") {
      throw new ShipmentNotDraftError("Somente expedições em rascunho podem ser confirmadas.");
    }

    await tx.$queryRaw`SELECT id FROM customer_orders WHERE id = ${shipment.customerOrderId} FOR UPDATE`;

    const order = await tx.customerOrder.findUnique({
      where: { id: shipment.customerOrderId },
      include: { lines: true },
    });
    if (!order) throw new CustomerOrderNotFoundError(shipment.customerOrderId);
    if (!SHIPPABLE_ORDER_STATUSES.includes(order.status as (typeof SHIPPABLE_ORDER_STATUSES)[number])) {
      throw new OrderNotShippableError(
        "Somente pedidos em atendimento ou parcialmente expedidos permitem confirmar uma expedição.",
      );
    }

    const shipmentLines = shipment.lines.filter((line) => line.quantity.greaterThan(0));
    if (shipmentLines.length === 0) throw new EmptyShipmentError();

    // Item loteado so sai depois de conferido fisicamente. Regra validada no
    // backend — a UI apenas antecipa o bloqueio.
    const unverified = shipmentLines.filter((line) => line.lotId !== null && line.verifiedAt === null);
    if (unverified.length > 0) throw new UnverifiedShipmentLinesError();

    // Trava Items e Lotes envolvidos em ordem deterministica — mesmo padrao
    // de concorrencia do RELEASE de OP/Aplicar Plano. Protege contra duas
    // confirmacoes consumindo o mesmo reservedRemaining.
    const itemIds = [...new Set(shipmentLines.map((line) => line.itemId))].sort();
    await tx.$queryRaw`SELECT id FROM items WHERE id IN (${Prisma.join(itemIds)}) ORDER BY id FOR UPDATE`;
    const lotIds = [...new Set(shipmentLines.map((line) => line.lotId).filter((lotId): lotId is string => lotId !== null))].sort();
    if (lotIds.length > 0) {
      await tx.$queryRaw`SELECT id FROM lots WHERE id IN (${Prisma.join(lotIds)}) ORDER BY id FOR UPDATE`;
    }

    const reservationLines = await getActiveReservationLines(tx, shipment.customerOrderId);
    const reservationLinesById = new Map(reservationLines.map((line) => [line.id, line]));
    const reservedRemainingByLine = await getReservedRemainingByLines(
      tx,
      reservationLines.map((line) => line.id),
    );
    const shippedByOrderLineMap = await getShippedByOrderLines(
      tx,
      order.lines.map((line) => line.id),
    );
    const orderLinesById = new Map(order.lines.map((line) => [line.id, line]));

    // Acumuladores locais — cobrem duas linhas da MESMA expedicao apontando
    // para a mesma reserva/linha do Pedido, sem dupla-contar o teto.
    const consumedRemaining = new Map<string, Prisma.Decimal>();
    const consumedOutstanding = new Map<string, Prisma.Decimal>();

    for (const line of shipmentLines) {
      const reservationLine = reservationLinesById.get(line.customerOrderReservationLineId);
      if (!reservationLine) throw new ReservationLineNotFoundError(line.customerOrderReservationLineId);

      const lotLabel = reservationLine.lot?.code ?? reservationLine.item.code;

      // Reservado ainda disponivel nesta linha de reserva.
      const remaining = (reservedRemainingByLine.get(reservationLine.id) ?? new Prisma.Decimal(0)).minus(
        consumedRemaining.get(reservationLine.id) ?? new Prisma.Decimal(0),
      );
      if (line.quantity.greaterThan(remaining)) {
        throw new ExceedsReservedRemainingError(lotLabel, Prisma.Decimal.max(remaining, 0).toString());
      }
      consumedRemaining.set(
        reservationLine.id,
        (consumedRemaining.get(reservationLine.id) ?? new Prisma.Decimal(0)).plus(line.quantity),
      );

      // Nunca expedir mais do que a propria linha do Pedido ainda deve.
      const orderLine = orderLinesById.get(line.customerOrderLineId)!;
      const alreadyShipped = shippedByOrderLineMap.get(orderLine.id) ?? new Prisma.Decimal(0);
      const outstanding = orderLine.orderedQuantity
        .minus(alreadyShipped)
        .minus(consumedOutstanding.get(orderLine.id) ?? new Prisma.Decimal(0));
      if (line.quantity.greaterThan(outstanding)) {
        throw new ExceedsOutstandingError(
          orderLine.productCode ?? orderLine.productId,
          Prisma.Decimal.max(outstanding, 0).toString(),
        );
      }
      consumedOutstanding.set(
        orderLine.id,
        (consumedOutstanding.get(orderLine.id) ?? new Prisma.Decimal(0)).plus(line.quantity),
      );

      // Revalida o lote AGORA — pode ter vencido/sido bloqueado entre a
      // reserva e a saida fisica, independente do que valia antes.
      if (reservationLine.lot && !isLotAvailableForUse(reservationLine.lot)) {
        throw new LotNotShippableError(reservationLine.lot.code);
      }

      // Alem da reserva, precisa existir saldo fisico real no lote.
      const onHand = await getOnHand(tx, { itemId: line.itemId, lotId: line.lotId });
      if (line.quantity.greaterThan(onHand)) throw new InsufficientOnHandError(lotLabel);
    }

    const shipmentDate = new Date();

    for (const line of shipmentLines) {
      const reservationLine = reservationLinesById.get(line.customerOrderReservationLineId)!;

      // Snapshot historico — base do futuro Faturamento (que se baseia no
      // realmente expedido, nunca no pedido/reservado/planejado).
      await tx.shipmentLine.update({
        where: { id: line.id },
        data: {
          productCode: reservationLine.product.code,
          productName: reservationLine.product.name,
          finishedItemCode: reservationLine.item.code,
          finishedItemName: reservationLine.item.name,
          lotCode: reservationLine.lot?.code ?? null,
          businessLotNumber: reservationLine.lot?.businessLotNumber ?? null,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          itemId: line.itemId,
          lotId: line.lotId,
          type: "SHIPMENT_OUT",
          quantity: line.quantity,
          occurredAt: shipmentDate,
          sourceType: "SHIPMENT",
          sourceId: shipment.id,
          shipmentLineId: line.id,
          createdBy: SYSTEM_ACTOR,
        },
      });
    }

    await tx.shipment.update({
      where: { id },
      data: {
        status: "CONFIRMED",
        shipmentDate,
        confirmedAt: shipmentDate,
        confirmedBy: SYSTEM_ACTOR,
      },
    });

    // Status do Pedido deriva 100% das ShipmentLines reais — sem segunda
    // fonte de verdade mutavel, sem botao "marcar como enviado".
    const shippedAfter = await getShippedByOrderLines(
      tx,
      order.lines.map((orderLine) => orderLine.id),
    );
    const fullyShipped = order.lines.every((orderLine) => {
      const shipped = shippedAfter.get(orderLine.id) ?? new Prisma.Decimal(0);
      return shipped.greaterThanOrEqualTo(orderLine.orderedQuantity);
    });

    await tx.customerOrder.update({
      where: { id: order.id },
      data: { status: fullyShipped ? "SHIPPED" : "PARTIALLY_SHIPPED" },
    });

    if (fullyShipped) {
      // Pedido totalmente expedido nunca deve manter compromisso ativo. Se
      // sobrar reserva por inconsistencia, ela e liberada aqui mesmo — o
      // excedente e inequivocamente deste Pedido. Nunca gera
      // InventoryMovement (nada saiu fisicamente por causa da liberacao).
      await tx.customerOrderReservation.updateMany({
        where: { customerOrderId: order.id, status: "ACTIVE" },
        data: {
          status: "RELEASED",
          releasedAt: shipmentDate,
          releasedBy: SYSTEM_ACTOR,
          releaseReason: ORDER_SHIPPED_RELEASE_REASON,
        },
      });
    }
  });

  return (await getShipmentById(id))!;
}

/** DRAFT -> CANCELLED. Nunca altera On Hand/Reserved/Pedido — DRAFT nunca foi realidade fisica. */
export async function cancelShipment(id: string, reason: string): Promise<ShipmentDTO> {
  await getPrisma().$transaction(async (tx) => {
    const shipment = await tx.shipment.findUnique({ where: { id } });
    if (!shipment) throw new ShipmentNotFoundError(id);
    if (shipment.status !== "DRAFT") {
      throw new ShipmentNotDraftError(
        "Somente expedições em rascunho podem ser canceladas — uma expedição confirmada já saiu fisicamente.",
      );
    }

    await tx.shipment.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: SYSTEM_ACTOR,
        cancelReason: reason,
      },
    });
  });

  return (await getShipmentById(id))!;
}
