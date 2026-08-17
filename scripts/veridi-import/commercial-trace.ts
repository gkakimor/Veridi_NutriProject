import { PrismaClient } from "@prisma/client";
import type { FindingSink } from "../veridi-data/corpus.js";

/**
 * Rastreabilidade comercial do que já existe no banco (capacidade 47).
 *
 * SOMENTE LEITURA e sem inventar vínculo: descreve quantos projetos têm
 * produto técnico, quantos orçamentos nasceram de precificação estruturada e
 * quantos foram preço de exceção. Orçamento legado nunca ganha proveniência
 * retroativa — ele simplesmente não tinha precificação quando foi feito.
 */

export interface CommercialTraceSummary {
  projects: number;
  projectsWithProduct: number;
  projectsWithoutProduct: number;
  developmentProducts: number;
  quotes: number;
  quotesFromPricing: number;
  quotesManual: number;
  quotesWithPartialCost: number;
  legacyQuotesWithoutProvenance: number;
}

export async function analyzeCommercialTrace(
  prisma: PrismaClient,
  findings: FindingSink,
): Promise<CommercialTraceSummary> {
  const [projects, projectsWithProduct, developmentProducts] = await Promise.all([
    prisma.project.count(),
    prisma.project.count({ where: { productId: { not: null } } }),
    prisma.product.count({ where: { lifecycle: "DEVELOPMENT" } }),
  ]);

  const quotes = await prisma.quoteVersion.findMany({
    select: {
      code: true,
      versionNumber: true,
      status: true,
      source: true,
      priceSource: true,
      costQualitySnapshot: true,
      project: { select: { code: true, productId: true } },
    },
  });

  let quotesFromPricing = 0;
  let quotesManual = 0;
  let quotesWithPartialCost = 0;
  let legacyQuotesWithoutProvenance = 0;

  for (const quote of quotes) {
    const label = `${quote.code} · V${quote.versionNumber}`;
    if (quote.priceSource === "PRICING_TIER") {
      quotesFromPricing += 1;
      if (quote.costQualitySnapshot === "PARTIAL" || quote.costQualitySnapshot === "NO_COST") {
        quotesWithPartialCost += 1;
        findings.add(
          "QUOTE_PRICING_COST_PARTIAL",
          "Quote",
          label,
          "proposta enviada com custo industrial incompleto — confirmado explicitamente",
        );
      }
      continue;
    }

    quotesManual += 1;
    if (quote.source === "LEGACY_IMPORT") {
      legacyQuotesWithoutProvenance += 1;
      findings.add(
        "LEGACY_QUOTE_WITHOUT_PRICING_PROVENANCE",
        "Quote",
        label,
        "orcamento legado sem precificacao estruturada — vinculo retroativo nao e inventado",
      );
      continue;
    }

    findings.add(
      "QUOTE_MANUAL_PRICE_SOURCE",
      "Quote",
      label,
      "preco informado manualmente — excecao comercial legitima, sem cadeia PREC/CALC",
    );
  }

  const projectsWithoutProduct = projects - projectsWithProduct;
  if (projectsWithoutProduct > 0) {
    findings.add(
      "PROJECT_WITHOUT_TECHNICAL_PRODUCT",
      "Project",
      `${projectsWithoutProduct} projetos`,
      "sem produto tecnico preparado — custo e preco estruturados exigem produto",
    );
  }

  return {
    projects,
    projectsWithProduct,
    projectsWithoutProduct,
    developmentProducts,
    quotes: quotes.length,
    quotesFromPricing,
    quotesManual,
    quotesWithPartialCost,
    legacyQuotesWithoutProvenance,
  };
}
