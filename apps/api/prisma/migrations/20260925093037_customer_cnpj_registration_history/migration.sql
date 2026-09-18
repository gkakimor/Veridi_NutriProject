-- CUSTOMER-CNPJ-EDITABLE-HISTORY-01 — histórico dos dados cadastrais do CNPJ (§122).
--
-- Somente aditiva: um enum e uma tabela nova, append-only, sem backfill. Cliente
-- que já tinha dados cadastrais do CNPJ (CUSTOMER-CNPJ-PERSISTED-DATA-01) não
-- ganha histórico retroativo: a tabela nasce vazia e começa na primeira
-- gravação depois desta capability. `customers` não muda.

-- CreateEnum
CREATE TYPE "CustomerCnpjRegistrationEventKind" AS ENUM ('EDIT', 'CONSULTATION', 'CNPJ_CHANGED');

-- CreateTable
CREATE TABLE "customer_cnpj_registration_history" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" "CustomerCnpjRegistrationEventKind" NOT NULL,
    "cnpj" TEXT,
    "previousCnpj" TEXT,
    "consultedAt" TIMESTAMP(3),
    "changes" JSONB NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedByUserId" TEXT,
    "changedByNameSnapshot" TEXT,

    CONSTRAINT "customer_cnpj_registration_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_cnpj_registration_history_customerId_changedAt_idx" ON "customer_cnpj_registration_history"("customerId", "changedAt");

-- AddForeignKey
ALTER TABLE "customer_cnpj_registration_history" ADD CONSTRAINT "customer_cnpj_registration_history_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_cnpj_registration_history" ADD CONSTRAINT "customer_cnpj_registration_history_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
