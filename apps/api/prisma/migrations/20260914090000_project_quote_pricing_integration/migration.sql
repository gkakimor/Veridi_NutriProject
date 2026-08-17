-- Capacidade 47 — Projeto → Orçamento → Custo/Preço.
--
-- Fecha o ciclo do private label. Antes, o Produto só nascia na aprovação
-- do Projeto, mas custo e preço exigem Produto: quem precisava cotar com
-- preço estruturado ficava preso num ciclo. Agora o Projeto pode preparar
-- um produto TÉCNICO (DEVELOPMENT) para engenharia e custeio, e só o
-- produto APROVADO entra em pedido, produção, expedição e faturamento.

CREATE TYPE "ProductLifecycle" AS ENUM ('DEVELOPMENT', 'APPROVED');
CREATE TYPE "QuotePriceSource" AS ENUM ('MANUAL', 'PRICING_TIER');

-- Backfill: todo produto existente é operacional. O default APPROVED
-- preserva o comportamento de quem já está em produção.
ALTER TABLE "products"
  ADD COLUMN "lifecycle" "ProductLifecycle" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "originProjectId" TEXT;

CREATE UNIQUE INDEX "products_originProjectId_key" ON "products"("originProjectId");
CREATE INDEX "products_lifecycle_idx" ON "products"("lifecycle");

ALTER TABLE "products"
  ADD CONSTRAINT "products_originProjectId_fkey"
  FOREIGN KEY ("originProjectId") REFERENCES "projects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Orçamento: origem do preço + vínculo com a faixa de precificação.
-- Backfill MANUAL — nenhum orçamento histórico ganha proveniência
-- econômica que ele nunca teve.
ALTER TABLE "quote_versions"
  ADD COLUMN "priceSource" "QuotePriceSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "pricingVersionId" TEXT,
  ADD COLUMN "pricingTierId" TEXT,
  ADD COLUMN "pricingCodeSnapshot" TEXT,
  ADD COLUMN "pricingVersionNumberSnapshot" INTEGER,
  ADD COLUMN "pricingTierQuantitySnapshot" DECIMAL(18,6),
  ADD COLUMN "pricingTierUomSnapshot" TEXT,
  ADD COLUMN "pricingSelectedUnitPriceSnapshot" DECIMAL(14,6),
  ADD COLUMN "costCalculationCodeSnapshot" TEXT,
  ADD COLUMN "costReferenceDateSnapshot" TIMESTAMP(3),
  ADD COLUMN "costStructureLabelSnapshot" TEXT,
  ADD COLUMN "formulationVersionNumberSnapshot" INTEGER,
  ADD COLUMN "industrialCostPerUnitSnapshot" DECIMAL(18,6),
  ADD COLUMN "costQualitySnapshot" "IndustrialCostQuality",
  ADD COLUMN "commissionPercentSnapshot" DECIMAL(7,4),
  ADD COLUMN "contributionPerUnitSnapshot" DECIMAL(14,6),
  ADD COLUMN "contributionMarginSnapshot" DECIMAL(7,4),
  ADD COLUMN "markupSnapshot" DECIMAL(12,4),
  ADD COLUMN "pricingWarningsSnapshot" JSONB;

CREATE INDEX "quote_versions_pricingVersionId_idx" ON "quote_versions"("pricingVersionId");
CREATE INDEX "quote_versions_pricingTierId_idx" ON "quote_versions"("pricingTierId");

ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_pricingVersionId_fkey"
  FOREIGN KEY ("pricingVersionId") REFERENCES "pricing_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_pricingTierId_fkey"
  FOREIGN KEY ("pricingTierId") REFERENCES "pricing_tiers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preço vindo de faixa exige a faixa: proveniência pela metade seria pior
-- que nenhuma, porque pareceria auditável.
ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_pricing_source_link_check"
  CHECK (
    ("priceSource" = 'MANUAL' AND "pricingVersionId" IS NULL AND "pricingTierId" IS NULL)
    OR ("priceSource" = 'PRICING_TIER' AND "pricingVersionId" IS NOT NULL AND "pricingTierId" IS NOT NULL)
  );
