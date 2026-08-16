-- AlterEnum
ALTER TYPE "InventoryMovementType" ADD VALUE 'PRODUCTION_CONSUMPTION';
ALTER TYPE "InventoryMovementSourceType" ADD VALUE 'PRODUCTION_CONSUMPTION';

-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "production_orders" ADD COLUMN "startedBy" TEXT;

-- AlterTable
ALTER TABLE "material_reservation_lines" ADD COLUMN "pickedAt" TIMESTAMP(3);
ALTER TABLE "material_reservation_lines" ADD COLUMN "pickedBy" TEXT;
ALTER TABLE "material_reservation_lines" ADD COLUMN "releasedAt" TIMESTAMP(3);
ALTER TABLE "material_reservation_lines" ADD COLUMN "releasedBy" TEXT;
ALTER TABLE "material_reservation_lines" ADD COLUMN "releaseReason" TEXT;
ALTER TABLE "material_reservation_lines" ADD COLUMN "replacesLineId" TEXT;

-- CreateTable
CREATE TABLE "production_consumptions" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "productionOrderRequirementId" TEXT NOT NULL,
    "reservationLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL,
    "consumedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_consumptions_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "inventory_movements" ADD COLUMN "productionConsumptionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "material_reservation_lines_replacesLineId_key" ON "material_reservation_lines"("replacesLineId");

-- CreateIndex
CREATE INDEX "production_consumptions_productionOrderId_idx" ON "production_consumptions"("productionOrderId");
CREATE INDEX "production_consumptions_reservationLineId_idx" ON "production_consumptions"("reservationLineId");
CREATE INDEX "production_consumptions_itemId_idx" ON "production_consumptions"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_productionConsumptionId_key" ON "inventory_movements"("productionConsumptionId");

-- AddForeignKey
ALTER TABLE "material_reservation_lines" ADD CONSTRAINT "material_reservation_lines_replacesLineId_fkey" FOREIGN KEY ("replacesLineId") REFERENCES "material_reservation_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_consumptions" ADD CONSTRAINT "production_consumptions_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_consumptions" ADD CONSTRAINT "production_consumptions_productionOrderRequirementId_fkey" FOREIGN KEY ("productionOrderRequirementId") REFERENCES "production_order_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_consumptions" ADD CONSTRAINT "production_consumptions_reservationLineId_fkey" FOREIGN KEY ("reservationLineId") REFERENCES "material_reservation_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_consumptions" ADD CONSTRAINT "production_consumptions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_consumptions" ADD CONSTRAINT "production_consumptions_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_productionConsumptionId_fkey" FOREIGN KEY ("productionConsumptionId") REFERENCES "production_consumptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
