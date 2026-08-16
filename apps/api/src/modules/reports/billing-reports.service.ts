import { Prisma } from "@prisma/client";
import type {
  AwaitingBillingReportRowDTO,
  BillingPeriodRowDTO,
  BillingPeriodSummaryDTO,
  ReportPageDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { AwaitingBillingQuery, BillingPeriodQuery } from "./reports.schemas.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BillingPeriodReportDTO extends ReportPageDTO<BillingPeriodRowDTO> {
  summary: BillingPeriodSummaryDTO;
}

/**
 * R-15 — Faturamento por periodo. So documentos ISSUED, sempre por
 * `issuedAt`. O valor de um documento so aparece com precificacao completa,
 * e o total do periodo so existe quando TODOS os documentos filtrados tem
 * preco completo — soma parcial nunca e apresentada como total.
 */
export async function getBillingPeriodReport(
  query: BillingPeriodQuery,
): Promise<BillingPeriodReportDTO> {
  const prisma = getPrisma();

  const where: Prisma.BillingWhereInput = {
    status: "ISSUED",
    ...(query.customerOrderId ? { customerOrderId: query.customerOrderId } : {}),
    ...(query.customerId ? { customerOrder: { is: { customerId: query.customerId } } } : {}),
    ...(query.from || query.to
      ? {
          issuedAt: {
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
            { customerOrderCode: { contains: query.search, mode: "insensitive" } },
            { shipmentCode: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [billings, total, allForSummary] = await Promise.all([
    prisma.billing.findMany({
      where,
      include: { lines: true, customerOrder: { select: { customerId: true } } },
      orderBy: [{ issuedAt: "desc" }, { code: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.billing.count({ where }),
    // Resumo cobre o FILTRO inteiro, não a página — senão o total mudaria
    // conforme a navegação.
    prisma.billing.findMany({ where, select: { lines: { select: { quantity: true, unitPrice: true } } } }),
  ]);

  function amountOf(lines: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal | null }[]) {
    const complete = lines.length > 0 && lines.every((line) => line.unitPrice !== null);
    if (!complete) return null;
    return lines.reduce((sum, line) => sum.plus(line.quantity.times(line.unitPrice!)), new Prisma.Decimal(0));
  }

  let completeCount = 0;
  let summaryTotal = new Prisma.Decimal(0);
  for (const billing of allForSummary) {
    const amount = amountOf(billing.lines);
    if (amount === null) continue;
    completeCount += 1;
    summaryTotal = summaryTotal.plus(amount);
  }
  const allComplete = allForSummary.length > 0 && completeCount === allForSummary.length;

  const rows = billings.map((billing): BillingPeriodRowDTO => {
    const amount = amountOf(billing.lines);
    return {
      billingId: billing.id,
      code: billing.code,
      issuedAt: billing.issuedAt!.toISOString(),
      customerOrderId: billing.customerOrderId,
      customerOrderCode: billing.customerOrderCode,
      shipmentId: billing.shipmentId,
      shipmentCode: billing.shipmentCode,
      customerId: billing.customerOrder.customerId,
      customerName: billing.customerName,
      lineCount: billing.lines.length,
      totalAmount: amount ? amount.toFixed(2) : null,
      hasCompletePricing: amount !== null,
      externalReference: billing.externalReference,
    };
  });

  return {
    rows,
    page: query.page,
    pageSize: query.pageSize,
    total,
    summary: {
      billingCount: allForSummary.length,
      billingsWithCompletePricing: completeCount,
      totalAmount: allComplete ? summaryTotal.toFixed(2) : null,
    },
  };
}

/**
 * R-16 — Aguardando faturamento. Expedicao CONFIRMED sem Faturamento
 * ISSUED, separando "nenhum documento" (PENDING) de "documento em
 * preparacao" (DRAFT). Mais antiga primeiro — e a que mais atrasa o caixa.
 */
export async function getAwaitingBillingReport(
  query: AwaitingBillingQuery,
): Promise<ReportPageDTO<AwaitingBillingReportRowDTO>> {
  const prisma = getPrisma();
  const now = new Date();

  const where: Prisma.ShipmentWhereInput = {
    status: "CONFIRMED",
    billings: { none: { status: "ISSUED" } },
    ...(query.customerId ? { customerOrder: { is: { customerId: query.customerId } } } : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { customerOrder: { is: { code: { contains: query.search, mode: "insensitive" } } } },
            { customerOrder: { is: { customerName: { contains: query.search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [shipments, total] = await Promise.all([
    prisma.shipment.findMany({
      where,
      include: {
        customerOrder: { include: { customer: true } },
        lines: { select: { productCode: true, product: { select: { code: true } } } },
        billings: { where: { status: "DRAFT" }, select: { id: true, code: true } },
      },
      orderBy: [{ confirmedAt: "asc" }, { code: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.shipment.count({ where }),
  ]);

  const rows = shipments.map((shipment): AwaitingBillingReportRowDTO => {
    const draft = shipment.billings[0];
    return {
      shipmentId: shipment.id,
      shipmentCode: shipment.code,
      confirmedAt: shipment.confirmedAt ? shipment.confirmedAt.toISOString() : null,
      customerOrderId: shipment.customerOrderId,
      customerOrderCode: shipment.customerOrder.code,
      customerId: shipment.customerOrder.customerId,
      customerName: shipment.customerOrder.customerName ?? shipment.customerOrder.customer.legalName,
      lineCount: shipment.lines.length,
      productCodes: [...new Set(shipment.lines.map((line) => line.productCode ?? line.product.code))],
      situation: draft ? "DRAFT" : "PENDING",
      billingId: draft ? draft.id : null,
      billingCode: draft ? draft.code : null,
      daysWaiting: shipment.confirmedAt
        ? Math.floor((now.getTime() - shipment.confirmedAt.getTime()) / DAY_MS)
        : 0,
    };
  });

  return { rows, page: query.page, pageSize: query.pageSize, total };
}
