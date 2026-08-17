-- Capacidade 46 — simulador de preço, margem e faixas de quantidade.
--
-- Uma precificação formal parte SEMPRE de um cálculo de custo salvo
-- (CALC-…): é ele que congela estrutura, formulação, referências de
-- material, tarifas e data de referência. Todas as faixas de uma versão
-- compartilham a mesma base econômica — negociar 300 e 1000 unidades em
-- realidades econômicas diferentes seria comparar coisas incomparáveis.

CREATE TYPE "PriceMode" AS ENUM ('TARGET_MARGIN', 'MANUAL_PRICE');
CREATE TYPE "PricingVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- Identidade do documento: PREC-000001.
CREATE SEQUENCE "pricing_version_code_seq" START 1;

CREATE TABLE "pricing_versions" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "status" "PricingVersionStatus" NOT NULL DEFAULT 'DRAFT',

  "industrialCostCalculationId" TEXT NOT NULL,

  -- Conveniência histórica; o CALC continua sendo a referência oficial.
  "calculationCodeSnapshot" TEXT NOT NULL,
  "industrialCostVersionLabelSnapshot" TEXT NOT NULL,
  "formulationVersionNumberSnapshot" INTEGER NOT NULL,
  "costReferenceDateSnapshot" TIMESTAMP(3) NOT NULL,
  "costQualitySnapshot" "IndustrialCostQuality" NOT NULL,

  "notes" TEXT,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "createdByNameSnapshot" TEXT,

  "activatedAt" TIMESTAMP(3),
  "activatedByUserId" TEXT,
  "activatedByNameSnapshot" TEXT,

  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "pricing_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pricing_versions_code_key" ON "pricing_versions"("code");
CREATE UNIQUE INDEX "pricing_versions_productId_versionNumber_key"
  ON "pricing_versions"("productId", "versionNumber");
CREATE INDEX "pricing_versions_productId_idx" ON "pricing_versions"("productId");
CREATE INDEX "pricing_versions_status_idx" ON "pricing_versions"("status");
CREATE INDEX "pricing_versions_industrialCostCalculationId_idx"
  ON "pricing_versions"("industrialCostCalculationId");

-- No máximo um rascunho e uma versão ativa por produto — a mesma garantia
-- da estrutura de custos, aplicada no banco e não só no serviço.
CREATE UNIQUE INDEX "pricing_versions_one_draft_per_product"
  ON "pricing_versions"("productId") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "pricing_versions_one_active_per_product"
  ON "pricing_versions"("productId") WHERE "status" = 'ACTIVE';

ALTER TABLE "pricing_versions"
  ADD CONSTRAINT "pricing_versions_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pricing_versions"
  ADD CONSTRAINT "pricing_versions_industrialCostCalculationId_fkey"
  FOREIGN KEY ("industrialCostCalculationId") REFERENCES "industrial_cost_calculations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pricing_versions"
  ADD CONSTRAINT "pricing_versions_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pricing_versions"
  ADD CONSTRAINT "pricing_versions_activatedByUserId_fkey"
  FOREIGN KEY ("activatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cada faixa é uma QUANTIDADE-BASE explícita, não um intervalo: guardar
-- "300–499" daria falsa precisão comercial.
CREATE TABLE "pricing_tiers" (
  "id" TEXT NOT NULL,
  "pricingVersionId" TEXT NOT NULL,

  "quantity" DECIMAL(18,6) NOT NULL,
  "uomCode" TEXT NOT NULL,

  "priceMode" "PriceMode" NOT NULL DEFAULT 'TARGET_MARGIN',
  "targetContributionMarginPercent" DECIMAL(7,4),
  "commissionPercent" DECIMAL(7,4) NOT NULL DEFAULT 0,
  "manualUnitPrice" DECIMAL(14,6),

  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,

  "costTotalSnapshot" DECIMAL(14,4),
  "costPerUnitSnapshot" DECIMAL(18,6),
  "costPer1000Snapshot" DECIMAL(14,4),
  "knownSubtotalSnapshot" DECIMAL(14,4),
  "costQualitySnapshot" "IndustrialCostQuality",
  "batchCountSnapshot" INTEGER,
  "targetMarginSnapshot" DECIMAL(7,4),
  "commissionPercentSnapshot" DECIMAL(7,4),
  "suggestedPriceSnapshot" DECIMAL(14,6),
  "selectedPriceSnapshot" DECIMAL(14,6),
  "commissionPerUnitSnapshot" DECIMAL(14,6),
  "commissionTotalSnapshot" DECIMAL(14,4),
  "grossRevenueSnapshot" DECIMAL(14,4),
  "contributionPerUnitSnapshot" DECIMAL(14,6),
  "contributionTotalSnapshot" DECIMAL(14,4),
  "contributionMarginSnapshot" DECIMAL(7,4),
  "markupSnapshot" DECIMAL(12,4),
  "warningsSnapshot" JSONB,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "pricing_tiers_pkey" PRIMARY KEY ("id"),

  -- Quantidade é sempre positiva; percentuais nunca negativos, e margem +
  -- comissão abaixo de 100% (senão o preço é matematicamente impossível).
  CONSTRAINT "pricing_tiers_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "pricing_tiers_commission_range"
    CHECK ("commissionPercent" >= 0 AND "commissionPercent" < 100),
  CONSTRAINT "pricing_tiers_target_margin_range"
    CHECK (
      "targetContributionMarginPercent" IS NULL
      OR ("targetContributionMarginPercent" >= 0 AND "targetContributionMarginPercent" < 100)
    ),
  CONSTRAINT "pricing_tiers_margin_plus_commission"
    CHECK (
      "targetContributionMarginPercent" IS NULL
      OR ("targetContributionMarginPercent" + "commissionPercent") < 100
    ),
  -- Preço informado pode ser zero explícito, nunca negativo.
  CONSTRAINT "pricing_tiers_manual_price_non_negative"
    CHECK ("manualUnitPrice" IS NULL OR "manualUnitPrice" >= 0)
);

CREATE UNIQUE INDEX "pricing_tiers_pricingVersionId_quantity_key"
  ON "pricing_tiers"("pricingVersionId", "quantity");
CREATE INDEX "pricing_tiers_pricingVersionId_idx" ON "pricing_tiers"("pricingVersionId");

ALTER TABLE "pricing_tiers"
  ADD CONSTRAINT "pricing_tiers_pricingVersionId_fkey"
  FOREIGN KEY ("pricingVersionId") REFERENCES "pricing_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pricing_tiers"
  ADD CONSTRAINT "pricing_tiers_uomCode_fkey"
  FOREIGN KEY ("uomCode") REFERENCES "units_of_measure"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;
