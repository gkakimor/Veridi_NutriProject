-- DropTable (fundação de bootstrap não é mais necessária: primeira migration de domínio real)
-- `IF EXISTS` porque `_bootstrap_probe` nasceu de um `db push` na origem do
-- projeto, não de migration versionada: em banco novo ela nunca existiu, e sem
-- a guarda a primeira migration quebra com 42P01 (`table does not exist`).
DROP TABLE IF EXISTS "_bootstrap_probe";

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('RAW_MATERIAL', 'PACKAGING', 'FINISHED_PRODUCT');

-- CreateEnum
CREATE TYPE "UomDimension" AS ENUM ('MASS', 'COUNT', 'VOLUME');

-- CreateTable
CREATE TABLE "units_of_measure" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dimension" "UomDimension" NOT NULL,
    "toBaseFactor" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "units_of_measure_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "type" "ItemType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "controlsLot" BOOLEAN NOT NULL DEFAULT true,
    "controlsExpiry" BOOLEAN NOT NULL DEFAULT true,
    "externalBarcode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "items_code_key" ON "items"("code");

-- CreateIndex
CREATE INDEX "items_type_idx" ON "items"("type");

-- CreateIndex
CREATE INDEX "items_active_idx" ON "items"("active");

-- CreateIndex
CREATE INDEX "items_externalBarcode_idx" ON "items"("externalBarcode");

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_unitCode_fkey" FOREIGN KEY ("unitCode") REFERENCES "units_of_measure"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sequences dedicadas por tipo de item: geração de código segura contra
-- concorrência (nextval é atômico no PostgreSQL), sem depender de MAX(code)+1.
CREATE SEQUENCE "item_code_raw_material_seq" START WITH 1;
CREATE SEQUENCE "item_code_packaging_seq" START WITH 1;
CREATE SEQUENCE "item_code_finished_product_seq" START WITH 1;
