-- Shipment status
CREATE TYPE "ShipmentStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CustomerOrder gains shipping statuses
ALTER TYPE "CustomerOrderStatus" ADD VALUE 'PARTIALLY_SHIPPED';
ALTER TYPE "CustomerOrderStatus" ADD VALUE 'SHIPPED';

-- Physical shipment movement
ALTER TYPE "InventoryMovementType" ADD VALUE 'SHIPMENT_OUT';
ALTER TYPE "InventoryMovementSourceType" ADD VALUE 'SHIPMENT';

-- Sequence for EXP-000001 codes
CREATE SEQUENCE "shipment_code_seq" START 1;

-- Reallocation history on finished-goods reservation lines
ALTER TABLE "customer_order_reservation_lines" ADD COLUMN "releasedAt" TIMESTAMP(3);
ALTER TABLE "customer_order_reservation_lines" ADD COLUMN "releasedBy" TEXT;
ALTER TABLE "customer_order_reservation_lines" ADD COLUMN "releaseReason" TEXT;
-- 1:N (não @unique): a realocação pode dividir o remanescente entre vários
-- lotes, então uma linha original pode ser substituída por N novas linhas.
ALTER TABLE "customer_order_reservation_lines" ADD COLUMN "replacesLineId" TEXT;
CREATE INDEX "customer_order_reservation_lines_replacesLineId_idx" ON "customer_order_reservation_lines"("replacesLineId");
ALTER TABLE "customer_order_reservation_lines" ADD CONSTRAINT "customer_order_reservation_lines_replacesLineId_fkey" FOREIGN KEY ("replacesLineId") REFERENCES "customer_order_reservation_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- shipments
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerOrderId" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'DRAFT',
    "shipmentDate" TIMESTAMP(3),
    "notes" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shipments_code_key" ON "shipments"("code");
CREATE INDEX "shipments_customerOrderId_idx" ON "shipments"("customerOrderId");
CREATE INDEX "shipments_status_idx" ON "shipments"("status");

-- At most one DRAFT shipment per Customer Order (partial unique index —
-- not representable via Prisma @@unique, same technique already used for
-- the optional-CNPJ uniqueness and the single-ACTIVE-formulation rule).
CREATE UNIQUE INDEX "shipments_one_draft_per_customer_order" ON "shipments"("customerOrderId") WHERE "status" = 'DRAFT';

-- shipment_lines
CREATE TABLE "shipment_lines" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "customerOrderLineId" TEXT NOT NULL,
    "customerOrderReservationLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitCode" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productCode" TEXT,
    "productName" TEXT,
    "finishedItemCode" TEXT,
    "finishedItemName" TEXT,
    "lotCode" TEXT,
    "businessLotNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipment_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "shipment_lines_shipmentId_idx" ON "shipment_lines"("shipmentId");
CREATE INDEX "shipment_lines_customerOrderLineId_idx" ON "shipment_lines"("customerOrderLineId");
CREATE INDEX "shipment_lines_customerOrderReservationLineId_idx" ON "shipment_lines"("customerOrderReservationLineId");
CREATE INDEX "shipment_lines_lotId_idx" ON "shipment_lines"("lotId");

-- 1:1 guarantee: one confirmed ShipmentLine produces at most one SHIPMENT_OUT
ALTER TABLE "inventory_movements" ADD COLUMN "shipmentLineId" TEXT;
CREATE UNIQUE INDEX "inventory_movements_shipmentLineId_key" ON "inventory_movements"("shipmentLineId");

-- Foreign keys
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "customer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_customerOrderLineId_fkey" FOREIGN KEY ("customerOrderLineId") REFERENCES "customer_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_customerOrderReservationLineId_fkey" FOREIGN KEY ("customerOrderReservationLineId") REFERENCES "customer_order_reservation_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipment_lines" ADD CONSTRAINT "shipment_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_shipmentLineId_fkey" FOREIGN KEY ("shipmentLineId") REFERENCES "shipment_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
