-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('RECEIPT_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'LOSS');
CREATE TYPE "InventoryMovementSourceType" AS ENUM ('RECEIPT', 'MANUAL_ADJUSTMENT', 'STOCK_COUNT', 'MANUAL_LOSS');

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "type" "InventoryMovementType" NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "sourceType" "InventoryMovementSourceType" NOT NULL,
    "sourceId" TEXT,
    "receiptLineId" TEXT,
    "reason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_receiptLineId_key" ON "inventory_movements"("receiptLineId");
CREATE INDEX "inventory_movements_itemId_idx" ON "inventory_movements"("itemId");
CREATE INDEX "inventory_movements_lotId_idx" ON "inventory_movements"("lotId");
CREATE INDEX "inventory_movements_type_idx" ON "inventory_movements"("type");
CREATE INDEX "inventory_movements_occurredAt_idx" ON "inventory_movements"("occurredAt");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_receiptLineId_fkey" FOREIGN KEY ("receiptLineId") REFERENCES "receipt_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
