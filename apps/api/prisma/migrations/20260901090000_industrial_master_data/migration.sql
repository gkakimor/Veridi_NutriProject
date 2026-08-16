-- Capacidade 33 — Cadastros Industriais v2.
--
-- Enriquece Customer/Item/Product com os atributos que a operação real de
-- private label da Veridi já usa. Tudo é nullable: nenhum registro
-- existente muda de significado e nenhuma matemática de estoque/produção é
-- afetada. Sem backfill e sem seed — o importador das planilhas é a
-- capacidade 41.

-- ── Enums industriais ───────────────────────────────────────────────────
CREATE TYPE "ItemFamily" AS ENUM (
  'VITAMIN', 'MINERAL', 'AMINO_ACID', 'EXCIPIENT', 'BOTANICAL',
  'OTHER_RAW_MATERIAL', 'PACKAGING', 'OTHER'
);

CREATE TYPE "PackagingSubtype" AS ENUM (
  'POT', 'CAP', 'SCOOP', 'SEAL', 'LABEL', 'BOX', 'POUCH', 'CARTON',
  'BOTTLE', 'OTHER'
);

CREATE TYPE "DosageForm" AS ENUM ('CAPSULE', 'POWDER', 'TABLET', 'LIQUID', 'OTHER');

CREATE TYPE "PresentationType" AS ENUM ('POT', 'POUCH', 'CARTON', 'BULK', 'BOTTLE', 'OTHER');

CREATE TYPE "TargetAgeGroup" AS ENUM ('ADULT', 'CHILD', 'PREGNANT', 'LACTATING', 'OTHER');

-- ── Customer: endereço estruturado ──────────────────────────────────────
-- `city`/`state` já existiam e continuam válidos. `zipCode` guarda somente
-- dígitos; a máscara 00000-000 é apresentação.
ALTER TABLE "customers" ADD COLUMN "street" TEXT;
ALTER TABLE "customers" ADD COLUMN "number" TEXT;
ALTER TABLE "customers" ADD COLUMN "complement" TEXT;
ALTER TABLE "customers" ADD COLUMN "district" TEXT;
ALTER TABLE "customers" ADD COLUMN "zipCode" TEXT;

-- ── Item: taxonomia industrial e pureza ─────────────────────────────────
-- `defaultPurityPercent` NULL significa pureza DESCONHECIDA; nunca deve ser
-- lido como 100%. É apenas o default de novas formulações — a capacidade 34
-- congelará a pureza aplicada no componente.
ALTER TABLE "items" ADD COLUMN "sourceName" TEXT;
ALTER TABLE "items" ADD COLUMN "declaredNutrient" TEXT;
ALTER TABLE "items" ADD COLUMN "family" "ItemFamily";
ALTER TABLE "items" ADD COLUMN "defaultPurityPercent" DECIMAL(6,3);
ALTER TABLE "items" ADD COLUMN "packagingSubtype" "PackagingSubtype";

CREATE INDEX "items_family_idx" ON "items"("family");

-- ── Product: perfil industrial ──────────────────────────────────────────
-- Cadastro puro nesta capacidade: nada aqui bloqueia OP, altera validade de
-- lote ou entra em custo. São insumos das capacidades 34-47.
ALTER TABLE "products" ADD COLUMN "dosageForm" "DosageForm";
ALTER TABLE "products" ADD COLUMN "presentationType" "PresentationType";
ALTER TABLE "products" ADD COLUMN "capsulesPerDose" INTEGER;
ALTER TABLE "products" ADD COLUMN "doseAmount" DECIMAL(18,6);
ALTER TABLE "products" ADD COLUMN "doseUomCode" TEXT;
ALTER TABLE "products" ADD COLUMN "dosesPerPackage" INTEGER;
ALTER TABLE "products" ADD COLUMN "unitsPerShippingBox" INTEGER;
ALTER TABLE "products" ADD COLUMN "targetAgeGroup" "TargetAgeGroup";
ALTER TABLE "products" ADD COLUMN "shelfLifeMonths" INTEGER;
ALTER TABLE "products" ADD COLUMN "minimumBatchQuantity" DECIMAL(18,6);

-- A dose tem unidade própria (mg/g/ml) porque pode diferir da unidade de
-- estoque do Finished Product Item. `minimumBatchQuantity` NÃO tem unidade
-- própria: usa a do Finished Item, para não duplicar UOM.
ALTER TABLE "products"
  ADD CONSTRAINT "products_doseUomCode_fkey"
  FOREIGN KEY ("doseUomCode") REFERENCES "units_of_measure"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── CustomerOrder: snapshot de endereço ─────────────────────────────────
-- O documento confirmado não pode mudar porque o cadastro do cliente foi
-- editado depois. Pedidos confirmados antes desta migration permanecem com
-- NULL: inventar endereço retroativo seria falsear histórico.
ALTER TABLE "customer_orders" ADD COLUMN "customerStreet" TEXT;
ALTER TABLE "customer_orders" ADD COLUMN "customerNumber" TEXT;
ALTER TABLE "customer_orders" ADD COLUMN "customerComplement" TEXT;
ALTER TABLE "customer_orders" ADD COLUMN "customerDistrict" TEXT;
ALTER TABLE "customer_orders" ADD COLUMN "customerZipCode" TEXT;
ALTER TABLE "customer_orders" ADD COLUMN "customerCity" TEXT;
ALTER TABLE "customer_orders" ADD COLUMN "customerState" TEXT;
