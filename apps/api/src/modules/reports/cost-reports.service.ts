import type { Prisma as PrismaTypes } from "@prisma/client";
import type {
  IndustrialCostByProductRowDTO,
  PricingByProductRowDTO,
  ReportPageDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta, slicePage } from "../../lib/pagination.js";
import { latestCalculationsByProduct } from "../industrial-cost-calculation/snapshot.service.js";
import type {
  IndustrialCostByProductQuery,
  PricingByProductQuery,
} from "./reports.schemas.js";

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

/**
 * R-19 — Precificação por produto.
 *
 * Somente precificações ATIVAS, uma linha por faixa, lendo os snapshots
 * congelados na ativação. Nada é recalculado: o relatório mostra o preço que
 * a empresa pratica, não uma simulação de agora.
 */
export async function getPricingByProductReport(
  query: PricingByProductQuery,
  pagination: Pagination = query,
): Promise<ReportPageDTO<PricingByProductRowDTO>> {
  const prisma = getPrisma();

  const where: PrismaTypes.PricingVersionWhereInput = {
    status: "ACTIVE",
    ...(query.customerId ? { product: { customerId: query.customerId } } : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { calculationCodeSnapshot: { contains: query.search, mode: "insensitive" } },
            { product: { code: { contains: query.search, mode: "insensitive" } } },
            { product: { name: { contains: query.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const versions = await prisma.pricingVersion.findMany({
    where,
    include: {
      product: { include: { customer: { select: { legalName: true } } } },
      tiers: { orderBy: { quantity: "asc" } },
    },
    orderBy: [{ product: { code: "asc" } }],
  });

  const rows: PricingByProductRowDTO[] = versions.flatMap((version) =>
    version.tiers.map((tier) => ({
      pricingVersionId: version.id,
      pricingLabel: `${version.code} · V${version.versionNumber}`,
      productId: version.productId,
      productCode: version.product.code,
      productName: version.product.name,
      customerName: version.product.customer?.legalName ?? null,
      calculationCode: version.calculationCodeSnapshot,
      costReferenceDate: version.costReferenceDateSnapshot.toISOString(),
      costQuality: version.costQualitySnapshot,
      quantity: tier.quantity.toString(),
      uomCode: tier.uomCode,
      priceMode: tier.priceMode,
      costPerUnit: tier.costPerUnitSnapshot ? tier.costPerUnitSnapshot.toFixed(6) : null,
      commissionPercent: (tier.commissionPercentSnapshot ?? tier.commissionPercent).toFixed(4),
      unitPrice: tier.selectedPriceSnapshot ? tier.selectedPriceSnapshot.toFixed(6) : null,
      contributionMarginPercent: tier.contributionMarginSnapshot
        ? tier.contributionMarginSnapshot.toFixed(4)
        : null,
      markupPercent: tier.markupSnapshot ? tier.markupSnapshot.toFixed(4) : null,
      contributionPerUnit: tier.contributionPerUnitSnapshot
        ? tier.contributionPerUnitSnapshot.toFixed(6)
        : null,
      activatedAt: version.activatedAt ? version.activatedAt.toISOString() : null,
    })),
  );

  // Paginação em memória: a linha do relatório é a FAIXA, não a versão.
  return { rows: slicePage(rows, pagination), ...pageMeta(pagination, rows.length) };
}
