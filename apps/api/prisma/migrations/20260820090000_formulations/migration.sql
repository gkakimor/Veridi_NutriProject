-- CreateEnum
CREATE TYPE "FormulationVersionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "formulation_versions" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "FormulationVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "basisQuantity" DECIMAL(18,6) NOT NULL,
    "outputItemId" TEXT NOT NULL,
    "outputItemCode" TEXT NOT NULL,
    "outputItemName" TEXT NOT NULL,
    "outputUnitCode" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "activatedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "inactivatedAt" TIMESTAMP(3),
    "inactivatedBy" TEXT,

    CONSTRAINT "formulation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulation_components" (
    "id" TEXT NOT NULL,
    "formulationVersionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unitCode" TEXT NOT NULL,
    "notes" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "formulation_components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "formulation_versions_productId_versionNumber_key" ON "formulation_versions"("productId", "versionNumber");
CREATE INDEX "formulation_versions_productId_idx" ON "formulation_versions"("productId");
CREATE INDEX "formulation_versions_status_idx" ON "formulation_versions"("status");

-- Garantia real (nao so a nivel de aplicacao) de no maximo uma versao
-- ACTIVE por Product — indice unico parcial, mesma tecnica ja usada para
-- unicidade opcional de CNPJ.
CREATE UNIQUE INDEX "formulation_versions_one_active_per_product" ON "formulation_versions"("productId") WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX "formulation_components_formulationVersionId_itemId_key" ON "formulation_components"("formulationVersionId", "itemId");

-- AddForeignKey
ALTER TABLE "formulation_versions" ADD CONSTRAINT "formulation_versions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "formulation_versions" ADD CONSTRAINT "formulation_versions_outputItemId_fkey" FOREIGN KEY ("outputItemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulation_components" ADD CONSTRAINT "formulation_components_formulationVersionId_fkey" FOREIGN KEY ("formulationVersionId") REFERENCES "formulation_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "formulation_components" ADD CONSTRAINT "formulation_components_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
