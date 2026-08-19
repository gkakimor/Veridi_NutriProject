-- Bibliotecas técnicas: Estrutura de Custos e Política de Precificação.
--
-- Mesmo princípio dos templates de formulação: a matriz é versionada e
-- aplicá-la CRIA uma cópia independente. Nenhum vínculo vivo, nenhuma
-- sincronização, nenhum "atualizar todos".
--
-- Duas exclusões deliberadas, visíveis no que estas tabelas NÃO têm:
--
--   * o template de custo não guarda tarifa, preço/hora nem custo calculado.
--     Ele diz "usar o misturador por 4 horas"; quanto vale a hora é resolvido
--     pelo motor na data de referência. Congelar tarifa aqui faria a
--     biblioteca envelhecer sem ninguém perceber.
--
--   * a política de precificação não guarda preço, nem `manualUnitPrice`.
--     Preço depende do custo do produto: copiar "R$ 44,90" de um produto para
--     outro levaria o custo alheio disfarçado de decisão comercial.
--
-- Tudo aditivo e anulável. Estruturas e precificações existentes seguem
-- válidas com origem nula; nenhum backfill.

CREATE TYPE "TemplateVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

CREATE SEQUENCE "industrial_cost_template_code_seq" START 1;
CREATE SEQUENCE "pricing_policy_template_code_seq" START 1;

-- ============================================================ custo

CREATE TABLE "industrial_cost_templates" (
  "id"          TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "archivedAt"  TIMESTAMP(3),
  "archivedBy"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"   TEXT,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "industrial_cost_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "industrial_cost_templates_code_key" ON "industrial_cost_templates"("code");
CREATE INDEX "industrial_cost_templates_name_idx" ON "industrial_cost_templates"("name");

CREATE TABLE "industrial_cost_template_versions" (
  "id"                       TEXT NOT NULL,
  "industrialCostTemplateId" TEXT NOT NULL,
  "versionNumber"            INTEGER NOT NULL,
  "status"                   "TemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "referenceOutputQuantity"  DECIMAL(18,6) NOT NULL,
  "referenceOutputUomCode"   TEXT NOT NULL,
  "energyCalculationMode"    "EnergyCalculationMode" NOT NULL DEFAULT 'NONE',
  "energyResourceId"         TEXT,
  "notes"                    TEXT,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"                TEXT,
  "activatedAt"              TIMESTAMP(3),
  "activatedBy"              TEXT,
  "archivedAt"               TIMESTAMP(3),
  "archivedBy"               TEXT,
  "sourceVersionId"          TEXT,
  "sourceVersionNumber"      INTEGER,
  CONSTRAINT "industrial_cost_template_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "industrial_cost_template_versions_templateId_versionNumber_key"
  ON "industrial_cost_template_versions"("industrialCostTemplateId", "versionNumber");
CREATE INDEX "industrial_cost_template_versions_templateId_idx"
  ON "industrial_cost_template_versions"("industrialCostTemplateId");
CREATE INDEX "industrial_cost_template_versions_status_idx"
  ON "industrial_cost_template_versions"("status");

-- Uma versão ativa por template, garantida pelo banco. Índice PARCIAL: DRAFT e
-- ARCHIVED convivem à vontade.
CREATE UNIQUE INDEX "industrial_cost_template_versions_one_active_per_template"
  ON "industrial_cost_template_versions"("industrialCostTemplateId")
  WHERE "status" = 'ACTIVE';

CREATE TABLE "industrial_cost_template_resource_usages" (
  "id"                              TEXT NOT NULL,
  "industrialCostTemplateVersionId" TEXT NOT NULL,
  "industrialResourceId"            TEXT NOT NULL,
  "usageBasis"                      "IndustrialResourceUsageBasis" NOT NULL DEFAULT 'FIXED_PER_REFERENCE_BATCH',
  "usageQuantity"                   DECIMAL(18,6) NOT NULL,
  "usageUom"                        "IndustrialRateUom" NOT NULL,
  "notes"                           TEXT,
  "sortOrder"                       INTEGER NOT NULL DEFAULT 0,
  "createdAt"                       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "industrial_cost_template_resource_usages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "industrial_cost_template_resource_usages_versionId_resource_key"
  ON "industrial_cost_template_resource_usages"("industrialCostTemplateVersionId", "industrialResourceId");
CREATE INDEX "industrial_cost_template_resource_usages_versionId_idx"
  ON "industrial_cost_template_resource_usages"("industrialCostTemplateVersionId");

CREATE TABLE "industrial_cost_template_additional_costs" (
  "id"                              TEXT NOT NULL,
  "industrialCostTemplateVersionId" TEXT NOT NULL,
  "category"                        "IndustrialCostCategory" NOT NULL,
  "description"                     TEXT NOT NULL,
  "calculationBasis"                "IndustrialCostBasis" NOT NULL,
  "rateValue"                       DECIMAL(14,4),
  "notes"                           TEXT,
  "sortOrder"                       INTEGER NOT NULL DEFAULT 0,
  "createdAt"                       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "industrial_cost_template_additional_costs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "industrial_cost_template_additional_costs_versionId_idx"
  ON "industrial_cost_template_additional_costs"("industrialCostTemplateVersionId");

ALTER TABLE "industrial_cost_template_versions"
  ADD CONSTRAINT "industrial_cost_template_versions_templateId_fkey"
  FOREIGN KEY ("industrialCostTemplateId") REFERENCES "industrial_cost_templates"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "industrial_cost_template_versions"
  ADD CONSTRAINT "industrial_cost_template_versions_uom_fkey"
  FOREIGN KEY ("referenceOutputUomCode") REFERENCES "units_of_measure"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "industrial_cost_template_versions"
  ADD CONSTRAINT "industrial_cost_template_versions_energyResourceId_fkey"
  FOREIGN KEY ("energyResourceId") REFERENCES "industrial_resources"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "industrial_cost_template_versions"
  ADD CONSTRAINT "industrial_cost_template_versions_sourceVersionId_fkey"
  FOREIGN KEY ("sourceVersionId") REFERENCES "industrial_cost_template_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "industrial_cost_template_resource_usages"
  ADD CONSTRAINT "industrial_cost_template_resource_usages_versionId_fkey"
  FOREIGN KEY ("industrialCostTemplateVersionId") REFERENCES "industrial_cost_template_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "industrial_cost_template_resource_usages"
  ADD CONSTRAINT "industrial_cost_template_resource_usages_resourceId_fkey"
  FOREIGN KEY ("industrialResourceId") REFERENCES "industrial_resources"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "industrial_cost_template_additional_costs"
  ADD CONSTRAINT "industrial_cost_template_additional_costs_versionId_fkey"
  FOREIGN KEY ("industrialCostTemplateVersionId") REFERENCES "industrial_cost_template_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================ precificação

CREATE TABLE "pricing_policy_templates" (
  "id"          TEXT NOT NULL,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "archivedAt"  TIMESTAMP(3),
  "archivedBy"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"   TEXT,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pricing_policy_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pricing_policy_templates_code_key" ON "pricing_policy_templates"("code");
CREATE INDEX "pricing_policy_templates_name_idx" ON "pricing_policy_templates"("name");

CREATE TABLE "pricing_policy_template_versions" (
  "id"                      TEXT NOT NULL,
  "pricingPolicyTemplateId" TEXT NOT NULL,
  "versionNumber"           INTEGER NOT NULL,
  "status"                  "TemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "notes"                   TEXT,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"               TEXT,
  "activatedAt"             TIMESTAMP(3),
  "activatedBy"             TEXT,
  "archivedAt"              TIMESTAMP(3),
  "archivedBy"              TEXT,
  "sourceVersionId"         TEXT,
  "sourceVersionNumber"     INTEGER,
  CONSTRAINT "pricing_policy_template_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pricing_policy_template_versions_templateId_versionNumber_key"
  ON "pricing_policy_template_versions"("pricingPolicyTemplateId", "versionNumber");
CREATE INDEX "pricing_policy_template_versions_templateId_idx"
  ON "pricing_policy_template_versions"("pricingPolicyTemplateId");
CREATE INDEX "pricing_policy_template_versions_status_idx"
  ON "pricing_policy_template_versions"("status");

CREATE UNIQUE INDEX "pricing_policy_template_versions_one_active_per_template"
  ON "pricing_policy_template_versions"("pricingPolicyTemplateId")
  WHERE "status" = 'ACTIVE';

CREATE TABLE "pricing_policy_template_tiers" (
  "id"                             TEXT NOT NULL,
  "pricingPolicyTemplateVersionId" TEXT NOT NULL,
  "quantity"                       DECIMAL(18,6) NOT NULL,
  "uomCode"                        TEXT NOT NULL,
  "priceMode"                      "PriceMode" NOT NULL DEFAULT 'TARGET_MARGIN',
  "targetContributionMarginPercent" DECIMAL(7,4),
  "commissionPercent"              DECIMAL(7,4) NOT NULL DEFAULT 0,
  "notes"                          TEXT,
  "sortOrder"                      INTEGER NOT NULL DEFAULT 0,
  "createdAt"                      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pricing_policy_template_tiers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pricing_policy_template_tiers_versionId_quantity_key"
  ON "pricing_policy_template_tiers"("pricingPolicyTemplateVersionId", "quantity");
CREATE INDEX "pricing_policy_template_tiers_versionId_idx"
  ON "pricing_policy_template_tiers"("pricingPolicyTemplateVersionId");

ALTER TABLE "pricing_policy_template_versions"
  ADD CONSTRAINT "pricing_policy_template_versions_templateId_fkey"
  FOREIGN KEY ("pricingPolicyTemplateId") REFERENCES "pricing_policy_templates"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pricing_policy_template_versions"
  ADD CONSTRAINT "pricing_policy_template_versions_sourceVersionId_fkey"
  FOREIGN KEY ("sourceVersionId") REFERENCES "pricing_policy_template_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pricing_policy_template_tiers"
  ADD CONSTRAINT "pricing_policy_template_tiers_versionId_fkey"
  FOREIGN KEY ("pricingPolicyTemplateVersionId") REFERENCES "pricing_policy_template_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pricing_policy_template_tiers"
  ADD CONSTRAINT "pricing_policy_template_tiers_uom_fkey"
  FOREIGN KEY ("uomCode") REFERENCES "units_of_measure"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================ proveniência

-- SET NULL, e não CASCADE: arquivar ou remover um template jamais pode apagar
-- a estrutura ou a precificação que nasceu dele. Código e número ficam
-- gravados para o rótulo sobreviver ao vínculo.
ALTER TABLE "industrial_cost_versions"
  ADD COLUMN "originCostTemplateVersionId" TEXT,
  ADD COLUMN "originCostTemplateCode" TEXT,
  ADD COLUMN "originCostTemplateVersionNumber" INTEGER;

CREATE INDEX "industrial_cost_versions_originCostTemplateVersionId_idx"
  ON "industrial_cost_versions"("originCostTemplateVersionId");

ALTER TABLE "industrial_cost_versions"
  ADD CONSTRAINT "industrial_cost_versions_originCostTemplateVersionId_fkey"
  FOREIGN KEY ("originCostTemplateVersionId") REFERENCES "industrial_cost_template_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pricing_versions"
  ADD COLUMN "originPricingPolicyVersionId" TEXT,
  ADD COLUMN "originPricingPolicyCode" TEXT,
  ADD COLUMN "originPricingPolicyVersionNumber" INTEGER;

CREATE INDEX "pricing_versions_originPricingPolicyVersionId_idx"
  ON "pricing_versions"("originPricingPolicyVersionId");

ALTER TABLE "pricing_versions"
  ADD CONSTRAINT "pricing_versions_originPricingPolicyVersionId_fkey"
  FOREIGN KEY ("originPricingPolicyVersionId") REFERENCES "pricing_policy_template_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
