-- Capacidade 39 — Amostras / pilotos / testes Tn.
-- Incremental: nada existente é apagado. Attachment passa a aceitar mais um
-- contexto (amostra), e o ledger ganha um tipo de saída próprio para
-- consumo de desenvolvimento — nunca disfarçado de ajuste.

CREATE TYPE "ProjectSampleStatus" AS ENUM (
  'DRAFT', 'IN_PROGRESS', 'PRODUCED', 'APPROVED', 'REJECTED', 'CANCELLED'
);
CREATE TYPE "ProjectSampleSource" AS ENUM ('MANUAL', 'LEGACY_IMPORT');

ALTER TYPE "InventoryMovementType" ADD VALUE 'SAMPLE_CONSUMPTION';
ALTER TYPE "InventoryMovementSourceType" ADD VALUE 'PROJECT_SAMPLE';
ALTER TYPE "AttachmentType" ADD VALUE 'SAMPLE_RESULT';

CREATE SEQUENCE project_sample_code_seq START 1;

CREATE TABLE "project_samples" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "externalCode" TEXT,
  "projectId" TEXT NOT NULL,
  "testSequence" INTEGER NOT NULL,
  "status" "ProjectSampleStatus" NOT NULL DEFAULT 'DRAFT',
  "source" "ProjectSampleSource" NOT NULL DEFAULT 'MANUAL',
  "description" TEXT,
  "productionNotes" TEXT,
  "decisionNotes" TEXT,
  "outputQuantity" DECIMAL(18,6),
  "outputUomCode" TEXT,
  "customerCodeSnapshot" TEXT,
  "customerNameSnapshot" TEXT,
  "projectCodeSnapshot" TEXT,
  "projectNameSnapshot" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "createdByNameSnapshot" TEXT,
  "startedAt" TIMESTAMP(3),
  "startedByUserId" TEXT,
  "startedByNameSnapshot" TEXT,
  "producedAt" TIMESTAMP(3),
  "producedByUserId" TEXT,
  "producedByNameSnapshot" TEXT,
  "approvedAt" TIMESTAMP(3),
  "approvedByUserId" TEXT,
  "approvedByNameSnapshot" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectedByUserId" TEXT,
  "rejectedByNameSnapshot" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT,
  "cancelledByNameSnapshot" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_samples_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_samples_code_key" ON "project_samples"("code");
-- Tn é sequencial por projeto: nunca dois testes com o mesmo número.
CREATE UNIQUE INDEX "project_samples_projectId_testSequence_key"
  ON "project_samples"("projectId", "testSequence");
CREATE INDEX "project_samples_projectId_idx" ON "project_samples"("projectId");
CREATE INDEX "project_samples_status_idx" ON "project_samples"("status");

ALTER TABLE "project_samples"
  ADD CONSTRAINT "project_samples_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_samples"
  ADD CONSTRAINT "project_samples_outputUomCode_fkey"
  FOREIGN KEY ("outputUomCode") REFERENCES "units_of_measure"("code") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "project_samples"
  ADD CONSTRAINT "project_samples_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_samples"
  ADD CONSTRAINT "project_samples_startedByUserId_fkey"
  FOREIGN KEY ("startedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_samples"
  ADD CONSTRAINT "project_samples_producedByUserId_fkey"
  FOREIGN KEY ("producedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_samples"
  ADD CONSTRAINT "project_samples_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_samples"
  ADD CONSTRAINT "project_samples_rejectedByUserId_fkey"
  FOREIGN KEY ("rejectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_samples"
  ADD CONSTRAINT "project_samples_cancelledByUserId_fkey"
  FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "sample_consumptions" (
  "id" TEXT NOT NULL,
  "projectSampleId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "lotId" TEXT,
  "quantity" DECIMAL(18,6) NOT NULL,
  "uomCode" TEXT NOT NULL,
  "inventoryMovementId" TEXT,
  "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "executedByUserId" TEXT NOT NULL,
  "executedByNameSnapshot" TEXT NOT NULL,
  "notes" TEXT,
  CONSTRAINT "sample_consumptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sample_consumptions_inventoryMovementId_key"
  ON "sample_consumptions"("inventoryMovementId");
CREATE INDEX "sample_consumptions_projectSampleId_idx"
  ON "sample_consumptions"("projectSampleId");
CREATE INDEX "sample_consumptions_lotId_idx" ON "sample_consumptions"("lotId");

ALTER TABLE "sample_consumptions"
  ADD CONSTRAINT "sample_consumptions_projectSampleId_fkey"
  FOREIGN KEY ("projectSampleId") REFERENCES "project_samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sample_consumptions"
  ADD CONSTRAINT "sample_consumptions_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sample_consumptions"
  ADD CONSTRAINT "sample_consumptions_lotId_fkey"
  FOREIGN KEY ("lotId") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sample_consumptions"
  ADD CONSTRAINT "sample_consumptions_executedByUserId_fkey"
  FOREIGN KEY ("executedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Documento da amostra (resultado de teste, arte, ficha).
ALTER TABLE "attachments" ADD COLUMN "projectSampleId" TEXT;
CREATE INDEX "attachments_projectSampleId_idx" ON "attachments"("projectSampleId");
ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_projectSampleId_fkey"
  FOREIGN KEY ("projectSampleId") REFERENCES "project_samples"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attachments" DROP CONSTRAINT "attachments_single_owner_check";
ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_single_owner_check"
  CHECK (
    (CASE WHEN "lotId" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "receiptId" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "productId" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "projectId" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "projectSampleId" IS NULL THEN 0 ELSE 1 END) = 1
  );
