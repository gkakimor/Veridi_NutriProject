-- CUSTOMER-CNPJ-CREATION-HISTORY-MARKER-01 — marca estrutural de nascimento do
-- registro dos dados do CNPJ gravado na criação do Cliente (§125).
--
-- Somente aditiva: uma coluna anulável, SEM FK, SEM default e SEM backfill.
-- Só a criação do Cliente a preenche, com o id do Cliente que nasce; alteração
-- nunca marca. Toda linha anterior fica NULL e continua bloqueando a exclusão
-- física. O MERGE do saneamento de duplicidades move `customerId` e nunca esta
-- coluna: ela guarda o Cliente ORIGINAL da criação.

-- AlterTable
ALTER TABLE "customer_cnpj_registration_history" ADD COLUMN     "createdWithCustomerId" TEXT;
