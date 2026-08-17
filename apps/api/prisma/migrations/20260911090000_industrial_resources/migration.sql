-- Capacidade 44 — recursos industriais (mão de obra, equipamento, energia).
--
-- Separa RECURSO (o que custa, com tarifa histórica) de USO DO RECURSO (o
-- quanto a estrutura de um produto planeja consumir). O cálculo do custo
-- industrial consolidado continua fora: aqui é configuração econômica.

CREATE TYPE "IndustrialResourceType" AS ENUM ('LABOR', 'EQUIPMENT', 'ENERGY');

-- Unidades das tarifas/usos industriais. Enum próprio, e não o registro de
-- UOM físico: hora e kWh não são unidades de ITEM, e colocá-las lá
-- permitiria cadastrar matéria-prima medida em kWh.
CREATE TYPE "IndustrialRateUom" AS ENUM ('HOUR', 'KWH');

CREATE TYPE "IndustrialResourceRateSource" AS ENUM ('MANUAL', 'LEGACY_IMPORT');

CREATE TYPE "IndustrialResourceUsageBasis" AS ENUM (
  'FIXED_PER_REFERENCE_BATCH', 'PER_OUTPUT_UNIT', 'PER_1000_OUTPUT_UNITS'
);

-- DIRECT e FROM_EQUIPMENT são exclusivos: somar consumo direto com o
-- derivado dos equipamentos contaria a mesma energia duas vezes.
CREATE TYPE "EnergyCalculationMode" AS ENUM ('NONE', 'DIRECT', 'FROM_EQUIPMENT');

CREATE SEQUENCE industrial_resource_code_seq START 1;

CREATE TABLE "industrial_resources" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "IndustrialResourceType" NOT NULL,
  "description" TEXT,
  "defaultUsageUom" "IndustrialRateUom" NOT NULL,
  "powerKw" DECIMAL(12,4),
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "createdByNameSnapshot" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedByUserId" TEXT,
  "updatedByNameSnapshot" TEXT,
  CONSTRAINT "industrial_resources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "industrial_resources_code_key" ON "industrial_resources"("code");
CREATE INDEX "industrial_resources_type_idx" ON "industrial_resources"("type");
CREATE INDEX "industrial_resources_active_idx" ON "industrial_resources"("active");

-- Potência é só de equipamento; `null` continua significando desconhecida.
ALTER TABLE "industrial_resources"
  ADD CONSTRAINT "industrial_resources_power_check"
  CHECK ("powerKw" IS NULL OR ("type" = 'EQUIPMENT' AND "powerKw" > 0));

-- A unidade de consumo acompanha o tipo: operador não se mede em kWh.
ALTER TABLE "industrial_resources"
  ADD CONSTRAINT "industrial_resources_usage_uom_check"
  CHECK (
    ("type" = 'ENERGY' AND "defaultUsageUom" = 'KWH')
    OR ("type" <> 'ENERGY' AND "defaultUsageUom" = 'HOUR')
  );

ALTER TABLE "industrial_resources"
  ADD CONSTRAINT "industrial_resources_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "industrial_resources"
  ADD CONSTRAINT "industrial_resources_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "industrial_resource_rates" (
  "id" TEXT NOT NULL,
  "industrialResourceId" TEXT NOT NULL,
  "rateValue" DECIMAL(14,4) NOT NULL,
  "currencyCode" VARCHAR(3) NOT NULL,
  "rateUom" "IndustrialRateUom" NOT NULL,
  "effectiveAt" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),
  "source" "IndustrialResourceRateSource" NOT NULL DEFAULT 'MANUAL',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "createdByNameSnapshot" TEXT,
  CONSTRAINT "industrial_resource_rates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "industrial_resource_rates_industrialResourceId_idx"
  ON "industrial_resource_rates"("industrialResourceId");
CREATE INDEX "industrial_resource_rates_effectiveAt_idx"
  ON "industrial_resource_rates"("effectiveAt");

-- Zero é uma tarifa explícita; negativo não existe.
ALTER TABLE "industrial_resource_rates"
  ADD CONSTRAINT "industrial_resource_rates_value_check" CHECK ("rateValue" >= 0);
ALTER TABLE "industrial_resource_rates"
  ADD CONSTRAINT "industrial_resource_rates_validity_check" CHECK (
    "effectiveAt" IS NULL OR "validUntil" IS NULL OR "validUntil" >= "effectiveAt"
  );

ALTER TABLE "industrial_resource_rates"
  ADD CONSTRAINT "industrial_resource_rates_industrialResourceId_fkey"
  FOREIGN KEY ("industrialResourceId") REFERENCES "industrial_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "industrial_resource_rates"
  ADD CONSTRAINT "industrial_resource_rates_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "industrial_cost_resource_usages" (
  "id" TEXT NOT NULL,
  "industrialCostVersionId" TEXT NOT NULL,
  "industrialResourceId" TEXT NOT NULL,
  "usageBasis" "IndustrialResourceUsageBasis" NOT NULL DEFAULT 'FIXED_PER_REFERENCE_BATCH',
  "usageQuantity" DECIMAL(18,6) NOT NULL,
  "usageUom" "IndustrialRateUom" NOT NULL,
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "resourceNameSnapshot" TEXT,
  "resourceTypeSnapshot" "IndustrialResourceType",
  "rateIdSnapshot" TEXT,
  "rateValueSnapshot" DECIMAL(14,4),
  "rateCurrencySnapshot" VARCHAR(3),
  "rateUomSnapshot" "IndustrialRateUom",
  "rateEffectiveAtSnapshot" TIMESTAMP(3),
  "powerKwSnapshot" DECIMAL(12,4),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "industrial_cost_resource_usages_pkey" PRIMARY KEY ("id")
);

-- Uma linha por recurso na versão: sem roteiro nesta fase, o mesmo
-- equipamento usado em duas etapas soma o tempo planejado.
CREATE UNIQUE INDEX "industrial_cost_resource_usages_version_resource_key"
  ON "industrial_cost_resource_usages"("industrialCostVersionId", "industrialResourceId");
CREATE INDEX "industrial_cost_resource_usages_versionId_idx"
  ON "industrial_cost_resource_usages"("industrialCostVersionId");
CREATE INDEX "industrial_cost_resource_usages_resourceId_idx"
  ON "industrial_cost_resource_usages"("industrialResourceId");

-- Recurso que não é usado não vira linha de zero hora.
ALTER TABLE "industrial_cost_resource_usages"
  ADD CONSTRAINT "industrial_cost_resource_usages_quantity_check" CHECK ("usageQuantity" > 0);

ALTER TABLE "industrial_cost_resource_usages"
  ADD CONSTRAINT "industrial_cost_resource_usages_versionId_fkey"
  FOREIGN KEY ("industrialCostVersionId") REFERENCES "industrial_cost_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "industrial_cost_resource_usages"
  ADD CONSTRAINT "industrial_cost_resource_usages_resourceId_fkey"
  FOREIGN KEY ("industrialResourceId") REFERENCES "industrial_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Energia da estrutura: `NONE` é "ainda não estruturada", nunca zero.
ALTER TABLE "industrial_cost_versions"
  ADD COLUMN "energyCalculationMode" "EnergyCalculationMode" NOT NULL DEFAULT 'NONE';
