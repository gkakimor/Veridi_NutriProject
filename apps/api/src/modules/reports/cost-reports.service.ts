import type { Prisma as PrismaTypes } from "@prisma/client";
import type { IndustrialCostByProductRowDTO, ReportPageDTO } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { latestCalculationsByProduct } from "../industrial-cost-calculation/snapshot.service.js";
import type { IndustrialCostByProductQuery } from "./reports.schemas.js";

/**
 * R-18 — Custo industrial por produto.
 *
 * Gerencial e honesto: mostra o ÚLTIMO CÁLCULO SALVO de cada produto, nunca
 * recalcula centenas de produtos ao abrir a tela. Produto sem cálculo salvo
 * aparece com "—" — a ausência é informação, não um zero.
 */
export async function getIndustrialCostByProductReport(
  query: IndustrialCostByProductQuery,
  pagination: Pagination = query,
): Promise<ReportPageDTO<IndustrialCostByProductRowDTO>> {
  const prisma = getPrisma();

  const where: PrismaTypes.ProductWhereInput = {
    ...(query.active !== undefined ? { active: query.active } : { active: true }),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { name: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        customer: { select: { legalName: true } },
        industrialCostVersions: {
          where: { status: "ACTIVE" },
          select: { id: true, code: true, versionNumber: true },
        },
      },
      orderBy: [{ code: "asc" }],
      ...pageArgs(pagination),
    }),
    prisma.product.count({ where }),
  ]);

  const latest = await latestCalculationsByProduct(products.map((product) => product.id));

  const rows = products.map((product): IndustrialCostByProductRowDTO => {
    const active = product.industrialCostVersions[0];
    const calculation = latest.get(product.id) ?? null;
    return {
      productId: product.id,
      productCode: product.code,
      productName: product.name,
      customerName: product.customer?.legalName ?? null,
      activeCostVersionLabel: active ? `${active.code} · V${active.versionNumber}` : null,
      calculationId: calculation?.id ?? null,
      calculationCode: calculation?.code ?? null,
      costReferenceDate: calculation?.costReferenceDate ?? null,
      calculatedAt: calculation?.calculatedAt ?? null,
      quality: calculation?.quality ?? null,
      totalIndustrialCost: calculation?.totalIndustrialCost ?? null,
      knownSubtotal: calculation?.knownSubtotal ?? null,
      costPerUnit: calculation?.costPerUnit ?? null,
      costPer1000: calculation?.costPer1000 ?? null,
    };
  });

  return { rows, ...pageMeta(pagination, total) };
}
