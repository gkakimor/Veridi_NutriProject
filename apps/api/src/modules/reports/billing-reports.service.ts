import { Prisma } from "@prisma/client";
import type {
  AwaitingBillingReportRowDTO,
  BillingPeriodRowDTO,
  BillingPeriodSummaryDTO,
  ReportPageDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { periodoDeInstante } from "./report-period.js";
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
  pagination: Pagination = query,
): Promise<BillingPeriodReportDTO> {
  const prisma = getPrisma();
  const periodo = periodoDeInstante(query);

  const where: Prisma.BillingWhereInput = {
    status: "ISSUED",
    ...(query.customerOrderId ? { customerOrderId: query.customerOrderId } : {}),
    ...(query.customerId ? { customerOrder: { is: { customerId: query.customerId } } } : {}),
    ...(periodo ? { issuedAt: periodo } : {}),
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

  /*
   * Resumo cobre o FILTRO inteiro, não a página — senão o total mudaria
   * conforme a navegação. E sai do BANCO agregado (PERFORMANCE-CLEANUP-WAVE-01):
   * o resumo carregava todo documento do filtro com todas as linhas só para
   * contar e somar — 2.000 faturamentos de 3 linhas eram 8 mil registros a cada
   * página pedida.
   *
   * - quantos documentos: o `count` do filtro, o mesmo da paginação;
   * - quantos com preço completo: os que têm linha e nenhuma linha sem preço;
   * - o valor: `quantidade × preço` somado por preço distinto — só quando todos
   *   estão completos, que é quando o total existe. A soma das quantidades vem
   *   exata do PostgreSQL, e a multiplicação é a mesma `Decimal` de antes.
   */
  const completo: Prisma.BillingWhereInput = {
    AND: [where, { lines: { some: {} } }, { lines: { none: { unitPrice: null } } }],
  };
  const [billings, total, completeCount, quantityByPrice] = await Promise.all([
    prisma.billing.findMany({
      where,
      include: { lines: true, customerOrder: { select: { customerId: true } } },
      orderBy: [{ issuedAt: "desc" }, { code: "desc" }],
      ...pageArgs(pagination),
    }),
    prisma.billing.count({ where }),
    prisma.billing.count({ where: completo }),
    prisma.billingLine.groupBy({ by: ["unitPrice"], where: { billing: { is: where } }, _sum: { quantity: true } }),
  ]);

  function amountOf(lines: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal | null }[]) {
    const complete = lines.length > 0 && lines.every((line) => line.unitPrice !== null);
    if (!complete) return null;
    return lines.reduce((sum, line) => sum.plus(line.quantity.times(line.unitPrice!)), new Prisma.Decimal(0));
  }

  // Linha sem preço somada no meio do caminho (documento emitido entre as
  // consultas) também tira o total: nunca soma parcial apresentada como total.
  const allComplete =
    total > 0 && completeCount === total && quantityByPrice.every((group) => group.unitPrice !== null);
  const summaryTotal = quantityByPrice.reduce(
    (sum, group) =>
      group.unitPrice === null ? sum : sum.plus(group.unitPrice.times(group._sum.quantity ?? new Prisma.Decimal(0))),
    new Prisma.Decimal(0),
  );

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
    ...pageMeta(pagination, total),
    summary: {
      billingCount: total,
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
  pagination: Pagination = query,
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
      ...pageArgs(pagination),
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

  return { rows, ...pageMeta(pagination, total) };
}
