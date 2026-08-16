-- PurchaseOrder gains origin + customerOrderId (link back to the Customer Order that generated it)
CREATE TYPE "PurchaseOrderOrigin" AS ENUM ('MANUAL', 'CUSTOMER_ORDER');

ALTER TABLE "purchase_orders" ADD COLUMN "origin" "PurchaseOrderOrigin" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "purchase_orders" ADD COLUMN "customerOrderId" TEXT;

CREATE INDEX "purchase_orders_customerOrderId_idx" ON "purchase_orders"("customerOrderId");

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "customer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
