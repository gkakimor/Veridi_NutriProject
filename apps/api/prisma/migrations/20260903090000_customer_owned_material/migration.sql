-- Capacidade 35 — Material de propriedade do cliente.
-- Migration compativel: tudo entra com default seguro. Lotes existentes
-- viram VERIDI, recebimentos existentes viram PURCHASE_ORDER.

CREATE TYPE "SupplyResponsibility" AS ENUM ('VERIDI', 'CUSTOMER');
CREATE TYPE "InventoryOwnerType" AS ENUM ('VERIDI', 'CUSTOMER');
CREATE TYPE "ReceiptSourceType" AS ENUM ('PURCHASE_ORDER', 'CUSTOMER_SUPPLIED');

-- Responsabilidade de fornecimento: intencao declarada na formulacao,
-- congelada na necessidade da OP.
ALTER TABLE "formulation_components"
  ADD COLUMN "supplyResponsibility" "SupplyResponsibility" NOT NULL DEFAULT 'VERIDI';

ALTER TABLE "production_order_requirements"
  ADD COLUMN "supplyResponsibility" "SupplyResponsibility" NOT NULL DEFAULT 'VERIDI';

-- Cliente da OP — necessario para usar material do proprio cliente.
ALTER TABLE "production_orders" ADD COLUMN "customerId" TEXT;
ALTER TABLE "production_orders"
  ADD CONSTRAINT "production_orders_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "production_orders_customerId_idx" ON "production_orders"("customerId");

-- Dono do estoque fisico.
ALTER TABLE "lots"
  ADD COLUMN "ownerType" "InventoryOwnerType" NOT NULL DEFAULT 'VERIDI',
  ADD COLUMN "ownerCustomerId" TEXT;
ALTER TABLE "lots"
  ADD CONSTRAINT "lots_ownerCustomerId_fkey"
  FOREIGN KEY ("ownerCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "lots_ownerCustomerId_idx" ON "lots"("ownerCustomerId");

-- Integridade do dono no proprio banco, nao so na aplicacao: VERIDI nunca
-- tem cliente, CUSTOMER nunca fica sem cliente.
ALTER TABLE "lots"
  ADD CONSTRAINT "lots_owner_consistency_check"
  CHECK (
    ("ownerType" = 'VERIDI' AND "ownerCustomerId" IS NULL)
    OR ("ownerType" = 'CUSTOMER' AND "ownerCustomerId" IS NOT NULL)
  );

-- Recebimento sem Ordem de Compra para material enviado pelo cliente.
ALTER TABLE "receipts"
  ADD COLUMN "sourceType" "ReceiptSourceType" NOT NULL DEFAULT 'PURCHASE_ORDER',
  ADD COLUMN "customerId" TEXT;
ALTER TABLE "receipts" ALTER COLUMN "purchaseOrderId" DROP NOT NULL;
ALTER TABLE "receipts" ALTER COLUMN "supplierId" DROP NOT NULL;
ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "receipts_customerId_idx" ON "receipts"("customerId");

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_source_consistency_check"
  CHECK (
    ("sourceType" = 'PURCHASE_ORDER'
      AND "purchaseOrderId" IS NOT NULL
      AND "supplierId" IS NOT NULL
      AND "customerId" IS NULL)
    OR ("sourceType" = 'CUSTOMER_SUPPLIED'
      AND "purchaseOrderId" IS NULL
      AND "customerId" IS NOT NULL)
  );

-- Linha de recebimento direta (sem PurchaseOrderLine) precisa do proprio
-- snapshot do item. Linhas antigas ficam com null e continuam lendo o
-- snapshot da OC.
ALTER TABLE "receipt_lines"
  ADD COLUMN "itemCode" TEXT,
  ADD COLUMN "itemName" TEXT;
ALTER TABLE "receipt_lines" ALTER COLUMN "purchaseOrderLineId" DROP NOT NULL;
