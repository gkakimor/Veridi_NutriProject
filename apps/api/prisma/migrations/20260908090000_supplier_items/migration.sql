-- Capacidade 40 — Item x Fornecedor / homologacao / MOQ / precos.
-- Incremental: nada existente e apagado. Preco e MOQ NAO entram no Item —
-- um item tem varios fornecedores, com condicoes diferentes.

CREATE TYPE "SupplierItemQualificationStatus" AS ENUM ('PENDING', 'APPROVED', 'BLOCKED');
CREATE TYPE "SupplierItemOfferSource" AS ENUM ('MANUAL', 'LEGACY_IMPORT');

CREATE TABLE "supplier_items" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "supplierItemCode" TEXT,
  "qualificationStatus" "SupplierItemQualificationStatus" NOT NULL DEFAULT 'PENDING',
  "preferred" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "commercialNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "createdByNameSnapshot" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedByUserId" TEXT,
  "updatedByNameSnapshot" TEXT,
  CONSTRAINT "supplier_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_items_supplierId_itemId_key"
  ON "supplier_items"("supplierId", "itemId");
CREATE INDEX "supplier_items_itemId_idx" ON "supplier_items"("itemId");
CREATE INDEX "supplier_items_supplierId_idx" ON "supplier_items"("supplierId");
CREATE INDEX "supplier_items_qualificationStatus_idx"
  ON "supplier_items"("qualificationStatus");

-- No maximo UM fornecedor preferencial por item. O banco garante a
-- invariante mesmo sob concorrencia — a aplicacao desmarca o anterior na
-- mesma transacao.
CREATE UNIQUE INDEX "supplier_items_preferred_per_item_key"
  ON "supplier_items"("itemId") WHERE "preferred" = true;

-- Preferencial exige relacao ativa e homologada: bloqueado/inativo nunca
-- pode ser o fornecedor preferencial.
ALTER TABLE "supplier_items"
  ADD CONSTRAINT "supplier_items_preferred_requires_approved_check"
  CHECK ("preferred" = false OR ("active" = true AND "qualificationStatus" = 'APPROVED'));

ALTER TABLE "supplier_items"
  ADD CONSTRAINT "supplier_items_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_items"
  ADD CONSTRAINT "supplier_items_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_items"
  ADD CONSTRAINT "supplier_items_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_items"
  ADD CONSTRAINT "supplier_items_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "supplier_item_qualification_history" (
  "id" TEXT NOT NULL,
  "supplierItemId" TEXT NOT NULL,
  "fromStatus" "SupplierItemQualificationStatus",
  "toStatus" "SupplierItemQualificationStatus" NOT NULL,
  "note" TEXT,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changedByUserId" TEXT,
  "changedByNameSnapshot" TEXT,
  CONSTRAINT "supplier_item_qualification_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "supplier_item_qualification_history_supplierItemId_idx"
  ON "supplier_item_qualification_history"("supplierItemId");

ALTER TABLE "supplier_item_qualification_history"
  ADD CONSTRAINT "supplier_item_qualification_history_supplierItemId_fkey"
  FOREIGN KEY ("supplierItemId") REFERENCES "supplier_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_item_qualification_history"
  ADD CONSTRAINT "supplier_item_qualification_history_changedByUserId_fkey"
  FOREIGN KEY ("changedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "supplier_item_offers" (
  "id" TEXT NOT NULL,
  "supplierItemId" TEXT NOT NULL,
  "unitPrice" DECIMAL(14,4) NOT NULL,
  "currencyCode" VARCHAR(3) NOT NULL,
  "priceUomCode" TEXT NOT NULL,
  "minimumOrderQuantity" DECIMAL(18,6),
  "minimumOrderUomCode" TEXT,
  "effectiveAt" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),
  "source" "SupplierItemOfferSource" NOT NULL DEFAULT 'MANUAL',
  "sourceKey" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" TEXT,
  "createdByNameSnapshot" TEXT,
  CONSTRAINT "supplier_item_offers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_item_offers_sourceKey_key" ON "supplier_item_offers"("sourceKey");
CREATE INDEX "supplier_item_offers_supplierItemId_idx" ON "supplier_item_offers"("supplierItemId");
CREATE INDEX "supplier_item_offers_effectiveAt_idx" ON "supplier_item_offers"("effectiveAt");

-- Preco desconhecido nao gera oferta; zero e zero explicito.
ALTER TABLE "supplier_item_offers"
  ADD CONSTRAINT "supplier_item_offers_unitPrice_check" CHECK ("unitPrice" >= 0);
-- MOQ nulo = nao informado. Informado exige quantidade positiva e unidade.
ALTER TABLE "supplier_item_offers"
  ADD CONSTRAINT "supplier_item_offers_moq_check" CHECK (
    ("minimumOrderQuantity" IS NULL AND "minimumOrderUomCode" IS NULL)
    OR ("minimumOrderQuantity" > 0 AND "minimumOrderUomCode" IS NOT NULL)
  );
-- Vigencia coerente: validade nunca antes do inicio.
ALTER TABLE "supplier_item_offers"
  ADD CONSTRAINT "supplier_item_offers_validity_check" CHECK (
    "effectiveAt" IS NULL OR "validUntil" IS NULL OR "validUntil" >= "effectiveAt"
  );

ALTER TABLE "supplier_item_offers"
  ADD CONSTRAINT "supplier_item_offers_supplierItemId_fkey"
  FOREIGN KEY ("supplierItemId") REFERENCES "supplier_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_item_offers"
  ADD CONSTRAINT "supplier_item_offers_priceUomCode_fkey"
  FOREIGN KEY ("priceUomCode") REFERENCES "units_of_measure"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_item_offers"
  ADD CONSTRAINT "supplier_item_offers_minimumOrderUomCode_fkey"
  FOREIGN KEY ("minimumOrderUomCode") REFERENCES "units_of_measure"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_item_offers"
  ADD CONSTRAINT "supplier_item_offers_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
