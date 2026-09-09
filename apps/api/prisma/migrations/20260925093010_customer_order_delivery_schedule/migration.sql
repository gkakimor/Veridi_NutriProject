-- AlterTable
ALTER TABLE "shipment_lines" ADD COLUMN     "customerOrderDeliveryLineId" TEXT;

-- CreateTable
CREATE TABLE "customer_order_deliveries" (
    "id" TEXT NOT NULL,
    "customerOrderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "replacesDeliveryId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_order_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_order_delivery_lines" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "customerOrderLineId" TEXT NOT NULL,
    "quantity" DECIMAL(24,12) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_order_delivery_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_order_deliveries_customerOrderId_idx" ON "customer_order_deliveries"("customerOrderId");

-- CreateIndex
CREATE INDEX "customer_order_deliveries_scheduledDate_idx" ON "customer_order_deliveries"("scheduledDate");

-- CreateIndex
CREATE INDEX "customer_order_deliveries_replacesDeliveryId_idx" ON "customer_order_deliveries"("replacesDeliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_order_deliveries_customerOrderId_sequence_key" ON "customer_order_deliveries"("customerOrderId", "sequence");

-- CreateIndex
CREATE INDEX "customer_order_delivery_lines_customerOrderLineId_idx" ON "customer_order_delivery_lines"("customerOrderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_order_delivery_lines_deliveryId_customerOrderLineI_key" ON "customer_order_delivery_lines"("deliveryId", "customerOrderLineId");

-- CreateIndex
CREATE INDEX "shipment_lines_customerOrderDeliveryLineId_idx" ON "shipment_lines"("customerOrderDeliveryLineId");

-- AddForeignKey
ALTER TABLE "customer_order_deliveries" ADD CONSTRAINT "customer_order_deliveries_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "customer_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order_deliveries" ADD CONSTRAINT "customer_order_deliveries_replacesDeliveryId_fkey" FOREIGN KEY ("replacesDeliveryId") REFERENCES "customer_order_deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order_delivery_lines" ADD CONSTRAINT "customer_order_delivery_lines_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "customer_order_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_order_delivery_lines" ADD CONSTRAINT "customer_order_delivery_lines_customerOrderLineId_fkey" FOREIGN KEY ("customerOrderLineId") REFERENCES "customer_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_customerOrderDeliveryLineId_fkey" FOREIGN KEY ("customerOrderDeliveryLineId") REFERENCES "customer_order_delivery_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
