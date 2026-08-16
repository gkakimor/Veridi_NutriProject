-- CustomerOrder status enums
CREATE TYPE "CustomerOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'IN_FULFILLMENT', 'CANCELLED');
CREATE TYPE "CustomerOrderReservationStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- ProductionOrderOrigin gains CUSTOMER_ORDER
ALTER TYPE "ProductionOrderOrigin" ADD VALUE 'CUSTOMER_ORDER';

-- Sequence for PED-000001 codes
CREATE SEQUENCE "customer_order_code_seq" START 1;

-- customer_orders
CREATE TABLE "customer_orders" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedDeliveryDate" TIMESTAMP(3),
    "status" "CustomerOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "customerCode" TEXT,
    "customerName" TEXT,
    "customerTradeName" TEXT,
    "customerCnpj" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_orders_code_key" ON "customer_orders"("code");
CREATE INDEX "customer_orders_status_idx" ON "customer_orders"("status");
CREATE INDEX "customer_orders_customerId_idx" ON "customer_orders"("customerId");

-- customer_order_lines
CREATE TABLE "customer_order_lines" (
    "id" TEXT NOT NULL,
    "customerOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orderedQuantity" DECIMAL(18,6) NOT NULL,
    "unitCode" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productCode" TEXT,
    "productName" TEXT,
    "finishedItemId" TEXT,
    "finishedItemCode" TEXT,
    "finishedItemName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_order_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_order_lines_customerOrderId_productId_key" ON "customer_order_lines"("customerOrderId", "productId");

-- customer_order_reservations
CREATE TABLE "customer_order_reservations" (
    "id" TEXT NOT NULL,
    "customerOrderId" TEXT NOT NULL,
    "status" "CustomerOrderReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releasedBy" TEXT,
    "releaseReason" TEXT,
    CONSTRAINT "customer_order_reservations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "customer_order_reservations_customerOrderId_idx" ON "customer_order_reservations"("customerOrderId");
CREATE INDEX "customer_order_reservations_status_idx" ON "customer_order_reservations"("status");

-- customer_order_reservation_lines
CREATE TABLE "customer_order_reservation_lines" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "customerOrderLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_order_reservation_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "customer_order_reservation_lines_itemId_idx" ON "customer_order_reservation_lines"("itemId");
CREATE INDEX "customer_order_reservation_lines_lotId_idx" ON "customer_order_reservation_lines"("lotId");

-- production_orders gains customerOrderId/customerOrderLineId
ALTER TABLE "production_orders" ADD COLUMN "customerOrderId" TEXT;
ALTER TABLE "production_orders" ADD COLUMN "customerOrderLineId" TEXT;
CREATE INDEX "production_orders_customerOrderId_idx" ON "production_orders"("customerOrderId");

-- Foreign keys
ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_order_lines" ADD CONSTRAINT "customer_order_lines_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "customer_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_order_lines" ADD CONSTRAINT "customer_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_order_reservations" ADD CONSTRAINT "customer_order_reservations_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "customer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_order_reservation_lines" ADD CONSTRAINT "customer_order_reservation_lines_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "customer_order_reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_order_reservation_lines" ADD CONSTRAINT "customer_order_reservation_lines_customerOrderLineId_fkey" FOREIGN KEY ("customerOrderLineId") REFERENCES "customer_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_order_reservation_lines" ADD CONSTRAINT "customer_order_reservation_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_order_reservation_lines" ADD CONSTRAINT "customer_order_reservation_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_order_reservation_lines" ADD CONSTRAINT "customer_order_reservation_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "customer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_customerOrderLineId_fkey" FOREIGN KEY ("customerOrderLineId") REFERENCES "customer_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
