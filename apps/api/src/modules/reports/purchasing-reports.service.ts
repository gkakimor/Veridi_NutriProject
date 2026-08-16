import { Prisma } from "@prisma/client";
import type {
  LatePurchaseOrderRowDTO,
  OnOrderRowDTO,
  PurchaseOrderReportRowDTO,
  ReceiptReportRowDTO,
  ReportPageDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta, slicePage } from "../../lib/pagination.js";
import type { OnOrderQuery, PurchaseOrdersQuery, ReceiptsQuery } from "./reports.schemas.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Status em que a OC ainda tem saldo a receber. */
const OPEN_STATUSES = ["ORDERED", "PARTIALLY_RECEIVED"] as const;

/**
 * R-08 — Ordens de Compra. Periodo por `orderDate` (a data comercial do
 * documento). O valor previsto so existe quando TODAS as linhas tem preco —
 * uma soma parcial nunca e apresentada como total da OC.
 */
export async function getPurchaseOrdersReport(
  query: PurchaseOrdersQuery,
  pagination: Pagination = query,
): Promise<ReportPageDTO<PurchaseOrderReportRowDTO>> {
  const prisma = getPrisma();

  const where: Prisma.PurchaseOrderWhereInput = {
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.origin ? { origin: query.origin } : {}),
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
            { supplierName: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: {
        lines: true,
        customerOrder: { select: { id: true, code: true } },
        _count: { select: { receipts: true } },
      },
      orderBy: [{ orderDate: "desc" }, { code: "desc" }],
      ...pageArgs(pagination),
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  const rows = orders.map((order): PurchaseOrderReportRowDTO => {
    const linesWithPrice = order.lines.filter((line) => line.unitPrice !== null).length;
    const complete = order.lines.length > 0 && linesWithPrice === order.lines.length;
    const expectedAmount = complete
      ? order.lines
          .reduce((sum, line) => sum.plus(line.orderedQuantity.times(line.unitPrice!)), new Prisma.Decimal(0))
          .toFixed(2)
      : null;

    return {
      purchaseOrderId: order.id,
      code: order.code,
      supplierId: order.supplierId,
      supplierName: order.supplierName,
      origin: order.origin,
      customerOrderId: order.customerOrderId,
      customerOrderCode: order.customerOrder ? order.customerOrder.code : null,
      status: order.status,
      orderDate: order.orderDate.toISOString(),
      expectedDeliveryDate: order.expectedDeliveryDate ? order.expectedDeliveryDate.toISOString() : null,
      itemCount: order.lines.length,
      expectedAmount,
      linesWithPrice,
      receiptCount: order._count.receipts,
    };
  });

  return { rows, ...pageMeta(pagination, total) };
}

/**
 * R-09 — Recebimentos, na granularidade de `ReceiptLine` (um recebimento
 * com varias linhas repete o codigo REC, o que e correto aqui). Preco da OC
 * e custo efetivo aparecem lado a lado, sem se confundirem: preco e
 * expectativa comercial, custo e a referencia real.
 */
export async function getReceiptsReport(
  query: ReceiptsQuery,
  pagination: Pagination = query,
): Promise<ReportPageDTO<ReceiptReportRowDTO>> {
  const prisma = getPrisma();

  const where: Prisma.ReceiptLineWhereInput = {
    ...(query.itemId ? { itemId: query.itemId } : {}),
    ...(query.purchaseOrderId ? { receipt: { is: { purchaseOrderId: query.purchaseOrderId } } } : {}),
    ...(query.supplierId || query.from || query.to
      ? {
          receipt: {
            is: {
              ...(query.supplierId ? { supplierId: query.supplierId } : {}),
              ...(query.purchaseOrderId ? { purchaseOrderId: query.purchaseOrderId } : {}),
              ...(query.from || query.to
                ? {
                    receivedAt: {
                      ...(query.from ? { gte: query.from } : {}),
                      ...(query.to ? { lte: query.to } : {}),
                    },
                  }
                : {}),
            },
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { receipt: { is: { code: { contains: query.search, mode: "insensitive" } } } },
            { item: { is: { code: { contains: query.search, mode: "insensitive" } } } },
            { item: { is: { name: { contains: query.search, mode: "insensitive" } } } },
            { supplierLot: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [lines, total] = await Promise.all([
    prisma.receiptLine.findMany({
      where,
      include: {
        item: true,
        lot: true,
        purchaseOrderLine: true,
        receipt: { include: { purchaseOrder: true, supplier: true } },
      },
      orderBy: [{ receipt: { receivedAt: "desc" } }, { createdAt: "asc" }],
      ...pageArgs(pagination),
    }),
    prisma.receiptLine.count({ where }),
  ]);

  const rows = lines.map((line): ReceiptReportRowDTO => ({
    receiptLineId: line.id,
    receiptId: line.receiptId,
    receiptCode: line.receipt.code,
    receivedAt: line.receipt.receivedAt.toISOString(),
    purchaseOrderId: line.receipt.purchaseOrderId,
    purchaseOrderCode: line.receipt.purchaseOrder.code,
    supplierId: line.receipt.supplierId,
    supplierName: line.receipt.supplier.legalName,
    itemId: line.itemId,
    itemCode: line.item.code,
    itemName: line.item.name,
    lotId: line.lotId,
    lotCode: line.lot ? line.lot.code : null,
    supplierLot: line.supplierLot,
    receivedQuantity: line.receivedQuantity.toString(),
    unitCode: line.unitCode,
    orderedUnitPrice: line.purchaseOrderLine.unitPrice ? line.purchaseOrderLine.unitPrice.toString() : null,
    actualUnitCost: line.actualUnitCost ? line.actualUnitCost.toString() : null,
    // Custo informado no recebimento e REAL; sem custo informado nao ha
    // referencia real para esta aquisicao.
    costQuality: line.actualUnitCost ? "REAL" : "NO_COST",
  }));

  return { rows, ...pageMeta(pagination, total) };
}

/** Linhas de OC abertas (ORDERED/PARTIALLY_RECEIVED com saldo > 0). */
async function getOpenPurchaseLines(query: OnOrderQuery) {
  const prisma = getPrisma();

  const lines = await prisma.purchaseOrderLine.findMany({
    where: {
      ...(query.itemId ? { itemId: query.itemId } : {}),
      purchaseOrder: {
        is: {
          status: { in: [...OPEN_STATUSES] },
          ...(query.supplierId ? { supplierId: query.supplierId } : {}),
          ...(query.search
            ? {
                OR: [
                  { code: { contains: query.search, mode: "insensitive" } },
                  { supplierName: { contains: query.search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
      },
    },
    include: {
      item: true,
      receiptLines: { select: { receivedQuantity: true } },
      purchaseOrder: { include: { customerOrder: { select: { id: true, code: true } } } },
    },
    orderBy: [{ purchaseOrder: { code: "asc" } }, { createdAt: "asc" }],
  });

  const rows: OnOrderRowDTO[] = [];
  for (const line of lines) {
    const received = line.receiptLines.reduce(
      (sum, receiptLine) => sum.plus(receiptLine.receivedQuantity),
      new Prisma.Decimal(0),
    );
    const open = line.orderedQuantity.minus(received);
    // Linha totalmente recebida nao esta mais "em compra".
    if (open.lessThanOrEqualTo(0)) continue;

    rows.push({
      purchaseOrderId: line.purchaseOrderId,
      purchaseOrderCode: line.purchaseOrder.code,
      purchaseOrderLineId: line.id,
      supplierId: line.purchaseOrder.supplierId,
      supplierName: line.purchaseOrder.supplierName,
      itemId: line.itemId,
      itemCode: line.itemCode,
      itemName: line.itemName,
      orderedQuantity: line.orderedQuantity.toString(),
      receivedQuantity: received.toString(),
      openQuantity: open.toString(),
      unitCode: line.unitCode,
      expectedDeliveryDate: line.purchaseOrder.expectedDeliveryDate
        ? line.purchaseOrder.expectedDeliveryDate.toISOString()
        : null,
      status: line.purchaseOrder.status,
      customerOrderId: line.purchaseOrder.customerOrderId,
      customerOrderCode: line.purchaseOrder.customerOrder ? line.purchaseOrder.customerOrder.code : null,
    });
  }
  return rows;
}

/** R-10 — Em Compra. Fotografia atual; DRAFT nunca conta como compra em curso. */
export async function getOnOrderReport(
  query: OnOrderQuery,
  pagination: Pagination = query,
): Promise<ReportPageDTO<OnOrderRowDTO>> {
  const rows = await getOpenPurchaseLines(query);
  return { rows: slicePage(rows, pagination), ...pageMeta(pagination, rows.length) };
}

/**
 * R-11 — OCs atrasadas. Criterio oficial: ORDERED/PARTIALLY_RECEIVED +
 * previsao vencida + saldo em aberto. Mais atrasada primeiro.
 */
export async function getLatePurchaseOrdersReport(
  query: OnOrderQuery,
  pagination: Pagination = query,
): Promise<ReportPageDTO<LatePurchaseOrderRowDTO>> {
  const now = new Date();
  const open = await getOpenPurchaseLines(query);

  const rows = open
    .filter((row) => row.expectedDeliveryDate !== null && new Date(row.expectedDeliveryDate) < now)
    .map((row) => ({
      ...row,
      daysLate: Math.floor((now.getTime() - new Date(row.expectedDeliveryDate!).getTime()) / DAY_MS),
    }))
    .sort((a, b) => b.daysLate - a.daysLate);

  return { rows: slicePage(rows, pagination), ...pageMeta(pagination, rows.length) };
}
