import { Prisma } from "@prisma/client";
import type {
  CustomerOrderReportRowDTO,
  FulfillmentRowDTO,
  OrderDeliveredBilledRowDTO,
  OrderOperationDTO,
  ReportPageDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { getBilledByOrderLines } from "../billings/billings.service.js";
import { deriveOrderBillingStatus } from "../customer-orders/customer-orders.service.js";
import { getReservedRemainingByLines, getShippedByOrderLines } from "../shipments/shipments.service.js";
import type { Pagination } from "../../lib/pagination.js";
import { ALL_ROWS, pageArgs, pageMeta, slicePage } from "../../lib/pagination.js";
import type {
  CustomerOrdersQuery,
  FulfillmentQuery,
  OrderOperationQuery,
} from "./reports.schemas.js";

/** Filtro comum dos relatórios de Pedido — período sempre por `orderDate`. */
function orderWhere(query: {
  search?: string | undefined;
  customerId?: string | undefined;
  status?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}): Prisma.CustomerOrderWhereInput {
  // `exactOptionalPropertyTypes` nao aceita spread condicional direto sobre
  // campos de enum do Prisma — o objeto e montado e tipado no retorno.
  const where: Record<string, unknown> = {
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.status ? { status: query.status as Prisma.CustomerOrderWhereInput["status"] } : {}),
    ...(query.from || query.to
      ? {
          orderDate: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { customerName: { contains: query.search, mode: "insensitive" } },
            { customer: { is: { legalName: { contains: query.search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  return where as Prisma.CustomerOrderWhereInput;
}

/**
 * R-12 — Pedidos do Cliente. Lista os documentos com o estado operacional e
 * o de faturamento (mesma regra do Pedido, `deriveOrderBillingStatus`).
 * Quantidades de produtos diferentes NUNCA são somadas: a coluna mostra os
 * códigos dos produtos e a contagem de linhas.
 */
export async function getCustomerOrdersReport(
  query: CustomerOrdersQuery,
  pagination: Pagination = query,
): Promise<ReportPageDTO<CustomerOrderReportRowDTO>> {
  const prisma = getPrisma();
  const where = orderWhere(query);

  const [orders, total] = await Promise.all([
    prisma.customerOrder.findMany({
      where,
      include: {
        customer: true,
        lines: true,
        shipments: { select: { id: true, status: true } },
        billings: { select: { id: true, status: true } },
      },
      orderBy: [{ orderDate: "desc" }, { code: "desc" }],
      ...pageArgs(pagination),
    }),
    prisma.customerOrder.count({ where }),
  ]);

  const lineIds = orders.flatMap((order) => order.lines.map((line) => line.id));
  const [shippedByLine, billedByLine] = await Promise.all([
    getShippedByOrderLines(prisma, lineIds),
    getBilledByOrderLines(prisma, lineIds),
  ]);

  const rows = orders.map((order): CustomerOrderReportRowDTO => ({
    customerOrderId: order.id,
    code: order.code,
    customerId: order.customerId,
    customerName: order.customerName ?? order.customer.legalName,
    orderDate: order.orderDate.toISOString(),
    requestedDeliveryDate: order.requestedDeliveryDate
      ? order.requestedDeliveryDate.toISOString()
      : null,
    status: order.status,
    billingStatus: deriveOrderBillingStatus(order, shippedByLine, billedByLine),
    lineCount: order.lines.length,
    productCodes: order.lines.map((line) => line.productCode ?? "—"),
    shipmentCount: order.shipments.filter((shipment) => shipment.status !== "CANCELLED").length,
    billingCount: order.billings.filter((billing) => billing.status !== "CANCELLED").length,
  }));

  return { rows, ...pageMeta(pagination, total) };
}

/** Linhas de Pedido com todos os agregados operacionais já resolvidos em lote. */
async function loadOrderLineAggregates(orderIds: string[], lineIds: string[]) {
  const prisma = getPrisma();

  const [shippedByLine, billedByLine, reservationLines, productionOutputs] = await Promise.all([
    getShippedByOrderLines(prisma, lineIds),
    getBilledByOrderLines(prisma, lineIds),
    prisma.customerOrderReservationLine.findMany({
      where: {
        releasedAt: null,
        customerOrderLineId: { in: lineIds },
        reservation: { status: "ACTIVE" },
      },
      select: { id: true, customerOrderLineId: true },
    }),
    // Produzido para a linha do Pedido: apontamento REAL das OPs ligadas a
    // ela — nunca reservado nem planejado.
    prisma.productionOutput.groupBy({
      by: ["productionOrderId"],
      where: { productionOrder: { customerOrderId: { in: orderIds } } },
      _sum: { quantity: true },
    }),
  ]);

  const reservedRemainingByReservationLine = await getReservedRemainingByLines(
    prisma,
    reservationLines.map((line) => line.id),
  );
  const reservedRemainingByOrderLine = new Map<string, Prisma.Decimal>();
  for (const line of reservationLines) {
    const current = reservedRemainingByOrderLine.get(line.customerOrderLineId) ?? new Prisma.Decimal(0);
    reservedRemainingByOrderLine.set(
      line.customerOrderLineId,
      current.plus(reservedRemainingByReservationLine.get(line.id) ?? new Prisma.Decimal(0)),
    );
  }

  const producedOrders = await prisma.productionOrder.findMany({
    where: { id: { in: productionOutputs.map((row) => row.productionOrderId) } },
    select: { id: true, customerOrderLineId: true },
  });
  const producedByOrderLine = new Map<string, Prisma.Decimal>();
  const productionOrderCountByLine = new Map<string, number>();
  const producedByProductionOrder = new Map(
    productionOutputs.map((row) => [row.productionOrderId, row._sum.quantity ?? new Prisma.Decimal(0)]),
  );
  for (const order of producedOrders) {
    if (!order.customerOrderLineId) continue;
    const current = producedByOrderLine.get(order.customerOrderLineId) ?? new Prisma.Decimal(0);
    producedByOrderLine.set(
      order.customerOrderLineId,
      current.plus(producedByProductionOrder.get(order.id) ?? new Prisma.Decimal(0)),
    );
  }

  const linkedProductionOrders = await prisma.productionOrder.groupBy({
    by: ["customerOrderLineId"],
    where: { customerOrderLineId: { in: lineIds }, status: { not: "CANCELLED" } },
    _count: { _all: true },
  });
  for (const row of linkedProductionOrders) {
    if (!row.customerOrderLineId) continue;
    productionOrderCountByLine.set(row.customerOrderLineId, row._count._all);
  }

  return {
    shippedByLine,
    billedByLine,
    reservedRemainingByOrderLine,
    producedByOrderLine,
    productionOrderCountByLine,
  };
}

/**
 * R-13 — Atendimento dos Pedidos, na granularidade da linha do Pedido.
 * Produzido, expedido e faturado são coisas DIFERENTES e nunca inferidos um
 * do outro: produzido vem de ProductionOutput, expedido de Expedições
 * CONFIRMED e faturado de Faturamentos ISSUED.
 */
export async function getFulfillmentReport(
  query: FulfillmentQuery,
  pagination: Pagination = query,
): Promise<ReportPageDTO<FulfillmentRowDTO>> {
  const prisma = getPrisma();
  const where = {
    ...orderWhere(query),
    ...(query.customerOrderId ? { id: query.customerOrderId } : {}),
    ...(query.productId ? { lines: { some: { productId: query.productId } } } : {}),
  } as Prisma.CustomerOrderWhereInput;

  const orders = await prisma.customerOrder.findMany({
    where,
    include: {
      customer: true,
      lines: { include: { product: true }, orderBy: { position: "asc" } },
      shipments: { select: { id: true, status: true } },
    },
    orderBy: [{ orderDate: "desc" }, { code: "desc" }],
  });

  const lineIds = orders.flatMap((order) => order.lines.map((line) => line.id));
  const aggregates = await loadOrderLineAggregates(
    orders.map((order) => order.id),
    lineIds,
  );

  const rows: FulfillmentRowDTO[] = [];
  for (const order of orders) {
    const billingStatus = deriveOrderBillingStatus(order, aggregates.shippedByLine, aggregates.billedByLine);
    for (const line of order.lines) {
      if (query.productId && line.productId !== query.productId) continue;

      const shipped = aggregates.shippedByLine.get(line.id) ?? new Prisma.Decimal(0);
      const billed = aggregates.billedByLine.get(line.id) ?? new Prisma.Decimal(0);

      rows.push({
        customerOrderId: order.id,
        customerOrderCode: order.code,
        customerOrderLineId: line.id,
        customerId: order.customerId,
        customerName: order.customerName ?? order.customer.legalName,
        productId: line.productId,
        productCode: line.productCode ?? line.product.code,
        productName: line.productName ?? line.product.name,
        orderedQuantity: line.orderedQuantity.toString(),
        reservedRemaining: (
          aggregates.reservedRemainingByOrderLine.get(line.id) ?? new Prisma.Decimal(0)
        ).toString(),
        producedQuantity: (
          aggregates.producedByOrderLine.get(line.id) ?? new Prisma.Decimal(0)
        ).toString(),
        productionOrderCount: aggregates.productionOrderCountByLine.get(line.id) ?? 0,
        shippedQuantity: shipped.toString(),
        billedQuantity: billed.toString(),
        outstandingQuantity: Prisma.Decimal.max(line.orderedQuantity.minus(shipped), 0).toString(),
        unitCode: line.unitCode,
        status: order.status,
        billingStatus,
      });
    }
  }

  return { rows: slicePage(rows, pagination), ...pageMeta(pagination, rows.length) };
}

/**
 * R-17 — Pedido x Entregue x Faturado. Mesma granularidade e mesmas fontes
 * do R-13, com o foco na diferença entre expedido e faturado: Faturamento
 * DRAFT nunca conta como faturado.
 */
export async function getOrderDeliveredBilledReport(
  query: FulfillmentQuery,
  pagination: Pagination = query,
): Promise<ReportPageDTO<OrderDeliveredBilledRowDTO>> {
  // Deriva do MESMO read model do R-13: pede o conjunto inteiro e pagina
  // depois, nunca uma segunda montagem da consulta.
  const fulfillment = await getFulfillmentReport(query, ALL_ROWS);

  const rows = fulfillment.rows.map((row): OrderDeliveredBilledRowDTO => {
    const shipped = new Prisma.Decimal(row.shippedQuantity);
    const billed = new Prisma.Decimal(row.billedQuantity);
    return {
      customerOrderId: row.customerOrderId,
      customerOrderCode: row.customerOrderCode,
      customerOrderLineId: row.customerOrderLineId,
      customerId: row.customerId,
      customerName: row.customerName,
      productId: row.productId,
      productCode: row.productCode,
      productName: row.productName,
      orderedQuantity: row.orderedQuantity,
      shippedQuantity: row.shippedQuantity,
      billedQuantity: row.billedQuantity,
      unbilledShippedQuantity: Prisma.Decimal.max(shipped.minus(billed), 0).toString(),
      outstandingDeliveryQuantity: row.outstandingQuantity,
      unitCode: row.unitCode,
      status: row.status,
      billingStatus: row.billingStatus,
    };
  });

  return { rows: slicePage(rows, pagination), ...pageMeta(pagination, rows.length) };
}

/**
 * R-14 — Pedido → Operação. Consolida a cadeia operacional de UM Pedido
 * navegando apenas relações que já existem (reserva, OP, OC, Expedição,
 * Faturamento). Nenhuma relação nova é inventada e nenhum número é
 * recalculado por fora dos serviços centrais.
 */
export async function getOrderOperation(
  query: OrderOperationQuery,
): Promise<OrderOperationDTO | null> {
  const prisma = getPrisma();

  const order = await prisma.customerOrder.findUnique({
    where: { id: query.customerOrderId },
    include: {
      customer: true,
      lines: { include: { product: true }, orderBy: { position: "asc" } },
      reservations: {
        include: {
          lines: { include: { product: true, item: true, lot: true }, orderBy: { createdAt: "asc" } },
        },
      },
      productionOrders: { include: { product: true, outputs: true }, orderBy: { code: "asc" } },
      purchaseOrders: { include: { lines: true }, orderBy: { code: "asc" } },
      shipments: {
        include: { lines: { include: { product: true, lot: true }, orderBy: { position: "asc" } } },
        orderBy: { code: "asc" },
      },
      billings: { include: { lines: true }, orderBy: { code: "asc" } },
    },
  });
  if (!order) return null;

  const reservationLines = order.reservations.flatMap((reservation) => reservation.lines);
  const shippedByReservationLine = await prisma.shipmentLine.groupBy({
    by: ["customerOrderReservationLineId"],
    where: {
      customerOrderReservationLineId: { in: reservationLines.map((line) => line.id) },
      shipment: { status: "CONFIRMED" },
    },
    _sum: { quantity: true },
  });
  const shippedByLine = new Map(
    shippedByReservationLine.map((row) => [
      row.customerOrderReservationLineId,
      row._sum.quantity ?? new Prisma.Decimal(0),
    ]),
  );

  return {
    customerOrderId: order.id,
    code: order.code,
    customerId: order.customerId,
    customerName: order.customerName ?? order.customer.legalName,
    status: order.status,
    orderDate: order.orderDate.toISOString(),
    requestedDeliveryDate: order.requestedDeliveryDate
      ? order.requestedDeliveryDate.toISOString()
      : null,
    lines: order.lines.map((line) => ({
      customerOrderLineId: line.id,
      productId: line.productId,
      productCode: line.productCode ?? line.product.code,
      productName: line.productName ?? line.product.name,
      orderedQuantity: line.orderedQuantity.toString(),
      unitCode: line.unitCode,
    })),
    reservations: reservationLines.map((line) => {
      const shipped = shippedByLine.get(line.id) ?? new Prisma.Decimal(0);
      return {
        reservationLineId: line.id,
        productId: line.productId,
        productCode: line.product.code,
        productName: line.product.name,
        lotId: line.lotId,
        lotCode: line.lot ? line.lot.code : null,
        reservedQuantity: line.quantity.toString(),
        shippedQuantity: shipped.toString(),
        remainingQuantity: Prisma.Decimal.max(line.quantity.minus(shipped), 0).toString(),
        unitCode: line.item.unitCode,
        releasedAt: line.releasedAt ? line.releasedAt.toISOString() : null,
      };
    }),
    productionOrders: order.productionOrders.map((productionOrder) => ({
      productionOrderId: productionOrder.id,
      code: productionOrder.code,
      productId: productionOrder.productId,
      productCode: productionOrder.productCode ?? productionOrder.product.code,
      productName: productionOrder.productName ?? productionOrder.product.name,
      plannedQuantity: productionOrder.plannedQuantity.toString(),
      producedQuantity: productionOrder.outputs
        .reduce((sum, output) => sum.plus(output.quantity), new Prisma.Decimal(0))
        .toString(),
      unitCode: productionOrder.outputUnitCode,
      status: productionOrder.status,
    })),
    purchaseOrders: order.purchaseOrders.map((purchaseOrder) => ({
      purchaseOrderId: purchaseOrder.id,
      code: purchaseOrder.code,
      supplierName: purchaseOrder.supplierName,
      status: purchaseOrder.status,
      itemCount: purchaseOrder.lines.length,
      expectedDeliveryDate: purchaseOrder.expectedDeliveryDate
        ? purchaseOrder.expectedDeliveryDate.toISOString()
        : null,
    })),
    shipments: order.shipments.map((shipment) => ({
      shipmentId: shipment.id,
      code: shipment.code,
      status: shipment.status,
      confirmedAt: shipment.confirmedAt ? shipment.confirmedAt.toISOString() : null,
      lines: shipment.lines.map((line) => ({
        productCode: line.productCode ?? line.product.code,
        lotCode: line.lotCode ?? (line.lot ? line.lot.code : null),
        quantity: line.quantity.toString(),
        unitCode: line.unitCode,
      })),
    })),
    billings: order.billings.map((billing) => {
      // Valor só quando o documento inteiro tem preço — parcial nunca vira total.
      const complete = billing.lines.length > 0 && billing.lines.every((line) => line.unitPrice !== null);
      return {
        billingId: billing.id,
        code: billing.code,
        shipmentId: billing.shipmentId,
        shipmentCode: billing.shipmentCode,
        status: billing.status,
        issuedAt: billing.issuedAt ? billing.issuedAt.toISOString() : null,
        lineCount: billing.lines.length,
        totalAmount: complete
          ? billing.lines
              .reduce((sum, line) => sum.plus(line.quantity.times(line.unitPrice!)), new Prisma.Decimal(0))
              .toFixed(2)
          : null,
      };
    }),
  };
}
