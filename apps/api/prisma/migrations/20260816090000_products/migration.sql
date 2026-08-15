-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "customerId" TEXT,
    "finishedProductItemId" TEXT,
    "externalCode" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex: nullable unique — Postgres permite multiplos NULL, garante
-- 1:1 entre Product e Item FINISHED_PRODUCT sem precisar de indice parcial.
CREATE UNIQUE INDEX "products_finishedProductItemId_key" ON "products"("finishedProductItemId");

-- CreateIndex
CREATE INDEX "products_active_idx" ON "products"("active");

-- CreateIndex
CREATE INDEX "products_customerId_idx" ON "products"("customerId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_finishedProductItemId_fkey" FOREIGN KEY ("finishedProductItemId") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sequence dedicada: geracao de codigo segura contra concorrencia
-- (nextval e atomico), mesmo padrao adotado para Items/Suppliers/Customers.
CREATE SEQUENCE "product_code_seq" START WITH 1;
