-- CreateEnum
CREATE TYPE "StockCountKind" AS ENUM ('SESSION', 'QUICK');

-- CreateEnum
CREATE TYPE "StockCountMode" AS ENUM ('BLIND', 'ASSISTED');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('IN_PROGRESS', 'IN_REVIEW', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockCountPositionOrigin" AS ENUM ('SCOPE', 'ADDED');

-- CreateEnum
CREATE TYPE "StockCountEntrySource" AS ENUM ('GRID', 'QUICK');

-- CreateEnum
CREATE TYPE "StockCountDecision" AS ENUM ('ADJUST', 'NO_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "StockCountFindingKind" AS ENUM ('UNREGISTERED_LOT', 'UNREGISTERED_ITEM', 'OTHER');

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "StockCountKind" NOT NULL,
    "mode" "StockCountMode" NOT NULL,
    "status" "StockCountStatus" NOT NULL,
    "description" TEXT,
    "scopeFilters" JSONB,
    "referenceAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "createdByName" TEXT NOT NULL,
    "firstRoundClosedAt" TIMESTAMP(3),
    "firstRoundClosedByUserId" TEXT,
    "firstRoundClosedByName" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "completedByName" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancelledByName" TEXT,
    "cancelReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_positions" (
    "id" TEXT NOT NULL,
    "stockCountId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "positionKey" TEXT NOT NULL,
    "openPositionKey" TEXT,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemType" "ItemType" NOT NULL,
    "unitCode" TEXT NOT NULL,
    "lotCode" TEXT,
    "ownerType" "InventoryOwnerType" NOT NULL DEFAULT 'VERIDI',
    "ownerCustomerId" TEXT,
    "ownerCustomerCode" TEXT,
    "ownerCustomerName" TEXT,
    "lotStatusAtReference" "LotStatus",
    "expiryDateAtReference" TIMESTAMP(3),
    "locationAtReference" TEXT,
    "origin" "StockCountPositionOrigin" NOT NULL,
    "addedAt" TIMESTAMP(3),
    "addedByUserId" TEXT,
    "addedByName" TEXT,
    "addReason" TEXT,
    "referenceQuantity" DECIMAL(24,12) NOT NULL,
    "referenceAt" TIMESTAMP(3) NOT NULL,
    "validEntryId" TEXT,
    "recountRequestedRound" INTEGER,
    "recountRequestedAt" TIMESTAMP(3),
    "recountRequestedByUserId" TEXT,
    "recountRequestedByName" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedByUserId" TEXT,
    "removedByName" TEXT,
    "removeReason" TEXT,
    "decision" "StockCountDecision",
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decidedByName" TEXT,
    "concurrentMovementConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "adjustmentMovementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_count_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_entries" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "countedQuantity" DECIMAL(24,12) NOT NULL,
    "expectedQuantity" DECIMAL(24,12) NOT NULL,
    "countedAt" TIMESTAMP(3) NOT NULL,
    "countedByUserId" TEXT,
    "countedByName" TEXT NOT NULL,
    "source" "StockCountEntrySource" NOT NULL,
    "clientRequestId" TEXT,
    "note" TEXT,

    CONSTRAINT "stock_count_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_findings" (
    "id" TEXT NOT NULL,
    "stockCountId" TEXT NOT NULL,
    "kind" "StockCountFindingKind" NOT NULL,
    "itemId" TEXT,
    "identification" TEXT NOT NULL,
    "quantity" DECIMAL(24,12),
    "unitCode" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "createdByName" TEXT NOT NULL,

    CONSTRAINT "stock_count_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_code_key" ON "stock_counts"("code");

-- CreateIndex
CREATE INDEX "stock_counts_status_idx" ON "stock_counts"("status");

-- CreateIndex
CREATE INDEX "stock_counts_kind_idx" ON "stock_counts"("kind");

-- CreateIndex
CREATE INDEX "stock_counts_createdAt_idx" ON "stock_counts"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_positions_openPositionKey_key" ON "stock_count_positions"("openPositionKey");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_positions_validEntryId_key" ON "stock_count_positions"("validEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_positions_adjustmentMovementId_key" ON "stock_count_positions"("adjustmentMovementId");

-- CreateIndex
CREATE INDEX "stock_count_positions_itemId_idx" ON "stock_count_positions"("itemId");

-- CreateIndex
CREATE INDEX "stock_count_positions_lotId_idx" ON "stock_count_positions"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_positions_stockCountId_sequence_key" ON "stock_count_positions"("stockCountId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_positions_stockCountId_positionKey_key" ON "stock_count_positions"("stockCountId", "positionKey");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_entries_clientRequestId_key" ON "stock_count_entries"("clientRequestId");

-- CreateIndex
CREATE INDEX "stock_count_entries_positionId_round_idx" ON "stock_count_entries"("positionId", "round");

-- CreateIndex
CREATE INDEX "stock_count_findings_stockCountId_idx" ON "stock_count_findings"("stockCountId");

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_firstRoundClosedByUserId_fkey" FOREIGN KEY ("firstRoundClosedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_positions" ADD CONSTRAINT "stock_count_positions_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_positions" ADD CONSTRAINT "stock_count_positions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_positions" ADD CONSTRAINT "stock_count_positions_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_positions" ADD CONSTRAINT "stock_count_positions_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_positions" ADD CONSTRAINT "stock_count_positions_validEntryId_fkey" FOREIGN KEY ("validEntryId") REFERENCES "stock_count_entries"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_count_positions" ADD CONSTRAINT "stock_count_positions_recountRequestedByUserId_fkey" FOREIGN KEY ("recountRequestedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_positions" ADD CONSTRAINT "stock_count_positions_removedByUserId_fkey" FOREIGN KEY ("removedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_positions" ADD CONSTRAINT "stock_count_positions_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_positions" ADD CONSTRAINT "stock_count_positions_adjustmentMovementId_fkey" FOREIGN KEY ("adjustmentMovementId") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "stock_count_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_entries" ADD CONSTRAINT "stock_count_entries_countedByUserId_fkey" FOREIGN KEY ("countedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_findings" ADD CONSTRAINT "stock_count_findings_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_findings" ADD CONSTRAINT "stock_count_findings_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_findings" ADD CONSTRAINT "stock_count_findings_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Código do documento de inventário (INV-000001): sequence dedicada, como a
-- dos demais documentos. `nextval` é atômico.
CREATE SEQUENCE "stock_count_code_seq" START 1;

-- A chave da posição é derivada do item e do lote: item sem lote = itemId;
-- item com lote = itemId:lotId. O banco recusa qualquer outra.
ALTER TABLE "stock_count_positions"
  ADD CONSTRAINT "stock_count_positions_position_key_check"
  CHECK (
    ("lotId" IS NULL AND "positionKey" = "itemId")
    OR ("lotId" IS NOT NULL AND "positionKey" = "itemId" || ':' || "lotId")
  );

-- Exclusividade entre inventários abertos: a chave aberta, quando existe, é a
-- própria chave da posição — e o índice único dela é a garantia.
ALTER TABLE "stock_count_positions"
  ADD CONSTRAINT "stock_count_positions_open_key_check"
  CHECK ("openPositionKey" IS NULL OR "openPositionKey" = "positionKey");

ALTER TABLE "stock_count_positions"
  ADD CONSTRAINT "stock_count_positions_sequence_check"
  CHECK ("sequence" >= 1);

ALTER TABLE "stock_count_entries"
  ADD CONSTRAINT "stock_count_entries_round_check"
  CHECK ("round" >= 1);

ALTER TABLE "stock_count_entries"
  ADD CONSTRAINT "stock_count_entries_counted_quantity_check"
  CHECK ("countedQuantity" >= 0);
