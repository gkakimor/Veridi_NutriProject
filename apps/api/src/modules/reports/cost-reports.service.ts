import type { Prisma as PrismaTypes } from "@prisma/client";
import type {
  IndustrialCostByProductRowDTO,
  PricingByProductRowDTO,
  QuotePricingAuditRowDTO,
  ReportPageDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta, slicePage } from "../../lib/pagination.js";
import { latestCalculationsByProduct } from "../industrial-cost-calculation/snapshot.service.js";
import type {
  IndustrialCostByProductQuery,
  PricingByProductQuery,
  QuotePricingAuditQuery,
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

/**
 * R-20 — Orçamento × Precificação.
 *
 * Mostra a cadeia ORC → PREC → faixa → CALC de cada proposta e deixa
 * explícito o que foi preço de exceção. Proposta enviada lê o snapshot
 * congelado; rascunho lê o vínculo vivo — nada é recalculado.
 */
export async function getQuotePricingAuditReport(
  query: QuotePricingAuditQuery,
  pagination: Pagination = query,
): Promise<ReportPageDTO<QuotePricingAuditRowDTO>> {
  const prisma = getPrisma();

  const where: PrismaTypes.QuoteLineWhereInput = {
    ...(query.status ? { quoteVersion: { status: query.status } } : {}),
    ...(query.priceSource ? { priceSource: query.priceSource } : {}),
    ...(query.customerId ? { quoteVersion: { project: { customerId: query.customerId } } } : {}),
    ...(query.from || query.to
      ? {
          quoteVersion: {
            quoteDate: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { quoteVersion: { code: { contains: query.search, mode: "insensitive" } } },
            { pricingCodeSnapshot: { contains: query.search, mode: "insensitive" } },
            { costCalculationCodeSnapshot: { contains: query.search, mode: "insensitive" } },
            { productCodeSnapshot: { contains: query.search, mode: "insensitive" } },
            { product: { code: { contains: query.search, mode: "insensitive" } } },
            {
              quoteVersion: {
                project: { code: { contains: query.search, mode: "insensitive" } },
              },
            },
            {
              quoteVersion: {
                project: { name: { contains: query.search, mode: "insensitive" } },
              },
            },
          ],
        }
      : {}),
  };

  // R-20 é auditoria de PREÇO, e preço vive na linha: numa proposta com três
  // produtos, cada um tem a própria faixa, o próprio cálculo e a própria
  // margem. Uma linha do relatório por linha de orçamento.
  const [rows, total] = await Promise.all([
    prisma.quoteLine.findMany({
      where,
      include: {
        quoteVersion: { include: { project: { include: { customer: true } } } },
        product: true,
        pricingVersion: true,
        pricingTier: true,
      },
      orderBy: [{ quoteVersion: { quoteDate: "desc" } }, { sortOrder: "asc" }],
      ...pageArgs(pagination),
    }),
    prisma.quoteLine.count({ where }),
  ]);

  const mapped = rows.map((line): QuotePricingAuditRowDTO => {
    const quote = line.quoteVersion;
    // Enviada usa o snapshot; rascunho usa o vínculo vivo (a precificação
    // ativa já é imutável, então os dois são estáveis).
    const frozen = line.pricingCodeSnapshot !== null;
    const pricingLabel = frozen
      ? `${line.pricingCodeSnapshot} · V${line.pricingVersionNumberSnapshot ?? ""}`
      : line.pricingVersion
        ? `${line.pricingVersion.code} · V${line.pricingVersion.versionNumber}`
        : null;
    const tierQuantity = frozen
      ? (line.pricingTierQuantitySnapshot?.toString() ?? null)
      : (line.pricingTier?.quantity.toString() ?? null);
    const costPerUnit = frozen
      ? line.industrialCostPerUnitSnapshot
      : (line.pricingTier?.costPerUnitSnapshot ?? null);
    const contribution = frozen
      ? line.contributionMarginSnapshot
      : (line.pricingTier?.contributionMarginSnapshot ?? null);

    return {
      quoteVersionId: quote.id,
      quoteLabel: `${quote.code} · V${quote.versionNumber}`,
      projectId: quote.projectId,
      projectCode: quote.project.code,
      projectName: quote.project.name,
      customerName: quote.project.customer?.legalName ?? null,
      productCode: line.productCodeSnapshot ?? line.product.code,
      status: quote.status,
      quotedQuantity: line.quotedQuantity ? line.quotedQuantity.toString() : null,
      uomCode: line.uomCode,
      unitPrice: line.unitPrice !== null ? line.unitPrice.toFixed(4) : null,
      total:
        line.quotedQuantity && line.unitPrice !== null
          ? line.quotedQuantity.times(line.unitPrice).toFixed(2)
          : null,
      priceSource: line.priceSource,
      pricingLabel,
      tierQuantity,
      calculationCode: frozen
        ? line.costCalculationCodeSnapshot
        : (line.pricingVersion?.calculationCodeSnapshot ?? null),
      costQuality: frozen
        ? line.costQualitySnapshot
        : (line.pricingTier?.costQualitySnapshot ?? null),
      industrialCostPerUnit: costPerUnit ? costPerUnit.toFixed(6) : null,
      contributionMarginPercent: contribution ? contribution.toFixed(4) : null,
      sentAt: quote.sentAt ? quote.sentAt.toISOString() : null,
      acceptedAt: quote.acceptedAt ? quote.acceptedAt.toISOString() : null,
    };
  });

  return { rows: mapped, ...pageMeta(pagination, total) };
}
