-- Perfil tributário do Cliente (CUSTOMER-TAX-PROFILE-01, PRODUCT_RULES §83).
--
-- Classificação informada pelo usuário: não calcula imposto e não bloqueia
-- fluxo nenhum. NOT NULL com DEFAULT: todo cliente que já existe recebe
-- NOT_INFORMED na própria criação da coluna, sem backfill separado, e quem
-- cria sem informar — tela, API ou importador legado — recebe o mesmo.

-- CreateEnum
CREATE TYPE "CustomerTaxProfile" AS ENUM ('NOT_INFORMED', 'MEI', 'SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL', 'OTHER');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "taxProfile" "CustomerTaxProfile" NOT NULL DEFAULT 'NOT_INFORMED';
