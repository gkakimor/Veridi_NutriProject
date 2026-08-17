-- Capacidade 45 — cálculo do custo industrial.
--
-- Estrutura + recursos + referências de custo viram NÚMERO aqui. Duas
-- visões que nunca se misturam: custo padrão/prospectivo (o que custa
-- produzir a base de referência, por informações conhecidas numa data) e
-- custo da produção realizada (materiais realmente consumidos + custos
-- industriais PADRÃO aplicados).

CREATE TYPE "IndustrialMaterialCostSource" AS ENUM (
  'WEIGHTED_AVG_30D',
  'WEIGHTED_AVG_90D',
  'LAST_REAL',
  'SUPPLIER_OFFER_PREFERRED',
  'SUPPLIER_OFFER_SINGLE_APPROVED',
  'AMBIGUOUS_SUPPLIER_REFERENCE',
  'NO_COST',
  'EXCLUDED_CUSTOMER_SUPPLIED'
);

CREATE TYPE "IndustrialCostQuality" AS ENUM (
  'COMPLETE_REAL_REFERENCE',
  'COMPLETE_WITH_ESTIMATES',
  'PARTIAL',
  'NO_COST'
);

CREATE TYPE "RealizedCostStatus" AS ENUM ('PROVISIONAL', 'FINAL');

-- Identidade do documento de cálculo: CALC-000001.
CREATE SEQUENCE "industrial_cost_calculation_code_seq" START 1;

-- Estrutura de custos congelada na OP. NULL é situação legítima: produção
-- nunca depende de custo estruturado, e OPs antigas continuam válidas.
ALTER TABLE "production_orders"
  ADD COLUMN "industrialCostVersionId" TEXT;

ALTER TABLE "production_orders"
  ADD CONSTRAINT "production_orders_industrialCostVersionId_fkey"
  FOREIGN KEY ("industrialCostVersionId") REFERENCES "industrial_cost_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "production_orders_industrialCostVersionId_idx"
  ON "production_orders"("industrialCostVersionId");

CREATE TABLE "industrial_cost_calculations" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "industrialCostVersionId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,

  -- Data usada para resolver custo de material — nunca "hoje" implícito.
  "costReferenceDate" TIMESTAMP(3) NOT NULL,
  "structureStatusAtCalculation" "IndustrialCostVersionStatus" NOT NULL,
  "quality" "IndustrialCostQuality" NOT NULL,

  -- NULL quando algum componente necessário é desconhecido: total parcial
  -- não existe, existe subtotal conhecido.
  "directIndustrialCost" DECIMAL(14,4),
  "overheadCost" DECIMAL(14,4),
  "totalIndustrialCost" DECIMAL(14,4),
  "knownSubtotal" DECIMAL(14,4) NOT NULL,
  "costPerUnit" DECIMAL(18,6),
  "costPer1000" DECIMAL(14,4),

  "referenceOutputQuantity" DECIMAL(18,6) NOT NULL,
  "referenceOutputUomCode" TEXT NOT NULL,

  "productCodeSnapshot" TEXT NOT NULL,
  "productNameSnapshot" TEXT NOT NULL,
  "customerNameSnapshot" TEXT,
  "formulationVersionNumber" INTEGER NOT NULL,

  "result" JSONB NOT NULL,
  "notes" TEXT,

  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "calculatedByUserId" TEXT,
  "calculatedByNameSnapshot" TEXT,

  CONSTRAINT "industrial_cost_calculations_pkey" PRIMARY KEY ("id"),

  -- Subtotal conhecido nunca é negativo; totais desconhecidos ficam NULL.
  CONSTRAINT "industrial_cost_calculations_known_subtotal_check"
    CHECK ("knownSubtotal" >= 0),
  CONSTRAINT "industrial_cost_calculations_total_check"
    CHECK ("totalIndustrialCost" IS NULL OR "totalIndustrialCost" >= 0)
);

CREATE UNIQUE INDEX "industrial_cost_calculations_code_key"
  ON "industrial_cost_calculations"("code");
CREATE INDEX "industrial_cost_calculations_industrialCostVersionId_idx"
  ON "industrial_cost_calculations"("industrialCostVersionId");
CREATE INDEX "industrial_cost_calculations_productId_idx"
  ON "industrial_cost_calculations"("productId");
CREATE INDEX "industrial_cost_calculations_calculatedAt_idx"
  ON "industrial_cost_calculations"("calculatedAt");

ALTER TABLE "industrial_cost_calculations"
  ADD CONSTRAINT "industrial_cost_calculations_industrialCostVersionId_fkey"
  FOREIGN KEY ("industrialCostVersionId") REFERENCES "industrial_cost_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "industrial_cost_calculations"
  ADD CONSTRAINT "industrial_cost_calculations_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "industrial_cost_calculations"
  ADD CONSTRAINT "industrial_cost_calculations_calculatedByUserId_fkey"
  FOREIGN KEY ("calculatedByUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Custo industrial de uma produção CONCLUÍDA. Um snapshot por OP: concluir
-- de novo (retry) nunca duplica histórico.
CREATE TABLE "production_order_cost_snapshots" (
  "id" TEXT NOT NULL,
  "productionOrderId" TEXT NOT NULL,
  "industrialCostVersionId" TEXT,
  "formulationVersionNumber" INTEGER,

  "completedAt" TIMESTAMP(3) NOT NULL,
  "producedQuantity" DECIMAL(18,6) NOT NULL,
  "outputUnitCode" TEXT NOT NULL,

  "actualMaterialCostKnown" DECIMAL(14,4) NOT NULL,
  "standardAppliedCostKnown" DECIMAL(14,4) NOT NULL,
  "knownSubtotal" DECIMAL(14,4) NOT NULL,
  "totalIndustrialCost" DECIMAL(14,4),
  "costPerProducedUnit" DECIMAL(18,6),

  "quality" "IndustrialCostQuality" NOT NULL,
  "breakdown" JSONB NOT NULL,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "production_order_cost_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_order_cost_snapshots_known_subtotal_check"
    CHECK ("knownSubtotal" >= 0)
);

CREATE UNIQUE INDEX "production_order_cost_snapshots_productionOrderId_key"
  ON "production_order_cost_snapshots"("productionOrderId");
CREATE INDEX "production_order_cost_snapshots_industrialCostVersionId_idx"
  ON "production_order_cost_snapshots"("industrialCostVersionId");

ALTER TABLE "production_order_cost_snapshots"
  ADD CONSTRAINT "production_order_cost_snapshots_productionOrderId_fkey"
  FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "production_order_cost_snapshots"
  ADD CONSTRAINT "production_order_cost_snapshots_industrialCostVersionId_fkey"
  FOREIGN KEY ("industrialCostVersionId") REFERENCES "industrial_cost_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
