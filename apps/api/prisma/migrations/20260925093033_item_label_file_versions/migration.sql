-- LABEL-ATTACHMENTS-01 — versões do arquivo do Item Rótulo.
--
-- Somente aditiva: tipo novo e tabela nova, sem ALTER em tabela existente, sem
-- UPDATE e sem backfill. Nenhum anexo (`attachments`) é tocado nem migrado.
--
-- A versão vigente não é coluna: é a de maior "versionNumber" sem "voidedAt".
-- Restaurar cria linha NOVA apontando para o mesmo objeto da versão de origem.
-- Anular preenche os campos "voided*" e nunca apaga o objeto do storage.

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('LOCAL_FS', 'R2');

-- CreateTable
CREATE TABLE "item_label_file_versions" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "storageProvider" "StorageProvider" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "note" TEXT,
    "restoredFromVersionId" TEXT,
    "restoredFromVersionNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    "createdByNameSnapshot" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidedByNameSnapshot" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "item_label_file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "item_label_file_versions_restoredFromVersionId_idx" ON "item_label_file_versions"("restoredFromVersionId");

-- CreateIndex
-- V1, V2... uma vez só por Item, mesmo com dois envios simultâneos.
CREATE UNIQUE INDEX "item_label_file_versions_itemId_versionNumber_key" ON "item_label_file_versions"("itemId", "versionNumber");

-- Número de versão começa em 1, e arquivo vazio não é versão.
ALTER TABLE "item_label_file_versions"
  ADD CONSTRAINT "item_label_file_versions_versionNumber_check" CHECK ("versionNumber" >= 1);
ALTER TABLE "item_label_file_versions"
  ADD CONSTRAINT "item_label_file_versions_sizeBytes_check" CHECK ("sizeBytes" > 0);

-- Anulação é tudo ou nada: quando, quem e um motivo escrito.
ALTER TABLE "item_label_file_versions"
  ADD CONSTRAINT "item_label_file_versions_void_check" CHECK (
    (
      "voidedAt" IS NULL
      AND "voidedByUserId" IS NULL
      AND "voidedByNameSnapshot" IS NULL
      AND "voidReason" IS NULL
    )
    OR (
      "voidedAt" IS NOT NULL
      AND "voidedByUserId" IS NOT NULL
      AND "voidedByNameSnapshot" IS NOT NULL
      AND "voidReason" IS NOT NULL
      AND length(btrim("voidReason")) > 0
    )
  );

-- Restauração guarda a origem e o número juntos, e a origem é sempre anterior.
ALTER TABLE "item_label_file_versions"
  ADD CONSTRAINT "item_label_file_versions_restored_from_check" CHECK (
    ("restoredFromVersionId" IS NULL AND "restoredFromVersionNumber" IS NULL)
    OR (
      "restoredFromVersionId" IS NOT NULL
      AND "restoredFromVersionNumber" IS NOT NULL
      AND "restoredFromVersionNumber" < "versionNumber"
    )
  );

-- AddForeignKey
ALTER TABLE "item_label_file_versions" ADD CONSTRAINT "item_label_file_versions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_label_file_versions" ADD CONSTRAINT "item_label_file_versions_restoredFromVersionId_fkey" FOREIGN KEY ("restoredFromVersionId") REFERENCES "item_label_file_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_label_file_versions" ADD CONSTRAINT "item_label_file_versions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_label_file_versions" ADD CONSTRAINT "item_label_file_versions_voidedByUserId_fkey" FOREIGN KEY ("voidedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
