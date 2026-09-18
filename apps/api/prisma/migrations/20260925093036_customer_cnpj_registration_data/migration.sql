-- CUSTOMER-CNPJ-PERSISTED-DATA-01 — dados cadastrais do CNPJ no Cliente (§119).
--
-- Somente aditiva: tipo novo e onze colunas NULL, sem DEFAULT, sem NOT NULL,
-- sem UPDATE e sem backfill. Cliente que já existia fica com o bloco inteiro
-- NULL ("nenhuma consulta aplicada"); nada é inferido do CNPJ, do perfil
-- tributário nem de consulta anterior — a consulta nunca gravou nada.

-- CreateEnum
CREATE TYPE "CnpjEstablishmentType" AS ENUM ('HEADQUARTERS', 'BRANCH');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "cnpjCompanySize" TEXT,
ADD COLUMN     "cnpjEstablishmentType" "CnpjEstablishmentType",
ADD COLUMN     "cnpjLastConsultedAt" TIMESTAMP(3),
ADD COLUMN     "cnpjLegalNature" TEXT,
ADD COLUMN     "cnpjMainCnaeCode" TEXT,
ADD COLUMN     "cnpjMainCnaeDescription" TEXT,
ADD COLUMN     "cnpjMeiOptIn" BOOLEAN,
ADD COLUMN     "cnpjOpenedAt" TIMESTAMP(3),
ADD COLUMN     "cnpjRegistrationStatus" TEXT,
ADD COLUMN     "cnpjRegistrationStatusDate" TIMESTAMP(3),
ADD COLUMN     "cnpjSimplesOptIn" BOOLEAN;
