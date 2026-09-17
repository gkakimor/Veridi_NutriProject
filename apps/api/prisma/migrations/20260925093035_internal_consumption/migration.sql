-- CreateEnum
CREATE TYPE "CostSource" AS ENUM ('REAL', 'ESTIMATED_30D', 'ESTIMATED_90D', 'LAST_REAL_COST', 'NO_COST');

-- AlterEnum
ALTER TYPE "InventoryMovementSourceType" ADD VALUE 'INTERNAL_CONSUMPTION';

-- AlterEnum
ALTER TYPE "InventoryMovementType" ADD VALUE 'INTERNAL_CONSUMPTION';

-- CreateTable
CREATE TABLE "internal_consumptions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantity" DECIMAL(24,12) NOT NULL,
    "uomCode" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT,
    "notes" TEXT,
    "unitCost" DECIMAL(20,8),
    "totalCost" DECIMAL(14,4),
    "costSource" "CostSource" NOT NULL,
    "costDetails" TEXT,
    "inventoryMovementId" TEXT,
    "registeredByUserId" TEXT NOT NULL,
    "registeredByNameSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "internal_consumptions_code_key" ON "internal_consumptions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "internal_consumptions_inventoryMovementId_key" ON "internal_consumptions"("inventoryMovementId");

-- CreateIndex
CREATE INDEX "internal_consumptions_itemId_idx" ON "internal_consumptions"("itemId");

-- CreateIndex
CREATE INDEX "internal_consumptions_lotId_idx" ON "internal_consumptions"("lotId");

-- CreateIndex
CREATE INDEX "internal_consumptions_occurredAt_idx" ON "internal_consumptions"("occurredAt");

-- AddForeignKey
ALTER TABLE "internal_consumptions" ADD CONSTRAINT "internal_consumptions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_consumptions" ADD CONSTRAINT "internal_consumptions_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_consumptions" ADD CONSTRAINT "internal_consumptions_inventoryMovementId_fkey" FOREIGN KEY ("inventoryMovementId") REFERENCES "inventory_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_consumptions" ADD CONSTRAINT "internal_consumptions_registeredByUserId_fkey" FOREIGN KEY ("registeredByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sequence dedicada do documento CI- — mesma convenção de todo código de
-- negócio: nextval é atômico, então CI-000001 nunca depende de MAX(code)+1 e
-- nunca colide sob concorrência.
CREATE SEQUENCE "internal_consumption_code_seq" START WITH 1;
