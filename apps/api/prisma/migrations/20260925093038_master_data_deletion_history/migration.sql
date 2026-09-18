-- CreateEnum
CREATE TYPE "MasterDataEntityType" AS ENUM ('SUPPLIER', 'CUSTOMER', 'FORMULATION_TEMPLATE', 'INDUSTRIAL_COST_TEMPLATE', 'PRICING_POLICY_TEMPLATE', 'PRODUCTION_PROFILE', 'ITEM', 'PRODUCT', 'INDUSTRIAL_RESOURCE');

-- CreateTable
CREATE TABLE "master_data_deletion_history" (
    "id" TEXT NOT NULL,
    "entityType" "MasterDataEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityCode" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "deletedByUserId" TEXT NOT NULL,
    "deletedByUserName" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "master_data_deletion_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "master_data_deletion_history_entityType_deletedAt_idx" ON "master_data_deletion_history"("entityType", "deletedAt");

-- CreateIndex
CREATE INDEX "master_data_deletion_history_entityId_idx" ON "master_data_deletion_history"("entityId");

-- AddForeignKey
ALTER TABLE "master_data_deletion_history" ADD CONSTRAINT "master_data_deletion_history_deletedByUserId_fkey" FOREIGN KEY ("deletedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
