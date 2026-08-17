-- Projeto multiproduto e orçamento multilinha.
--
-- Um projeto é uma negociação, e negociação real cobre vários produtos: a
-- mesma linha em três sabores nasce de um briefing só e vira uma proposta só.
-- Até aqui o modelo assumia 1 projeto = 1 produto = 1 preço.
--
-- A migração é incremental de propósito: `projects.product_id` continua onde
-- está (vínculo principal/legado) e a associação verdadeira passa a viver em
-- `project_products`, com backfill de tudo que já existe. Nada é apagado
-- antes de ser copiado.

-- CreateEnum
CREATE TYPE "ProjectProductStatus" AS ENUM ('ACTIVE', 'APPROVED', 'OUT_OF_SCOPE');

-- CreateTable
CREATE TABLE "project_products" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "ProjectProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "createdByNameSnapshot" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_products_projectId_productId_key" ON "project_products"("projectId", "productId");
CREATE INDEX "project_products_projectId_idx" ON "project_products"("projectId");
CREATE INDEX "project_products_productId_idx" ON "project_products"("productId");

ALTER TABLE "project_products" ADD CONSTRAINT "project_products_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_products" ADD CONSTRAINT "project_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_products" ADD CONSTRAINT "project_products_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: todo projeto que já aponta para um produto ganha a associação
-- explícita. Projeto aprovado nasce com o produto APPROVED; os demais ACTIVE.
INSERT INTO "project_products" ("id", "projectId", "productId", "sequence", "status", "createdAt", "updatedAt")
SELECT
    gen_random_uuid(),
    p."id",
    p."productId",
    1,
    CASE WHEN p."status" = 'APPROVED' THEN 'APPROVED'::"ProjectProductStatus" ELSE 'ACTIVE'::"ProjectProductStatus" END,
    p."createdAt",
    NOW()
FROM "projects" p
WHERE p."productId" IS NOT NULL;

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" TEXT NOT NULL,
    "quoteVersionId" TEXT NOT NULL,
    "projectProductId" TEXT,
    "productId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "quotedQuantity" DECIMAL(18,6),
    "uomCode" TEXT,
    "unitPrice" DECIMAL(14,4),
    "priceSource" "QuotePriceSource" NOT NULL DEFAULT 'MANUAL',
    "pricingVersionId" TEXT,
    "pricingTierId" TEXT,
    "productCodeSnapshot" TEXT,
    "productNameSnapshot" TEXT,
    "pricingCodeSnapshot" TEXT,
    "pricingVersionNumberSnapshot" INTEGER,
    "pricingTierQuantitySnapshot" DECIMAL(18,6),
    "pricingTierUomSnapshot" TEXT,
    "pricingSelectedUnitPriceSnapshot" DECIMAL(14,6),
    "costCalculationCodeSnapshot" TEXT,
    "costReferenceDateSnapshot" TIMESTAMP(3),
    "costStructureLabelSnapshot" TEXT,
    "formulationVersionNumberSnapshot" INTEGER,
    "industrialCostPerUnitSnapshot" DECIMAL(18,6),
    "costQualitySnapshot" "IndustrialCostQuality",
    "commissionPercentSnapshot" DECIMAL(7,4),
    "contributionPerUnitSnapshot" DECIMAL(14,6),
    "contributionMarginSnapshot" DECIMAL(7,4),
    "markupSnapshot" DECIMAL(12,4),
    "pricingWarningsSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quote_lines_quoteVersionId_productId_key" ON "quote_lines"("quoteVersionId", "productId");
CREATE INDEX "quote_lines_quoteVersionId_idx" ON "quote_lines"("quoteVersionId");
CREATE INDEX "quote_lines_productId_idx" ON "quote_lines"("productId");

ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quoteVersionId_fkey" FOREIGN KEY ("quoteVersionId") REFERENCES "quote_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_projectProductId_fkey" FOREIGN KEY ("projectProductId") REFERENCES "project_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_uomCode_fkey" FOREIGN KEY ("uomCode") REFERENCES "units_of_measure"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_pricingVersionId_fkey" FOREIGN KEY ("pricingVersionId") REFERENCES "pricing_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_pricingTierId_fkey" FOREIGN KEY ("pricingTierId") REFERENCES "pricing_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: cada orçamento existente vira uma linha, com a economia inteira
-- copiada — quantidade, preço, proveniência de precificação e todos os
-- snapshots congelados no envio. Proposta enviada é história: não pode mudar
-- de valor por causa desta migração.
--
-- Só entram orçamentos cujo projeto tem produto. Orçamento de projeto sem
-- produto (legado) ficaria sem `productId`, que é obrigatório na linha — e
-- inventar um produto para ele seria pior: ver `quote_versions` sem linha
-- como o que é, um orçamento legado sem produto identificado.
INSERT INTO "quote_lines" (
    "id", "quoteVersionId", "projectProductId", "productId", "sortOrder",
    "quotedQuantity", "uomCode", "unitPrice", "priceSource",
    "pricingVersionId", "pricingTierId",
    "productCodeSnapshot", "productNameSnapshot",
    "pricingCodeSnapshot", "pricingVersionNumberSnapshot",
    "pricingTierQuantitySnapshot", "pricingTierUomSnapshot", "pricingSelectedUnitPriceSnapshot",
    "costCalculationCodeSnapshot", "costReferenceDateSnapshot", "costStructureLabelSnapshot",
    "formulationVersionNumberSnapshot", "industrialCostPerUnitSnapshot", "costQualitySnapshot",
    "commissionPercentSnapshot", "contributionPerUnitSnapshot", "contributionMarginSnapshot",
    "markupSnapshot", "pricingWarningsSnapshot",
    "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(), q."id", pp."id", pp."productId", 1,
    q."quotedQuantity", q."uomCode", q."unitPrice", q."priceSource",
    q."pricingVersionId", q."pricingTierId",
    prod."code", prod."name",
    q."pricingCodeSnapshot", q."pricingVersionNumberSnapshot",
    q."pricingTierQuantitySnapshot", q."pricingTierUomSnapshot", q."pricingSelectedUnitPriceSnapshot",
    q."costCalculationCodeSnapshot", q."costReferenceDateSnapshot", q."costStructureLabelSnapshot",
    q."formulationVersionNumberSnapshot", q."industrialCostPerUnitSnapshot", q."costQualitySnapshot",
    q."commissionPercentSnapshot", q."contributionPerUnitSnapshot", q."contributionMarginSnapshot",
    q."markupSnapshot", q."pricingWarningsSnapshot",
    q."createdAt", NOW()
FROM "quote_versions" q
JOIN "project_products" pp ON pp."projectId" = q."projectId"
JOIN "products" prod ON prod."id" = pp."productId";

-- Amostra passa a poder dizer qual produto testa.
ALTER TABLE "project_samples" ADD COLUMN "projectProductId" TEXT;
ALTER TABLE "project_samples" ADD CONSTRAINT "project_samples_projectProductId_fkey" FOREIGN KEY ("projectProductId") REFERENCES "project_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Amostra de projeto com um produto só não tem ambiguidade: associa. Projeto
-- com vários produtos não recebe associação automática — qual sabor a amostra
-- testava é informação que ninguém pode adivinhar depois.
UPDATE "project_samples" s
SET "projectProductId" = pp."id"
FROM "project_products" pp
WHERE pp."projectId" = s."projectId"
  AND (SELECT COUNT(*) FROM "project_products" x WHERE x."projectId" = s."projectId") = 1;

-- Fonte única de verdade: a economia agora vive na linha. As colunas do
-- cabeçalho saem depois de copiadas — manter as duas convidaria a divergir.
ALTER TABLE "quote_versions" DROP CONSTRAINT IF EXISTS "quote_versions_uomCode_fkey";
ALTER TABLE "quote_versions" DROP CONSTRAINT IF EXISTS "quote_versions_pricingVersionId_fkey";
ALTER TABLE "quote_versions" DROP CONSTRAINT IF EXISTS "quote_versions_pricingTierId_fkey";

ALTER TABLE "quote_versions"
    DROP COLUMN "quotedQuantity",
    DROP COLUMN "uomCode",
    DROP COLUMN "unitPrice",
    DROP COLUMN "priceSource",
    DROP COLUMN "pricingVersionId",
    DROP COLUMN "pricingTierId",
    DROP COLUMN "pricingCodeSnapshot",
    DROP COLUMN "pricingVersionNumberSnapshot",
    DROP COLUMN "pricingTierQuantitySnapshot",
    DROP COLUMN "pricingTierUomSnapshot",
    DROP COLUMN "pricingSelectedUnitPriceSnapshot",
    DROP COLUMN "costCalculationCodeSnapshot",
    DROP COLUMN "costReferenceDateSnapshot",
    DROP COLUMN "costStructureLabelSnapshot",
    DROP COLUMN "formulationVersionNumberSnapshot",
    DROP COLUMN "industrialCostPerUnitSnapshot",
    DROP COLUMN "costQualitySnapshot",
    DROP COLUMN "commissionPercentSnapshot",
    DROP COLUMN "contributionPerUnitSnapshot",
    DROP COLUMN "contributionMarginSnapshot",
    DROP COLUMN "markupSnapshot",
    DROP COLUMN "pricingWarningsSnapshot";
