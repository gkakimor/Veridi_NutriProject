-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "cnpj" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "cnpj" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "state" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE INDEX "suppliers_active_idx" ON "suppliers"("active");

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE INDEX "customers_active_idx" ON "customers"("active");

-- Unicidade de CNPJ apenas quando informado (indice parcial — nao
-- representavel em @@unique do Prisma, mesmo padrao das sequences de codigo).
CREATE UNIQUE INDEX "suppliers_cnpj_key" ON "suppliers"("cnpj") WHERE "cnpj" IS NOT NULL;
CREATE UNIQUE INDEX "customers_cnpj_key" ON "customers"("cnpj") WHERE "cnpj" IS NOT NULL;

-- Sequences dedicadas: geracao de codigo segura contra concorrencia
-- (nextval e atomico), mesmo padrao adotado para Items.
CREATE SEQUENCE "supplier_code_seq" START WITH 1;
CREATE SEQUENCE "customer_code_seq" START WITH 1;
