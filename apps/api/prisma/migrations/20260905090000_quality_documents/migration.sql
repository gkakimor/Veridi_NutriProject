-- Capacidade 37 — Qualidade documental (CoA) e anexos.
-- Incremental: itens existentes ficam sem exigência de laudo e lotes
-- existentes ficam NOT_REQUIRED. Nenhum backfill inventado — a
-- classificação do legado é decisão do Product Owner (capacidade 41).

CREATE TYPE "CoaStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'RECEIVED', 'APPROVED', 'REJECTED');
CREATE TYPE "AttachmentType" AS ENUM ('COA', 'INVOICE', 'LABEL_ART', 'TECHNICAL_SHEET', 'OTHER');

ALTER TABLE "items" ADD COLUMN "requiresCoa" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "lots"
  ADD COLUMN "requiresCoaSnapshot" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "coaStatus" "CoaStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "coaReviewedAt" TIMESTAMP(3),
  ADD COLUMN "coaReviewedByUserId" TEXT,
  ADD COLUMN "coaReviewedByNameSnapshot" TEXT,
  ADD COLUMN "coaReviewNote" TEXT;

CREATE INDEX "lots_coaStatus_idx" ON "lots"("coaStatus");
ALTER TABLE "lots"
  ADD CONSTRAINT "lots_coaReviewedByUserId_fkey"
  FOREIGN KEY ("coaReviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "attachments" (
  "id" TEXT NOT NULL,
  "documentType" "AttachmentType" NOT NULL,
  "lotId" TEXT,
  "receiptId" TEXT,
  "productId" TEXT,
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uploadedByUserId" TEXT NOT NULL,
  "uploadedByNameSnapshot" TEXT NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "archivedByUserId" TEXT,
  "archivedByNameSnapshot" TEXT,
  CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attachments_storageKey_key" ON "attachments"("storageKey");
CREATE INDEX "attachments_lotId_idx" ON "attachments"("lotId");
CREATE INDEX "attachments_receiptId_idx" ON "attachments"("receiptId");
CREATE INDEX "attachments_productId_idx" ON "attachments"("productId");
CREATE INDEX "attachments_documentType_idx" ON "attachments"("documentType");

ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_lotId_fkey"
  FOREIGN KEY ("lotId") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_uploadedByUserId_fkey"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_archivedByUserId_fkey"
  FOREIGN KEY ("archivedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exatamente um contexto por anexo: lote, recebimento OU produto.
-- Garantido no banco, não só na aplicação.
ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_single_owner_check"
  CHECK (
    (CASE WHEN "lotId" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "receiptId" IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN "productId" IS NULL THEN 0 ELSE 1 END) = 1
  );
