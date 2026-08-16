-- Capacidade 36 — GMP: usuários, documentos controlados, OP industrial e
-- folha de receita. Migration incremental: nada existente é apagado e todo
-- campo novo em tabela existente é nullable ou tem default.

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PRODUCTION', 'QUALITY', 'PURCHASING', 'COMMERCIAL', 'VIEWER');
CREATE TYPE "ControlledDocumentType" AS ENUM ('PRODUCTION_ORDER', 'RECIPE_SHEET');
CREATE TYPE "ProductionPartStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_code_key" ON "users"("code");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_active_idx" ON "users"("active");

CREATE SEQUENCE user_code_seq START 1;

CREATE TABLE "user_sessions" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_sessions_tokenHash_key" ON "user_sessions"("tokenHash");
CREATE INDEX "user_sessions_userId_idx" ON "user_sessions"("userId");
ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "controlled_document_revisions" (
  "id" TEXT NOT NULL,
  "type" "ControlledDocumentType" NOT NULL,
  "documentCode" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "revisionDate" TIMESTAMP(3),
  "preparedByUserId" TEXT,
  "preparedByNameSnapshot" TEXT,
  "approvedByUserId" TEXT,
  "approvedByNameSnapshot" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "controlled_document_revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "controlled_document_revisions_type_revision_key"
  ON "controlled_document_revisions"("type", "revision");
CREATE INDEX "controlled_document_revisions_type_active_idx"
  ON "controlled_document_revisions"("type", "active");
ALTER TABLE "controlled_document_revisions"
  ADD CONSTRAINT "controlled_document_revisions_preparedByUserId_fkey"
  FOREIGN KEY ("preparedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "controlled_document_revisions"
  ADD CONSTRAINT "controlled_document_revisions_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "production_order_number_counters" (
  "year" INTEGER NOT NULL,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "production_order_number_counters_pkey" PRIMARY KEY ("year")
);

CREATE TABLE "production_order_parts" (
  "id" TEXT NOT NULL,
  "productionOrderId" TEXT NOT NULL,
  "partNumber" INTEGER NOT NULL,
  "status" "ProductionPartStatus" NOT NULL DEFAULT 'PENDING',
  "startedAt" TIMESTAMP(3),
  "startedByUserId" TEXT,
  "startedByNameSnapshot" TEXT,
  "completedAt" TIMESTAMP(3),
  "completedByUserId" TEXT,
  "completedByNameSnapshot" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_order_parts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "production_order_parts_productionOrderId_partNumber_key"
  ON "production_order_parts"("productionOrderId", "partNumber");
ALTER TABLE "production_order_parts"
  ADD CONSTRAINT "production_order_parts_productionOrderId_fkey"
  FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_order_parts"
  ADD CONSTRAINT "production_order_parts_startedByUserId_fkey"
  FOREIGN KEY ("startedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "production_order_parts"
  ADD CONSTRAINT "production_order_parts_completedByUserId_fkey"
  FOREIGN KEY ("completedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "recipe_weighings" (
  "id" TEXT NOT NULL,
  "productionOrderPartId" TEXT NOT NULL,
  "productionOrderRequirementId" TEXT NOT NULL,
  "materialReservationLineId" TEXT,
  "lotId" TEXT,
  "plannedQuantitySnapshot" DECIMAL(18,6) NOT NULL,
  "actualQuantity" DECIMAL(18,6) NOT NULL,
  "uomCode" TEXT NOT NULL,
  "executedByUserId" TEXT NOT NULL,
  "executedByNameSnapshot" TEXT NOT NULL,
  "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "productionConsumptionId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recipe_weighings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "recipe_weighings_productionConsumptionId_key"
  ON "recipe_weighings"("productionConsumptionId");
CREATE INDEX "recipe_weighings_productionOrderRequirementId_idx"
  ON "recipe_weighings"("productionOrderRequirementId");
ALTER TABLE "recipe_weighings"
  ADD CONSTRAINT "recipe_weighings_productionOrderPartId_fkey"
  FOREIGN KEY ("productionOrderPartId") REFERENCES "production_order_parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipe_weighings"
  ADD CONSTRAINT "recipe_weighings_productionOrderRequirementId_fkey"
  FOREIGN KEY ("productionOrderRequirementId") REFERENCES "production_order_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_weighings"
  ADD CONSTRAINT "recipe_weighings_materialReservationLineId_fkey"
  FOREIGN KEY ("materialReservationLineId") REFERENCES "material_reservation_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recipe_weighings"
  ADD CONSTRAINT "recipe_weighings_lotId_fkey"
  FOREIGN KEY ("lotId") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recipe_weighings"
  ADD CONSTRAINT "recipe_weighings_executedByUserId_fkey"
  FOREIGN KEY ("executedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recipe_weighings"
  ADD CONSTRAINT "recipe_weighings_productionConsumptionId_fkey"
  FOREIGN KEY ("productionConsumptionId") REFERENCES "production_consumptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ordem de Produção: numeração oficial anual, partes, rótulo, snapshot do
-- cliente e as revisões congeladas.
ALTER TABLE "production_orders"
  ADD COLUMN "customerTradeName" TEXT,
  ADD COLUMN "customerZipCode" TEXT,
  ADD COLUMN "customerStreet" TEXT,
  ADD COLUMN "customerNumber" TEXT,
  ADD COLUMN "customerComplement" TEXT,
  ADD COLUMN "customerDistrict" TEXT,
  ADD COLUMN "customerCity" TEXT,
  ADD COLUMN "customerState" TEXT,
  ADD COLUMN "officialNumber" TEXT,
  ADD COLUMN "officialNumberYear" INTEGER,
  ADD COLUMN "officialNumberSequence" INTEGER,
  ADD COLUMN "numberOfParts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "labelInstructions" TEXT,
  ADD COLUMN "productionOrderRevisionId" TEXT,
  ADD COLUMN "recipeSheetRevisionId" TEXT;

CREATE UNIQUE INDEX "production_orders_officialNumber_key" ON "production_orders"("officialNumber");
ALTER TABLE "production_orders"
  ADD CONSTRAINT "production_orders_productionOrderRevisionId_fkey"
  FOREIGN KEY ("productionOrderRevisionId") REFERENCES "controlled_document_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "production_orders"
  ADD CONSTRAINT "production_orders_recipeSheetRevisionId_fkey"
  FOREIGN KEY ("recipeSheetRevisionId") REFERENCES "controlled_document_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Configuração da SUGESTÃO de lote comercial (nunca obrigatória).
ALTER TABLE "customers" ADD COLUMN "businessLotSuffix" TEXT;
ALTER TABLE "products" ADD COLUMN "businessLotCode" TEXT;
