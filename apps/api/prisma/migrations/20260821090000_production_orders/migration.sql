-- CreateEnum
CREATE TYPE "ProductionOrderStatus" AS ENUM ('DRAFT', 'PLANNED', 'RELEASED', 'IN_PRODUCTION', 'COMPLETED', 'BLOCKED', 'CANCELLED');
CREATE TYPE "ProductionOrderOrigin" AS ENUM ('MANUAL', 'STOCK_PRODUCTION');

-- CreateTable
CREATE TABLE "production_orders" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "formulationVersionId" TEXT,
    "plannedQuantity" DECIMAL(18,6) NOT NULL,
    "outputUnitCode" TEXT NOT NULL,
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "origin" "ProductionOrderOrigin" NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "productCode" TEXT,
    "productName" TEXT,
    "finishedItemId" TEXT,
    "finishedItemCode" TEXT,
    "finishedItemName" TEXT,
    "formulationVersionNumber" INTEGER,
    "customerCode" TEXT,
    "customerName" TEXT,
    "customerCnpj" TEXT,
    "plannedAt" TIMESTAMP(3),
    "plannedBy" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_order_requirements" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemType" "ItemType" NOT NULL,
    "formulaQuantity" DECIMAL(18,6) NOT NULL,
    "formulaUnitCode" TEXT NOT NULL,
    "requiredQuantity" DECIMAL(18,6) NOT NULL,
    "stockUnitCode" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_order_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_code_key" ON "production_orders"("code");
CREATE INDEX "production_orders_status_idx" ON "production_orders"("status");
CREATE INDEX "production_orders_productId_idx" ON "production_orders"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "production_order_requirements_productionOrderId_itemId_key" ON "production_order_requirements"("productionOrderId", "itemId");

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_formulationVersionId_fkey" FOREIGN KEY ("formulationVersionId") REFERENCES "formulation_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_finishedItemId_fkey" FOREIGN KEY ("finishedItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_requirements" ADD CONSTRAINT "production_order_requirements_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_order_requirements" ADD CONSTRAINT "production_order_requirements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sequence dedicada: geracao de codigo segura contra concorrencia (nextval
-- e atomico), mesmo padrao adotado nos demais modulos.
CREATE SEQUENCE "production_order_code_seq" START WITH 1;
