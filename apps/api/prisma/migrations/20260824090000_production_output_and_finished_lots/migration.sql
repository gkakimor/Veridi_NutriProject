-- CreateEnum
CREATE TYPE "LotOrigin" AS ENUM ('RECEIPT', 'PRODUCTION');

-- AlterEnum
ALTER TYPE "InventoryMovementType" ADD VALUE 'FINISHED_GOOD_PRODUCTION';
ALTER TYPE "InventoryMovementSourceType" ADD VALUE 'FINISHED_GOOD_PRODUCTION';

-- AlterTable
ALTER TABLE "lots" ADD COLUMN "origin" "LotOrigin" NOT NULL DEFAULT 'RECEIPT';
ALTER TABLE "lots" ALTER COLUMN "supplierId" DROP NOT NULL;
ALTER TABLE "lots" ADD COLUMN "productionOrderId" TEXT;
ALTER TABLE "lots" ADD COLUMN "businessLotNumber" TEXT;

-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "production_orders" ADD COLUMN "completedBy" TEXT;
ALTER TABLE "production_orders" ADD COLUMN "completionReason" TEXT;

-- CreateTable
CREATE TABLE "production_outputs" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "producedAt" TIMESTAMP(3) NOT NULL,
    "producedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_outputs_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "inventory_movements" ADD COLUMN "productionOutputId" TEXT;

-- CreateIndex
CREATE INDEX "lots_productionOrderId_idx" ON "lots"("productionOrderId");

-- CreateIndex
CREATE INDEX "production_outputs_productionOrderId_idx" ON "production_outputs"("productionOrderId");
CREATE INDEX "production_outputs_lotId_idx" ON "production_outputs"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_productionOutputId_key" ON "inventory_movements"("productionOutputId");

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_productionOutputId_fkey" FOREIGN KEY ("productionOutputId") REFERENCES "production_outputs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
