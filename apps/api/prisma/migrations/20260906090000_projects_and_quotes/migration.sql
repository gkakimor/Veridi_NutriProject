-- Capacidade 38 — Projetos e Orçamentos versionados.
-- Incremental: nada existente é apagado. Attachment ganha o contexto de
-- projeto e o CHECK passa a aceitar exatamente um entre quatro donos.

CREATE TYPE "ProjectStatus" AS ENUM ('WAITING', 'SAMPLE', 'APPROVED', 'CANCELLED', 'STAND_BY');
CREATE TYPE "ProjectCancelReason" AS ENUM ('PRICE', 'COMPETITOR', 'PROJECT_CHANGED', 'NOT_MET', 'OTHER');
CREATE TYPE "ProjectSource" AS ENUM ('MANUAL', 'LEGACY_IMPORT');
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'ARCHIVED');

ALTER TYPE "AttachmentType" ADD VALUE 'BRIEFING';

CREATE SEQUENCE project_code_seq START 1;
CREATE SEQUENCE quote_code_seq START 1;

CREATE TABLE "projects" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "externalCode" TEXT,
  "customerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "concept" TEXT,
  "channel" TEXT,
  "status" "ProjectStatus" NOT NULL DEFAULT 'WAITING',
  "source" "ProjectSource" NOT NULL DEFAULT 'MANUAL',
  "responsibleUserId" TEXT,
  "entryDate" TIMESTAMP(3) NOT NULL,
  "notes" TEXT,
  "cancelReason" "ProjectCancelReason",
  "cancelReasonDetails" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "dosageForm" "DosageForm",
  "presentationType" "PresentationType",
  "doseAmount" DECIMAL(18,6),
  "doseUomCode" TEXT,
  "dosesPerPackage" INTEGER,
  "targetAgeGroup" "TargetAgeGroup",
  "minimumBatchQuantity" DECIMAL(18,6),
  "shelfLifeMonths" INTEGER,
  "productId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "createdByNameSnapshot" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");
CREATE UNIQUE INDEX "projects_productId_key" ON "projects"("productId");
CREATE INDEX "projects_customerId_idx" ON "projects"("customerId");
CREATE INDEX "projects_status_idx" ON "projects"("status");
CREATE INDEX "projects_externalCode_idx" ON "projects"("externalCode");

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_responsibleUserId_fkey"
  FOREIGN KEY ("responsibleUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_doseUomCode_fkey"
  FOREIGN KEY ("doseUomCode") REFERENCES "units_of_measure"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "project_status_history" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "fromStatus" "ProjectStatus",
  "toStatus" "ProjectStatus" NOT NULL,
  "reason" TEXT,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changedByUserId" TEXT,
  "changedByNameSnapshot" TEXT,
  CONSTRAINT "project_status_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_status_history_projectId_idx" ON "project_status_history"("projectId");
ALTER TABLE "project_status_history"
  ADD CONSTRAINT "project_status_history_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_status_history"
  ADD CONSTRAINT "project_status_history_changedByUserId_fkey"
  FOREIGN KEY ("changedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "quote_versions" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "externalCode" TEXT,
  "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
  "source" "ProjectSource" NOT NULL DEFAULT 'MANUAL',
  "quoteDate" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3),
  "quotedQuantity" DECIMAL(18,6),
  "uomCode" TEXT,
  "unitPrice" DECIMAL(14,4),
  "currencyCode" TEXT NOT NULL DEFAULT 'BRL',
  "commercialNotes" TEXT,
  "paymentTerms" TEXT,
  "leadTimeDays" INTEGER,
  "sentAt" TIMESTAMP(3),
  "sentByUserId" TEXT,
  "sentByNameSnapshot" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "acceptedByUserId" TEXT,
  "acceptedByNameSnapshot" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectedByUserId" TEXT,
  "rejectedByNameSnapshot" TEXT,
  "rejectionReason" TEXT,
  "customerCode" TEXT,
  "customerName" TEXT,
  "customerTradeName" TEXT,
  "customerCnpj" TEXT,
  "customerZipCode" TEXT,
  "customerStreet" TEXT,
  "customerNumber" TEXT,
  "customerComplement" TEXT,
  "customerDistrict" TEXT,
  "customerCity" TEXT,
  "customerState" TEXT,
  "projectCode" TEXT,
  "projectName" TEXT,
  "projectConcept" TEXT,
  "projectChannel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "createdByNameSnapshot" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "quote_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quote_versions_code_key" ON "quote_versions"("code");
CREATE UNIQUE INDEX "quote_versions_projectId_versionNumber_key"
  ON "quote_versions"("projectId", "versionNumber");
CREATE INDEX "quote_versions_projectId_idx" ON "quote_versions"("projectId");
CREATE INDEX "quote_versions_status_idx" ON "quote_versions"("status");

-- No máximo um rascunho aberto por projeto: negociação não tem duas
-- propostas em edição ao mesmo tempo.
CREATE UNIQUE INDEX "quote_versions_one_draft_per_project"
  ON "quote_versions"("projectId") WHERE "status" = 'DRAFT';

ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_uomCode_fkey"
  FOREIGN KEY ("uomCode") REFERENCES "units_of_measure"("code") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_sentByUserId_fkey"
  FOREIGN KEY ("sentByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_acceptedByUserId_fkey"
  FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_rejectedByUserId_fkey"
  FOREIGN KEY ("rejectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Anexo do projeto (briefing, arte, ficha técnica). Arquivos existentes
-- ficam intactos; nenhum arquivo é movido.
ALTER TABLE "attachments" ADD COLUMN "projectId" TEXT;
CREATE INDEX "attachments_projectId_idx" ON "attachments"("projectId");
ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attachments" DROP CONSTRAINT "attachments_single_owner_check";
ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_single_owner_check"
  CHECK (
    (CASE WHEN "lotId" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "receiptId" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "productId" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "projectId" IS NULL THEN 0 ELSE 1 END) = 1
  );
