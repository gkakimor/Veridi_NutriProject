-- AlterTable: Item ganha requiresQualityRelease (default true; PACKAGING
-- e ajustado explicitamente logo abaixo para refletir o default por tipo).
ALTER TABLE "items" ADD COLUMN "requiresQualityRelease" BOOLEAN NOT NULL DEFAULT true;
UPDATE "items" SET "requiresQualityRelease" = false WHERE "type" = 'PACKAGING';

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('AWAITING_RELEASE', 'AVAILABLE', 'BLOCKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "invoiceNumber" TEXT,
    "documentReference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_lines" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "receivedQuantity" DECIMAL(18,6) NOT NULL,
    "unitCode" TEXT NOT NULL,
    "supplierLot" TEXT,
    "expiryDate" TIMESTAMP(3),
    "location" TEXT,
    "lotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lots" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierLot" TEXT,
    "expiryDate" TIMESTAMP(3),
    "initialReceivedQuantity" DECIMAL(18,6) NOT NULL,
    "status" "LotStatus" NOT NULL DEFAULT 'AVAILABLE',
    "location" TEXT,
    "releasedAt" TIMESTAMP(3),
    "releasedBy" TEXT,
    "blockedAt" TIMESTAMP(3),
    "blockedBy" TEXT,
    "blockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipts_code_key" ON "receipts"("code");
CREATE INDEX "receipts_purchaseOrderId_idx" ON "receipts"("purchaseOrderId");
CREATE INDEX "receipts_supplierId_idx" ON "receipts"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_lines_lotId_key" ON "receipt_lines"("lotId");
CREATE INDEX "receipt_lines_purchaseOrderLineId_idx" ON "receipt_lines"("purchaseOrderLineId");
CREATE INDEX "receipt_lines_itemId_idx" ON "receipt_lines"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "lots_code_key" ON "lots"("code");
CREATE INDEX "lots_itemId_idx" ON "lots"("itemId");
CREATE INDEX "lots_supplierId_idx" ON "lots"("supplierId");
CREATE INDEX "lots_status_idx" ON "lots"("status");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lots" ADD CONSTRAINT "lots_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sequences dedicadas: geracao de codigo segura contra concorrencia
-- (nextval e atomico), mesmo padrao adotado nos demais modulos.
CREATE SEQUENCE "receipt_code_seq" START WITH 1;
-- Lot: sequence global (nao reinicia por dia); codigo final combina
-- data do recebimento + este valor: LT-YYYYMMDD-NNNNNN.
CREATE SEQUENCE "lot_code_seq" START WITH 1;
