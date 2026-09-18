-- AlterEnum
ALTER TYPE "InventoryMovementSourceType" ADD VALUE 'INTERNAL_CONSUMPTION_REVERSAL';

-- AlterEnum
ALTER TYPE "InventoryMovementType" ADD VALUE 'INTERNAL_CONSUMPTION_REVERSAL';

-- CreateTable
CREATE TABLE "internal_consumption_reversals" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "originalConsumptionId" TEXT NOT NULL,
    "quantity" DECIMAL(24,12) NOT NULL,
    "reason" TEXT NOT NULL,
    "unitCost" DECIMAL(20,8),
    "totalCost" DECIMAL(14,4),
    "costSource" "CostSource" NOT NULL,
    "costDetails" TEXT,
    "inventoryMovementId" TEXT NOT NULL,
    "registeredByUserId" TEXT NOT NULL,
    "registeredByNameSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "internal_consumption_reversals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "internal_consumption_reversals_code_key" ON "internal_consumption_reversals"("code");

-- CreateIndex
CREATE UNIQUE INDEX "internal_consumption_reversals_inventoryMovementId_key" ON "internal_consumption_reversals"("inventoryMovementId");

-- CreateIndex
CREATE INDEX "internal_consumption_reversals_originalConsumptionId_idx" ON "internal_consumption_reversals"("originalConsumptionId");

-- AddForeignKey
ALTER TABLE "internal_consumption_reversals" ADD CONSTRAINT "internal_consumption_reversals_originalConsumptionId_fkey" FOREIGN KEY ("originalConsumptionId") REFERENCES "internal_consumptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_consumption_reversals" ADD CONSTRAINT "internal_consumption_reversals_inventoryMovementId_fkey" FOREIGN KEY ("inventoryMovementId") REFERENCES "inventory_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_consumption_reversals" ADD CONSTRAINT "internal_consumption_reversals_registeredByUserId_fkey" FOREIGN KEY ("registeredByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sequence dedicada do documento ECI- — mesma convenção de todo código de
-- negócio: nextval é atômico, então ECI-000001 nunca depende de MAX(code)+1 e
-- nunca colide sob concorrência. Os dois valores de enum acima NÃO são usados
-- neste arquivo: valor novo de enum só vale depois do commit que o criou.
CREATE SEQUENCE "internal_consumption_reversal_code_seq" START WITH 1;
