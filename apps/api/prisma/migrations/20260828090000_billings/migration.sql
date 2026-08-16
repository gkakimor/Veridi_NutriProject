-- Commercial/operational billing (never a fiscal document — no NF-e/SEFAZ/taxes)
CREATE TYPE "BillingStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- Sequence for FAT-000001 codes
CREATE SEQUENCE "billing_code_seq" START 1;

-- billings
CREATE TABLE "billings" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerOrderId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" "BillingStatus" NOT NULL DEFAULT 'DRAFT',
    "externalReference" TEXT,
    "notes" TEXT,
    "customerCode" TEXT,
    "customerName" TEXT,
    "customerTradeName" TEXT,
    "customerCnpj" TEXT,
    "customerOrderCode" TEXT,
    "shipmentCode" TEXT,
    "shipmentDate" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "issuedBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "billings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "billings_code_key" ON "billings"("code");
CREATE INDEX "billings_customerOrderId_idx" ON "billings"("customerOrderId");
CREATE INDEX "billings_shipmentId_idx" ON "billings"("shipmentId");
CREATE INDEX "billings_status_idx" ON "billings"("status");
CREATE INDEX "billings_issuedAt_idx" ON "billings"("issuedAt");

-- At most one ACTIVE billing (DRAFT or ISSUED) per shipment — partial unique
-- index, same technique already used for the single-DRAFT-shipment rule and
-- the single-ACTIVE-formulation rule. A CANCELLED billing frees the slot.
CREATE UNIQUE INDEX "billings_one_active_per_shipment" ON "billings"("shipmentId") WHERE "status" IN ('DRAFT', 'ISSUED');

-- billing_lines
CREATE TABLE "billing_lines" (
    "id" TEXT NOT NULL,
    "billingId" TEXT NOT NULL,
    "shipmentLineId" TEXT NOT NULL,
    "customerOrderLineId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "productCode" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "lotCode" TEXT,
    "businessLotNumber" TEXT,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitCode" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,4),
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "billing_lines_billingId_idx" ON "billing_lines"("billingId");
CREATE INDEX "billing_lines_shipmentLineId_idx" ON "billing_lines"("shipmentLineId");
CREATE INDEX "billing_lines_customerOrderLineId_idx" ON "billing_lines"("customerOrderLineId");

-- Foreign keys
ALTER TABLE "billings" ADD CONSTRAINT "billings_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "customer_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billings" ADD CONSTRAINT "billings_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_lines" ADD CONSTRAINT "billing_lines_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "billings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_lines" ADD CONSTRAINT "billing_lines_shipmentLineId_fkey" FOREIGN KEY ("shipmentLineId") REFERENCES "shipment_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_lines" ADD CONSTRAINT "billing_lines_customerOrderLineId_fkey" FOREIGN KEY ("customerOrderLineId") REFERENCES "customer_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_lines" ADD CONSTRAINT "billing_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_lines" ADD CONSTRAINT "billing_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_lines" ADD CONSTRAINT "billing_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
