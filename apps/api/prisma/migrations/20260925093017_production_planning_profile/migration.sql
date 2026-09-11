-- PLANNING-PRODUCTION-PROFILE-01 (PRODUCT_RULES §89): Perfil de Producao —
-- roteiro reutilizavel de COMO um produto e produzido (etapas sequenciais,
-- preparacao x execucao, modo de escala e recursos simultaneos de capacidade).
-- Aditiva: quatro tabelas novas e uma coluna anulavel em `products`. Nenhum
-- custo, formulacao, OP ou estoque existente e tocado; produto sem perfil
-- continua valido.
--
-- Prefixo 093017, e nao 093016: o 093016 e da `user_preferences`, da
-- NAVIGATION-SIDEBAR-01, desenvolvida em paralelo e que entra antes na main.

-- CreateEnum
CREATE TYPE "ProductionStepScalingMode" AS ENUM ('PROPORTIONAL', 'BY_BATCH');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "defaultProductionProfileVersionId" TEXT;

-- CreateTable
CREATE TABLE "production_profiles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_profile_versions" (
    "id" TEXT NOT NULL,
    "productionProfileId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "TemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "referenceQuantity" DECIMAL(24,12) NOT NULL,
    "referenceUomCode" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "activatedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archivedBy" TEXT,
    "sourceVersionId" TEXT,
    "sourceVersionNumber" INTEGER,

    CONSTRAINT "production_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_profile_steps" (
    "id" TEXT NOT NULL,
    "productionProfileVersionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "setupDurationMinutes" INTEGER NOT NULL DEFAULT 0,
    "runDurationMinutes" INTEGER NOT NULL,
    "scalingMode" "ProductionStepScalingMode" NOT NULL DEFAULT 'PROPORTIONAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_profile_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_profile_step_resources" (
    "id" TEXT NOT NULL,
    "productionProfileStepId" TEXT NOT NULL,
    "industrialResourceId" TEXT NOT NULL,
    "resourceQuantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_profile_step_resources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_profiles_code_key" ON "production_profiles"("code");

-- CreateIndex
CREATE INDEX "production_profiles_name_idx" ON "production_profiles"("name");

-- CreateIndex
CREATE INDEX "production_profile_versions_status_idx" ON "production_profile_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "production_profile_versions_profileId_versionNumber_key" ON "production_profile_versions"("productionProfileId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "production_profile_steps_versionId_sequence_key" ON "production_profile_steps"("productionProfileVersionId", "sequence");

-- CreateIndex
CREATE INDEX "production_profile_step_resources_resourceId_idx" ON "production_profile_step_resources"("industrialResourceId");

-- CreateIndex
CREATE UNIQUE INDEX "production_profile_step_resources_step_resource_key" ON "production_profile_step_resources"("productionProfileStepId", "industrialResourceId");

-- CreateIndex
CREATE INDEX "products_defaultProductionProfileVersionId_idx" ON "products"("defaultProductionProfileVersionId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_defaultProductionProfileVersionId_fkey" FOREIGN KEY ("defaultProductionProfileVersionId") REFERENCES "production_profile_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_profile_versions" ADD CONSTRAINT "production_profile_versions_productionProfileId_fkey" FOREIGN KEY ("productionProfileId") REFERENCES "production_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_profile_versions" ADD CONSTRAINT "production_profile_versions_referenceUomCode_fkey" FOREIGN KEY ("referenceUomCode") REFERENCES "units_of_measure"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_profile_versions" ADD CONSTRAINT "production_profile_versions_sourceVersionId_fkey" FOREIGN KEY ("sourceVersionId") REFERENCES "production_profile_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_profile_steps" ADD CONSTRAINT "production_profile_steps_productionProfileVersionId_fkey" FOREIGN KEY ("productionProfileVersionId") REFERENCES "production_profile_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_profile_step_resources" ADD CONSTRAINT "production_profile_step_resources_stepId_fkey" FOREIGN KEY ("productionProfileStepId") REFERENCES "production_profile_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_profile_step_resources" ADD CONSTRAINT "production_profile_step_resources_resourceId_fkey" FOREIGN KEY ("industrialResourceId") REFERENCES "industrial_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Codigo PPR-000001 por sequence dedicada: nextval e atomico, sem MAX(code)+1.
CREATE SEQUENCE "production_profile_code_seq" START 1;

-- Quantidade-base positiva: tempo de execucao "para zero unidades" nao existe.
ALTER TABLE "production_profile_versions"
  ADD CONSTRAINT "production_profile_versions_reference_quantity_check" CHECK ("referenceQuantity" > 0);

-- Sequencia a partir de 1; tempos em minutos inteiros, nunca negativos.
ALTER TABLE "production_profile_steps"
  ADD CONSTRAINT "production_profile_steps_sequence_check" CHECK ("sequence" >= 1);
ALTER TABLE "production_profile_steps"
  ADD CONSTRAINT "production_profile_steps_setup_minutes_check" CHECK ("setupDurationMinutes" >= 0);
ALTER TABLE "production_profile_steps"
  ADD CONSTRAINT "production_profile_steps_run_minutes_check" CHECK ("runDurationMinutes" >= 0);

-- Recursos SIMULTANEOS da etapa: inteiro, no minimo 1. Capacidade, nao o
-- `resourceCount` de custo (§87).
ALTER TABLE "production_profile_step_resources"
  ADD CONSTRAINT "production_profile_step_resources_quantity_check" CHECK ("resourceQuantity" >= 1);

-- No maximo uma versao ATIVA e um RASCUNHO por perfil: o servico garante, o
-- banco confirma.
CREATE UNIQUE INDEX "production_profile_versions_one_active_key"
  ON "production_profile_versions" ("productionProfileId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "production_profile_versions_one_draft_key"
  ON "production_profile_versions" ("productionProfileId") WHERE "status" = 'DRAFT';
