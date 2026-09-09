-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "originDeliveryId" TEXT;

-- CreateIndex
CREATE INDEX "shipments_originDeliveryId_idx" ON "shipments"("originDeliveryId");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_originDeliveryId_fkey" FOREIGN KEY ("originDeliveryId") REFERENCES "customer_order_deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
