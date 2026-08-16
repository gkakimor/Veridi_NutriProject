-- CreateEnum
CREATE TYPE "MaterialReservationStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN "releasedAt" TIMESTAMP(3);
ALTER TABLE "production_orders" ADD COLUMN "releasedBy" TEXT;

-- CreateTable
CREATE TABLE "material_reservations" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "status" "MaterialReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releasedBy" TEXT,
    "releaseReason" TEXT,

    CONSTRAINT "material_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_reservation_lines" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "productionOrderRequirementId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_reservation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "material_reservations_productionOrderId_key" ON "material_reservations"("productionOrderId");
CREATE INDEX "material_reservations_status_idx" ON "material_reservations"("status");

-- CreateIndex
CREATE INDEX "material_reservation_lines_itemId_idx" ON "material_reservation_lines"("itemId");
CREATE INDEX "material_reservation_lines_lotId_idx" ON "material_reservation_lines"("lotId");
CREATE INDEX "material_reservation_lines_reservationId_idx" ON "material_reservation_lines"("reservationId");

-- AddForeignKey
ALTER TABLE "material_reservations" ADD CONSTRAINT "material_reservations_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_reservation_lines" ADD CONSTRAINT "material_reservation_lines_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "material_reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_reservation_lines" ADD CONSTRAINT "material_reservation_lines_productionOrderRequirementId_fkey" FOREIGN KEY ("productionOrderRequirementId") REFERENCES "production_order_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_reservation_lines" ADD CONSTRAINT "material_reservation_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_reservation_lines" ADD CONSTRAINT "material_reservation_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
