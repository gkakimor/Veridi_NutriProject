-- Capacidade 43 — estrutura de custos industriais (Bloco G).
--
-- ESTRUTURA, não cálculo: aqui ficam as premissas versionadas (qual
-- receita, qual base de produção, quais custos adicionais existem). O custo
-- industrial consolidado é calculado na capacidade 45 — nada aqui guarda
-- total nem CMV, e a Foundation of Costs atual continua intocada.

CREATE TYPE "IndustrialCostVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');
CREATE TYPE "IndustrialCostCategory" AS ENUM (
  'SECONDARY_PACKAGING', 'THIRD_PARTY_SERVICE', 'OVERHEAD', 'OTHER'
);
CREATE TYPE "IndustrialCostBasis" AS ENUM (
  'FIXED_PER_BATCH',
  'PER_OUTPUT_UNIT',
  'PER_1000_OUTPUT_UNITS',
  'PER_SHIPPING_BOX',
  'PERCENT_OF_DIRECT_INDUSTRIAL_COST'
);

CREATE SEQUENCE industrial_cost_code_seq START 1;

CREATE TABLE "industrial_cost_versions" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "status" "IndustrialCostVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "formulationVersionId" TEXT NOT NULL,
  "referenceOutputQuantity" DECIMAL(18,6) NOT NULL,
  "referenceOutputUomCode" TEXT NOT NULL,
  "notes" TEXT,
  "productCodeSnapshot" TEXT,
  "productNameSnapshot" TEXT,
  "customerCodeSnapshot" TEXT,
  "customerNameSnapshot" TEXT,
  "formulationVersionNumberSnapshot" INTEGER,
  "unitsPerShippingBoxSnapshot" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "createdByNameSnapshot" TEXT,
  "activatedAt" TIMESTAMP(3),
  "activatedByUserId" TEXT,
  "activatedByNameSnapshot" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "industrial_cost_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "industrial_cost_versions_code_key" ON "industrial_cost_versions"("code");
-- Vn é sequencial por produto: nunca duas versões com o mesmo número.
CREATE UNIQUE INDEX "industrial_cost_versions_productId_versionNumber_key"
  ON "industrial_cost_versions"("productId", "versionNumber");
CREATE INDEX "industrial_cost_versions_productId_idx" ON "industrial_cost_versions"("productId");
CREATE INDEX "industrial_cost_versions_status_idx" ON "industrial_cost_versions"("status");

-- Um único rascunho aberto por produto: "nova versão" nunca gera V3/V4 por
-- acidente, devolve o rascunho existente.
CREATE UNIQUE INDEX "industrial_cost_versions_one_draft_per_product"
  ON "industrial_cost_versions"("productId") WHERE "status" = 'DRAFT';
-- Uma única versão vigente por produto.
CREATE UNIQUE INDEX "industrial_cost_versions_one_active_per_product"
  ON "industrial_cost_versions"("productId") WHERE "status" = 'ACTIVE';

-- Base de produção precisa ser real: estrutura sobre zero não significa nada.
ALTER TABLE "industrial_cost_versions"
  ADD CONSTRAINT "industrial_cost_versions_reference_output_check"
  CHECK ("referenceOutputQuantity" > 0);

ALTER TABLE "industrial_cost_versions"
  ADD CONSTRAINT "industrial_cost_versions_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "industrial_cost_versions"
  ADD CONSTRAINT "industrial_cost_versions_formulationVersionId_fkey"
  FOREIGN KEY ("formulationVersionId") REFERENCES "formulation_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "industrial_cost_versions"
  ADD CONSTRAINT "industrial_cost_versions_referenceOutputUomCode_fkey"
  FOREIGN KEY ("referenceOutputUomCode") REFERENCES "units_of_measure"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "industrial_cost_versions"
  ADD CONSTRAINT "industrial_cost_versions_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "industrial_cost_versions"
  ADD CONSTRAINT "industrial_cost_versions_activatedByUserId_fkey"
  FOREIGN KEY ("activatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "industrial_cost_lines" (
  "id" TEXT NOT NULL,
  "industrialCostVersionId" TEXT NOT NULL,
  "category" "IndustrialCostCategory" NOT NULL,
  "description" TEXT NOT NULL,
  "calculationBasis" "IndustrialCostBasis" NOT NULL,
  "rateValue" DECIMAL(14,4),
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "industrial_cost_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "industrial_cost_lines_industrialCostVersionId_idx"
  ON "industrial_cost_lines"("industrialCostVersionId");

-- `rateValue` nulo = não informado. Informado nunca é negativo; zero é um
-- zero explícito e continua válido.
ALTER TABLE "industrial_cost_lines"
  ADD CONSTRAINT "industrial_cost_lines_rate_check"
  CHECK ("rateValue" IS NULL OR "rateValue" >= 0);

ALTER TABLE "industrial_cost_lines"
  ADD CONSTRAINT "industrial_cost_lines_industrialCostVersionId_fkey"
  FOREIGN KEY ("industrialCostVersionId") REFERENCES "industrial_cost_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
